(() => {
const { CATS, EX } = window.VisuData;
const { startAnim, stopAllAnims } = window.VisuAnimations;
const { calculateEyeScore, scoreColor } = window.VisuScore;
const { pickExercise, shuffleIndices } = window.VisuSelector;
const { loadHistory, saveHistory, loadSettings, saveSettings } = window.VisuStorage;
const { UI_TEXT, CAT_TEXT, EVIDENCE_TEXT, EX_TEXT } = window.VisuI18n;

const NOTIFY_PREF_KEY='vp_notify_enabled';
const BASE_TITLE=document.title;
const SERVICE_WORKER_PATH='service-worker.js';
const REMINDER_KINDS=['visual','posture'];
const INTERVAL_LIMITS={
  visual:{ min:10,max:30,step:5 },
  posture:{ min:30,max:90,step:15 }
};
const OVERLAP_GRACE_SECONDS=5*60;
const SETTINGS_VERSION=3;
const DEFAULT_ENABLED_CATEGORIES=[...new Set(EX.filter(ex=>ex.defaultEnabled).map(ex=>ex.cat))];
const DEFAULT_DISABLED_EXERCISES=EX.filter(ex=>!ex.defaultEnabled).map(ex=>ex.id);
const DEFAULT_SETTINGS={
  enabledCategories:DEFAULT_ENABLED_CATEGORIES,
  disabledExercises:DEFAULT_DISABLED_EXERCISES,
  exitMode:'manual',
  breakDisplayMode:'page',
  visualIntervalMinutes:20,
  postureIntervalMinutes:45,
  language:'fr',
  settingsVersion:SETTINGS_VERSION
};

// ── DOM helpers and safe rendering ──
const $ = id => document.getElementById(id);
function el(tag, options={}){
  const node=document.createElement(tag);
  if(options.className)node.className=options.className;
  if(options.text!=null)node.textContent=options.text;
  if(options.htmlFor)node.htmlFor=options.htmlFor;
  if(options.style)Object.assign(node.style,options.style);
  if(options.attrs)Object.entries(options.attrs).forEach(([k,v])=>node.setAttribute(k,v));
  return node;
}

function prepareCanvas(canvas,width,height){
  const ratio=Math.min(window.devicePixelRatio||1,2);
  const targetWidth=Math.max(1,Math.round(width*ratio));
  const targetHeight=Math.max(1,Math.round(height*ratio));
  if(canvas.width!==targetWidth||canvas.height!==targetHeight){
    canvas.width=targetWidth;
    canvas.height=targetHeight;
  }
  const ctx=canvas.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0);
  return ctx;
}

function syncOverlayState(){
  const locked=inBreak||UI.pModal?.classList.contains('active')||UI.settingsModal?.classList.contains('active');
  document.body.classList.toggle('overlay-open',Boolean(locked));
}

function restoreFocus(node){
  if(node?.isConnected)node.focus();
}

const UI = {
  exContainer:$('exContainer'), arcBreak:$('arcBreak'), arcSession:$('arcSession'), arcScore:$('arcScore'),
  scoreNum:$('scoreNum'), scoreStatus:$('scoreStatus'), mBreak:$('mBreak'), mBreakBar:$('mBreakBar'),
  mBreakSub:$('mBreakSub'), mFatigue:$('mFatigue'), mFatigueBar:$('mFatigueBar'), mFatigueSub:$('mFatigueSub'),
  timerDisp:$('timerDisp'), startBtn:$('startBtn'), sTime:$('sTime'), sAvg:$('sAvg'), sBreaks:$('sBreaks'),
  sExercise:$('sExercise'), breakOverlay:$('breakOverlay'), bCat:$('bCat'), bSrc:$('bSrc'), bTitle:$('bTitle'),
  bDesc:$('bDesc'), bTip:$('bTip'), extBtn:$('extBtn'), brTxt:$('brTxt'), brProg:$('brProg'),
  startBreakBtn:$('startBreakBtn'), fullBtn:$('fullBtn'),
  breakAnimWrap:$('breakAnimWrap'), breakCanvas:$('breakCanvas'), pModal:$('pModal'), pmCanvas:$('pmCanvas'),
  pmSource:$('pmSource'), pmName:$('pmName'), pmDur:$('pmDur'), pmDesc:$('pmDesc'), pmTip:$('pmTip'),
  devBtn:$('devBtn'), devBadge:$('devBadge'), devBadgeTimer:$('devBadgeTimer'), histChart:$('histChart'),
  chartMeta:$('chartMeta'), exSectionTitle:$('exSectionTitle'), coachLevel:$('coachLevel'),
  coachTitle:$('coachTitle'), coachCopy:$('coachCopy'), coachNextIcon:$('coachNextIcon'),
  coachNextText:$('coachNextText'), coachBreakBtn:$('coachBreakBtn'), notifyBtn:$('notifyBtn'),
  settingsBtn:$('settingsBtn'),
  settingsModal:$('settingsModal'), categorySettings:$('categorySettings'), exerciseSettings:$('exerciseSettings'),
  settingsSummary:$('settingsSummary'), exitModeSettings:$('exitModeSettings'),
  breakDisplaySettings:$('breakDisplaySettings'), languageSettings:$('languageSettings'), endBreakBtn:$('endBreakBtn'),
  visualIntervalRange:$('visualIntervalRange'), visualIntervalValue:$('visualIntervalValue'),
  postureIntervalRange:$('postureIntervalRange'), postureIntervalValue:$('postureIntervalValue'),
  breakNudge:$('breakNudge'), nudgeExercise:$('nudgeExercise'), offscreenCue:$('offscreenCue'),
  nudgeTitle:document.querySelector('#breakNudge strong'), timerNext:$('timerNext'),
  offscreenIcon:$('offscreenIcon'), offscreenCueTitle:$('offscreenCueTitle'), offscreenCueDetail:$('offscreenCueDetail'),
  pmOffscreen:$('pmOffscreen'), pmOffscreenIcon:$('pmOffscreenIcon')
};

// ═══ STATE ═════════════════════════════════════════════════════
let visualSec=DEFAULT_SETTINGS.visualIntervalMinutes*60,postureSec=DEFAULT_SETTINGS.postureIntervalMinutes*60,workSec=visualSec,breakSec=20;
let reminderLeft={ visual:visualSec,posture:postureSec };
let reminderEndAt={ visual:null,posture:null };
let workLeft=Math.min(reminderLeft.visual,reminderLeft.posture),breakLeft=breakSec,breakTotal=breakSec;
let breakEndAt=null;
let running=false,inBreak=false,breakPending=false,breakComplete=false;
let breaksDue=0,breaksTaken=0;
let exerciseQueues={ visual:{ order:[],cursor:0 },posture:{ order:[],cursor:0 },all:{ order:[],cursor:0 } };
let extUsed=false;
let ticker=null,breakTicker=null;
let sessionStart=Date.now(),scoreHistory=loadHistory();
let smoothScore=100,lastBreakTime=Date.now(),lastVisualBreakTime=Date.now(),lastPostureBreakTime=Date.now(),devMode=false,chart=null,chartResizeTimer=null;
let lastExerciseCat=null,lastHistMinute='',exerciseDiversity=new Set(),pendingPick=null;
let notificationsEnabled=loadNotificationPreference(),titleTimer=null;
let activeBreakExercise=null,activeBreakKind=null,activeBreakLarge=false,resizeTimer=null;
let activePracticeExercise=null,practiceResizeTimer=null;
let practiceReturnFocus=null,settingsReturnFocus=null;
let pendingReminderKind=null,scheduledDueOpen=false;
let settings=normalizeSettings(loadSettings());
saveSettings(settings);
let serviceWorkerReady=null;
visualSec=settings.visualIntervalMinutes*60;
postureSec=settings.postureIntervalMinutes*60;
workSec=visualSec;
reminderLeft={ visual:visualSec,posture:postureSec };
workLeft=Math.min(reminderLeft.visual,reminderLeft.posture);
resetExerciseQueues();

function normalizeSettings(raw={}){
  const categoryKeys=Object.keys(CATS);
  const hasSavedExerciseSettings=Number(raw.settingsVersion)>=2;
  const enabledCategories=hasSavedExerciseSettings&&Array.isArray(raw.enabledCategories)
    ? raw.enabledCategories.filter(cat=>categoryKeys.includes(cat))
    : DEFAULT_SETTINGS.enabledCategories.slice();
  const activeCategories=enabledCategories.length?enabledCategories:DEFAULT_SETTINGS.enabledCategories.slice();
  const disabledSet=new Set(hasSavedExerciseSettings&&Array.isArray(raw.disabledExercises)?raw.disabledExercises:DEFAULT_SETTINGS.disabledExercises);
  const knownIds=new Set(EX.map(ex=>ex.id));
  const disabledExercises=[...disabledSet].filter(id=>knownIds.has(id));
  const hasActiveExercise=EX.some(ex=>ex.reminderKind&&activeCategories.includes(ex.cat)&&!disabledExercises.includes(ex.id));
  const legacyVisualInterval=Number(raw.workIntervalMinutes);
  const requestedVisualInterval=Number(raw.visualIntervalMinutes);
  const visualIntervalMinutes=normalizeInterval(
    'visual',
    Number.isFinite(requestedVisualInterval)?requestedVisualInterval:legacyVisualInterval,
    DEFAULT_SETTINGS.visualIntervalMinutes
  );
  const postureIntervalMinutes=normalizeInterval(
    'posture',
    Number(raw.postureIntervalMinutes),
    DEFAULT_SETTINGS.postureIntervalMinutes
  );
  return {
    enabledCategories:hasActiveExercise?activeCategories:DEFAULT_SETTINGS.enabledCategories.slice(),
    disabledExercises:hasActiveExercise?disabledExercises:DEFAULT_SETTINGS.disabledExercises.slice(),
    exitMode:raw.exitMode==='auto'?'auto':'manual',
    breakDisplayMode:raw.breakDisplayMode==='fullscreen'?'fullscreen':'page',
    visualIntervalMinutes,
    postureIntervalMinutes,
    language:raw.language==='en'?'en':'fr',
    settingsVersion:SETTINGS_VERSION
  };
}
function normalizeInterval(kind,value,fallback){
  const limits=INTERVAL_LIMITS[kind];
  if(!Number.isFinite(value))return fallback;
  return Math.min(limits.max,Math.max(limits.min,Math.round(value/limits.step)*limits.step));
}
function persistSettings(){
  if(running&&!inBreak&&!breakPending)syncWorkLeft();
  settings=normalizeSettings(settings);
  saveSettings(settings);
  resetExerciseQueues();
  updateDerivedWorkLeft();
  if(running&&!inBreak&&!breakPending)setReminderDeadlines();
  renderExerciseLibrary();
  renderSettings();
  applyLanguage();
  updateNotificationButton();
  if(chart)drawChart();
  updateUI();
}
function getBreakCompleteLabel(){
  return t('break.done.'+Math.floor(Math.random()*5));
}
function currentLanguage(){return settings?.language==='en'?'en':'fr';}
function t(key){return UI_TEXT[currentLanguage()]?.[key]||UI_TEXT.fr[key]||key;}
function catLabel(catKey){return CAT_TEXT[currentLanguage()]?.[catKey]||CATS[catKey].label;}
function exText(ex,field){return EX_TEXT[currentLanguage()]?.[ex.id]?.[field]||ex[field];}
function evidenceText(value){return EVIDENCE_TEXT[currentLanguage()]?.[value]||value;}
function exerciseName(ex){return ex.ico+' '+exText(ex,'name');}
function localizedScoreLabel(score){
  return score >= 90 ? t('score.excellent') : score >= 75 ? t('score.good') : score >= 60 ? t('score.ok') : score >= 40 ? t('score.tired') : t('score.critical');
}
function applyLanguage(){
  document.documentElement.lang=currentLanguage();
  document.querySelectorAll('[data-i18n]').forEach(node=>{node.textContent=t(node.dataset.i18n);});
  document.querySelectorAll('[data-i18n-aria-label]').forEach(node=>{node.setAttribute('aria-label',t(node.dataset.i18nAriaLabel));});
  if(UI.settingsBtn)UI.settingsBtn.textContent='⚙ '+t('settings.title');
  if(UI.startBreakBtn)UI.startBreakBtn.textContent=t('action.confirmBreak');
  if(UI.extBtn)UI.extBtn.textContent='+ 30 sec';
  if(!inBreak&&!breakPending&&UI.startBtn)UI.startBtn.textContent=running?t('action.pause'):t('action.start');
  if(breakPending)showPendingBreak();
}
function isCategoryEnabled(cat){return settings.enabledCategories.includes(cat);}
function isExerciseEnabled(ex){return Boolean(ex.reminderKind)&&isCategoryEnabled(ex.cat)&&!settings.disabledExercises.includes(ex.id);}
function getEligibleExerciseRecords(kind=null){
  const records=EX.map((exercise,index)=>({ exercise,index }))
    .filter(record=>isExerciseEnabled(record.exercise)&&(!kind||record.exercise.reminderKind===kind));
  return records;
}
function getEligibleExercises(kind=null){return getEligibleExerciseRecords(kind).map(record=>record.exercise);}
function getExerciseGlobalIndex(exercise){return EX.findIndex(item=>item.id===exercise.id);}
function resetExerciseQueues(){
  exerciseQueues={
    visual:{ order:shuffleIndices(getEligibleExercises('visual').length),cursor:0 },
    posture:{ order:shuffleIndices(getEligibleExercises('posture').length),cursor:0 },
    all:{ order:shuffleIndices(getEligibleExercises().length),cursor:0 }
  };
}
function renderExerciseLibrary(){
  UI.exContainer.textContent='';
  const activeCount=EX.filter(isExerciseEnabled).length;
  UI.exSectionTitle.textContent=`${EX.length}${t('library.title')}${activeCount}${t('library.active')}`;
  Object.entries(CATS).forEach(([catKey, cat]) => {
    const exInCat = EX.filter(e => e.cat === catKey);
    const group = document.createElement('div');
    group.className = 'cat-group';
    group.style.marginBottom = '16px';
    const enabled=isCategoryEnabled(catKey);
    const label = el('div', { className:'cat-label', text:catLabel(catKey), style:{ color:enabled?cat.color:'var(--txt2)' } });
    const grid = el('div', { className:'ex-grid', attrs:{ id:`grid-${catKey}` } });
    group.append(label, grid);
    UI.exContainer.appendChild(group);
    exInCat.forEach(ex => {
      const i = EX.indexOf(ex);
      const active=isExerciseEnabled(ex);
      const c = el('article', { className:`ex-card ${cat.cls}${active?'':' muted'}`, attrs:{ 'data-exercise-card':String(i) } });
      c.append(
        el('span', { className:'ex-ico', text:ex.ico }),
        el('div', { className:'ex-name', text:exText(ex,'name') }),
        el('div', { className:'ex-dur', text:ex.dur }),
        el('div', { className:'ex-src', text:exText(ex,'source') })
      );
      if(ex.evidence)c.append(el('span', { className:'ex-evidence', text:`${t('practice.evidence')}${evidenceText(ex.evidence)}` }));
      c.append(el('span', { className:`ex-status ${active?'auto':'optional'}`, text:t(active?'library.auto':'library.optional') }));
      const actions=el('div', { className:'ex-actions' });
      actions.append(
        el('button', { className:'ex-mini', text:t('action.description'), attrs:{ type:'button', 'data-exercise-index':String(i) } }),
        el('button', { className:'ex-mini primary', text:t(ex.pauseMode!=='screen'?'action.preview':'action.test'), attrs:{ type:'button', 'data-test-exercise-index':String(i) } })
      );
      c.append(actions);
      grid.appendChild(c);
    });
  });
}
function renderSettings(){
  const activeCount=EX.filter(isExerciseEnabled).length;
  UI.visualIntervalRange.value=String(settings.visualIntervalMinutes);
  UI.visualIntervalValue.textContent=`${settings.visualIntervalMinutes}${t('settings.minutes')}`;
  UI.postureIntervalRange.value=String(settings.postureIntervalMinutes);
  UI.postureIntervalValue.textContent=`${settings.postureIntervalMinutes}${t('settings.minutes')}`;
  UI.settingsSummary.textContent=`${activeCount} / ${EX.length}${t('settings.summary')}`;
  UI.categorySettings.textContent='';
  Object.entries(CATS).filter(([catKey])=>EX.some(ex=>ex.cat===catKey&&ex.reminderKind)).forEach(([catKey,cat])=>{
    const count=EX.filter(ex=>ex.cat===catKey&&ex.reminderKind&&!settings.disabledExercises.includes(ex.id)).length;
    const item=el('label', { className:'check-row' });
    const input=el('input', { attrs:{ type:'checkbox', 'data-setting-cat':catKey } });
    input.checked=isCategoryEnabled(catKey);
    item.append(input, el('span', { text:catLabel(catKey) }), el('em', { text:String(count) }));
    UI.categorySettings.appendChild(item);
  });
  UI.exerciseSettings.textContent='';
  Object.entries(CATS).filter(([catKey])=>EX.some(ex=>ex.cat===catKey&&ex.reminderKind)).forEach(([catKey,cat])=>{
    const group=el('div', { className:'exercise-setting-group' });
    group.append(el('div', { className:'exercise-setting-title', text:catLabel(catKey) }));
    EX.filter(ex=>ex.cat===catKey&&ex.reminderKind).forEach(ex=>{
      const row=el('label', { className:'check-row compact' });
      const input=el('input', { attrs:{ type:'checkbox', 'data-setting-exercise':ex.id } });
      input.checked=Boolean(ex.reminderKind)&&!settings.disabledExercises.includes(ex.id);
      input.disabled=!ex.reminderKind||!isCategoryEnabled(catKey);
      row.append(input, el('span', { text:exerciseName(ex) }), el('em', { text:ex.dur }));
      group.append(row);
    });
    UI.exerciseSettings.appendChild(group);
  });
  UI.exitModeSettings.querySelectorAll('[data-mode]').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.mode===settings.exitMode);
  });
  UI.breakDisplaySettings.querySelectorAll('[data-mode]').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.mode===settings.breakDisplayMode);
  });
  UI.languageSettings.querySelectorAll('[data-lang]').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.lang===currentLanguage());
  });
}

function trapModalFocus(event){
  if(event.key!=='Tab')return;
  const modal=UI.settingsModal.classList.contains('active')
    ? UI.settingsModal
    : UI.pModal.classList.contains('active')
      ? UI.pModal
      : UI.breakOverlay.classList.contains('active')?UI.breakOverlay:null;
  if(!modal)return;
  const focusable=[...modal.querySelectorAll('button,input,summary,[tabindex]:not([tabindex="-1"])')]
    .filter(node=>!node.disabled&&node.getClientRects().length);
  if(!focusable.length)return;
  const first=focusable[0],last=focusable[focusable.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
}

function bindActions(){
  document.addEventListener('click', e=>{
    const actionTarget=e.target.closest('[data-action]');
    if(actionTarget){
      const actions={
        'toggle-dev':toggleDev,'reset-session':resetSession,'toggle-timer':toggleTimer,
        'reset-timer':resetTimer,'extend-break':extendBreak,'end-break':endBreak,
        'close-practice':closePractice,'start-break-now':startManualBreak,
        'snooze-break':snoozeBreak,
        'toggle-notifications':toggleNotifications,'confirm-break-start':startPendingBreak,
        'toggle-break-fullscreen':toggleBreakFullscreen,'open-settings':openSettings,
        'close-settings':closeSettings,'reset-exercise-settings':resetExerciseSettings,
        'set-exit-mode':()=>setExitMode(actionTarget.dataset.mode),
        'set-break-display-mode':()=>setBreakDisplayMode(actionTarget.dataset.mode),
        'set-language':()=>setLanguage(actionTarget.dataset.lang)
      };
      actions[actionTarget.dataset.action]?.();
      return;
    }
    const testTarget=e.target.closest('[data-test-exercise-index]');
    if(testTarget){startTestExercise(Number(testTarget.dataset.testExerciseIndex));return;}
    const exerciseTarget=e.target.closest('[data-exercise-index]');
    if(exerciseTarget)openPractice(Number(exerciseTarget.dataset.exerciseIndex));
  });
  UI.pModal.addEventListener('click', e=>{ if(e.target===UI.pModal)closePractice(); });
  UI.settingsModal.addEventListener('click', e=>{ if(e.target===UI.settingsModal)closeSettings(); });
  UI.categorySettings.addEventListener('change', e=>{
    const input=e.target.closest('[data-setting-cat]');
    if(!input)return;
    const cat=input.dataset.settingCat;
    if(input.checked){
      settings.enabledCategories=[...new Set([...settings.enabledCategories,cat])];
      const categoryIds=new Set(EX.filter(ex=>ex.cat===cat).map(ex=>ex.id));
      settings.disabledExercises=settings.disabledExercises.filter(id=>!categoryIds.has(id));
    }else{
      settings.enabledCategories=settings.enabledCategories.filter(item=>item!==cat);
    }
    persistSettings();
  });
  UI.exerciseSettings.addEventListener('change', e=>{
    const input=e.target.closest('[data-setting-exercise]');
    if(!input)return;
    const id=input.dataset.settingExercise;
    settings.disabledExercises=input.checked
      ? settings.disabledExercises.filter(item=>item!==id)
      : [...new Set([...settings.disabledExercises,id])];
    persistSettings();
  });
  UI.visualIntervalRange.addEventListener('input',()=>{
    UI.visualIntervalValue.textContent=`${UI.visualIntervalRange.value}${t('settings.minutes')}`;
  });
  UI.visualIntervalRange.addEventListener('change',()=>{
    setVisualIntervalMinutes(Number(UI.visualIntervalRange.value));
  });
  UI.postureIntervalRange.addEventListener('input',()=>{
    UI.postureIntervalValue.textContent=`${UI.postureIntervalRange.value}${t('settings.minutes')}`;
  });
  UI.postureIntervalRange.addEventListener('change',()=>{
    setPostureIntervalMinutes(Number(UI.postureIntervalRange.value));
  });
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape'&&UI.pModal.classList.contains('active'))closePractice();
    if(e.key==='Escape'&&UI.settingsModal.classList.contains('active'))closeSettings();
    trapModalFocus(e);
  });
  document.addEventListener('visibilitychange', catchUpTimers);
  window.addEventListener('focus', catchUpTimers);
  window.addEventListener('pageshow', catchUpTimers);
  window.addEventListener('resize', scheduleAnimationResize);
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('visibilitychange', clearTitleAnnouncement);
}

// ═══ NOTIFICATIONS ════════════════════════════════════════════
function registerServiceWorker(){
  if(!('serviceWorker' in navigator)||!window.isSecureContext)return;
  serviceWorkerReady=navigator.serviceWorker.register(SERVICE_WORKER_PATH)
    .then(registration=>navigator.serviceWorker.ready.then(()=>registration))
    .catch(()=>null);
  navigator.serviceWorker.addEventListener('message', event=>{
    if(event.data?.type==='VISUPAUSE_NOTIFICATION_CLICK')handleNotificationClick(event.data);
  });
}
function loadNotificationPreference(){
  try{return localStorage.getItem(NOTIFY_PREF_KEY)==='1';}
  catch{return false;}
}
function saveNotificationPreference(value){
  notificationsEnabled=value;
  try{localStorage.setItem(NOTIFY_PREF_KEY,value?'1':'0');}
  catch{}
}
function notificationStatus(){
  if(!('Notification' in window))return 'unsupported';
  if(!window.isSecureContext)return 'insecure';
  return Notification.permission;
}
function updateNotificationButton(){
  if(!UI.notifyBtn)return;
  const status=notificationStatus();
  UI.notifyBtn.disabled=status==='unsupported'||status==='insecure';
  UI.notifyBtn.classList.toggle('on',notificationsEnabled&&status==='granted');
  if(status==='unsupported'){
    UI.notifyBtn.textContent=t('notify.unsupported');
    UI.notifyBtn.title=t('notify.unsupportedTitle');
  }else if(status==='insecure'){
    UI.notifyBtn.textContent=t('notify.insecure');
    UI.notifyBtn.title=t('notify.insecureTitle');
  }else if(status==='denied'){
    UI.notifyBtn.textContent=t('notify.denied');
    UI.notifyBtn.title=t('notify.deniedTitle');
  }else if(notificationsEnabled&&status==='granted'){
    UI.notifyBtn.textContent=t('notify.enabled');
    UI.notifyBtn.title=t('notify.enabledTitle');
  }else{
    UI.notifyBtn.textContent=t('notify.activate');
    UI.notifyBtn.title=t('notify.activateTitle');
  }
}
async function toggleNotifications(){
  const status=notificationStatus();
  if(status==='unsupported'){
    alert(t('notify.unsupportedAlert'));
    return;
  }
  if(status==='insecure'){
    alert(t('notify.insecureAlert'));
    return;
  }
  if(status==='denied'){
    alert(t('notify.deniedAlert'));
    updateNotificationButton();
    return;
  }
  if(status==='granted'){
    saveNotificationPreference(!notificationsEnabled);
    if(notificationsEnabled)sendNotification(t('notify.enabledTitleMsg'), t('notify.enabledBody'), 'notify-test');
    updateNotificationButton();
    return;
  }
  try{
    const permission=await Notification.requestPermission();
    saveNotificationPreference(permission==='granted');
    if(permission==='granted')sendNotification(t('notify.enabledTitleMsg'), t('notify.enabledBody'), 'notify-test');
  }catch{
    saveNotificationPreference(false);
  }
  updateNotificationButton();
}
async function sendNotification(title,body,tag,data={}){
  if(!notificationsEnabled||notificationStatus()!=='granted')return;
  const options={
    body,
    tag,
    renotify:true,
    icon:'icons/icon.svg',
    badge:'icons/icon.svg',
    data:{ url:'./index.html',...data }
  };
  const registration=serviceWorkerReady?await serviceWorkerReady:null;
  if(registration&&registration.showNotification){
    try{
      await registration.showNotification(title,options);
      if(navigator.vibrate)navigator.vibrate([180,80,180]);
      return;
    }catch{}
  }
  try{
    const notice=new Notification(title,options);
    notice.onclick=()=>{
      window.focus();
      handleNotificationClick({ tag,...options.data });
      notice.close();
    };
    if(document.visibilityState==='visible')setTimeout(()=>notice.close(),6000);
  }catch{}
  if(navigator.vibrate)navigator.vibrate([180,80,180]);
}
function handleNotificationClick(data={}){
  clearTitleAnnouncement();
  catchUpTimers();
  if(data.tag==='visupause-break-due'&&breakPending)showPendingBreak();
  if(inBreak){
    UI.breakOverlay.classList.add('active');
    updateBreakProgress();
    scheduleAnimationResize();
  }
  updateUI();
}
function handleLaunchAction(){
  if(!location.hash.startsWith('#pause-due'))return;
  const requestedKind=location.hash.split('=')[1];
  const launchKind=REMINDER_KINDS.includes(requestedKind)?requestedKind:'visual';
  history.replaceState(null,'',location.pathname+location.search);
  if(!inBreak&&!breakPending){
    if(running)syncWorkLeft();
    stopWorkTicker();
    running=false;
    clearReminderDeadlines();
    reminderLeft[launchKind]=0;
    workLeft=0;
    breaksDue=Math.max(breaksDue,1);
    scheduledDueOpen=true;
    pendingReminderKind=launchKind;
    pendingPick=selectNextExercise(pendingReminderKind);
    breakPending=true;
    showPendingBreak();
    UI.startBtn.textContent=t('action.startBreak');
  }
  updateUI();
}
function announceInTitle(text){
  clearTimeout(titleTimer);
  document.title=text;
  titleTimer=setTimeout(clearTitleAnnouncement,9000);
}
function clearTitleAnnouncement(){
  if(!document.hidden)document.title=BASE_TITLE;
}
function notifyBreakDue(ex,kind){
  announceInTitle(t('title.breakReady'));
  sendNotification(t('notify.breakDueTitle'), `${t('notify.breakDueBody')}${exerciseName(ex)}.`, 'visupause-break-due', { reminderKind:kind });
}
function notifyBreakEnd(){
  announceInTitle(t('title.breakDone'));
  sendNotification(t('notify.breakEndTitle'), t('notify.breakEndBody'), 'visupause-break-end');
}
function notifyBreakReadyToEnd(){
  announceInTitle(t('title.breakDone'));
  sendNotification(t('notify.breakEndTitle'), t('notify.breakReadyBody'), 'visupause-break-ready');
}

// ═══ SETTINGS ══════════════════════════════════════════════════
function openSettings(){
  settingsReturnFocus=document.activeElement;
  renderSettings();
  UI.settingsModal.classList.add('active');
  UI.settingsModal.setAttribute('aria-hidden','false');
  syncOverlayState();
  UI.settingsModal.querySelector('[data-action="close-settings"]')?.focus();
}
function closeSettings(){
  if(!UI.settingsModal.classList.contains('active'))return;
  UI.settingsModal.classList.remove('active');
  UI.settingsModal.setAttribute('aria-hidden','true');
  syncOverlayState();
  restoreFocus(settingsReturnFocus);
  settingsReturnFocus=null;
}
function resetExerciseSettings(){
  settings.enabledCategories=DEFAULT_SETTINGS.enabledCategories.slice();
  settings.disabledExercises=DEFAULT_SETTINGS.disabledExercises.slice();
  persistSettings();
}
function setExitMode(mode){
  settings.exitMode=mode==='auto'?'auto':'manual';
  persistSettings();
}
function setBreakDisplayMode(mode){
  settings.breakDisplayMode=mode==='fullscreen'?'fullscreen':'page';
  persistSettings();
}
function setVisualIntervalMinutes(minutes){setReminderInterval('visual',minutes);}
function setPostureIntervalMinutes(minutes){setReminderInterval('posture',minutes);}
function setReminderInterval(kind,minutes){
  const settingKey=kind==='posture'?'postureIntervalMinutes':'visualIntervalMinutes';
  const previousSeconds=kind==='posture'?postureSec:visualSec;
  if(running&&!inBreak&&!breakPending)syncWorkLeft();
  const previousLeft=reminderLeft[kind];
  settings[settingKey]=minutes;
  settings=normalizeSettings(settings);
  if(!devMode){
    const nextSeconds=settings[settingKey]*60;
    const elapsed=Math.max(0,previousSeconds-previousLeft);
    if(kind==='posture')postureSec=nextSeconds;
    else{visualSec=nextSeconds;workSec=nextSeconds;}
    if(!inBreak&&!breakPending){
      reminderLeft[kind]=Math.max(0,nextSeconds-elapsed);
      updateDerivedWorkLeft();
      if(running)setReminderDeadlines();
    }
  }
  persistSettings();
  const dueKind=getDueReminderKind();
  if(!devMode&&running&&!inBreak&&!breakPending&&dueKind){
    closeSettings();
    queueBreak(dueKind);
  }
}
function setLanguage(language){
  settings.language=language==='en'?'en':'fr';
  persistSettings();
}

// ═══ SCORE ═════════════════════════════════════════════════════
function calcScore(){
  return calculateEyeScore({
    breaksDue,
    breaksTaken,
    lastBreakTime,
    intervalMinutes: workSec/60,
    inBreak,
    breakPending
  });
}
function setArc(node,circ,pct){node.setAttribute('stroke-dashoffset',(circ*(1-Math.max(0,Math.min(1,pct)))).toFixed(1));}
function getUpcomingExercise(kind=getNextReminderKind()){
  const eligible=getEligibleExercises(kind);
  const queue=exerciseQueues[kind]||exerciseQueues.all;
  return eligible[queue.order[queue.cursor%eligible.length]]||eligible[0]||EX[0];
}
function getCoachPlan(minsSince,nextEx){
  const missedBreaks=Math.max(0,breaksDue-breaksTaken);
  const intervalMinutes=workSec/60;
  if(breakPending)return {
    level:t('coach.toDo'),
    title:t('coach.pendingTitle'),
    copy:t('coach.pendingCopy'),
    next:pendingPick?.exercise||nextEx
  };
  if(inBreak)return {
    level:t('coach.break'),
    title:t('coach.breakTitle'),
    copy:t('coach.breakCopy'),
    next:nextEx
  };
  if(!running&&breaksDue===0)return {
    level:t('coach.ready'),
    title:t('coach.startTitle'),
    copy:t('coach.startCopy'),
    next:nextEx
  };
  if(minsSince>=intervalMinutes||missedBreaks>=2)return {
    level:t('coach.priority'),
    title:t('coach.priorityTitle'),
    copy:t('coach.priorityCopy'),
    next:getEligibleExercises('visual')[0]||nextEx
  };
  if(minsSince>=intervalMinutes*.75)return {
    level:t('coach.soon'),
    title:t('coach.soonTitle'),
    copy:t('coach.soonCopy'),
    next:nextEx
  };
  return {
    level:t('coach.stable'),
    title:t('coach.stableTitle'),
    copy:t('coach.stableCopy'),
    next:nextEx
  };
}

// ═══ UI ════════════════════════════════════════════════════════
function updateUI(){
  if(running&&!inBreak)syncWorkLeft();
  if(inBreak){syncBreakLeft();updateBreakProgress();}
  const active=running||inBreak||breakPending;
  const raw=calcScore();
  smoothScore=raw;
  const score=raw;
  const bsPct=breaksDue===0?1:breaksTaken/breaksDue;
  const minsSince=(Date.now()-lastBreakTime)/60000;
  const intervalMinutes=workSec/60;
  const tsPct=Math.max(0,1-minsSince/intervalMinutes);
  setArc(UI.arcBreak,565.5,active?bsPct:0);
  setArc(UI.arcSession,464.9,active?tsPct:0);
  setArc(UI.arcScore,364.4,score/100);
  const col=scoreColor(score);
  UI.arcScore.setAttribute('stroke',col);
  UI.arcBreak.setAttribute('stroke','#28d4b4');
  UI.arcSession.setAttribute('stroke',bsPct>.8?'#7c83f5':'#e8a020');
  UI.scoreNum.style.color=col;
  UI.scoreNum.textContent=score;
  UI.scoreStatus.textContent=breakPending?t('score.pending'):active?localizedScoreLabel(score):t('score.ready');
  UI.mBreak.textContent=`${breaksTaken} / ${breaksDue}`;
  UI.mBreakBar.style.width=(breaksDue===0?0:breaksTaken/breaksDue*100)+'%';
  const nextReminderKind=breakPending?pendingReminderKind:getNextReminderKind();
  UI.mBreakSub.textContent=breakPending?t('metric.pending'):`${t('timer.'+nextReminderKind)} · ${t('metric.nextBreak')}${fmt(workLeft)}`;
  const minsS=Math.round(minsSince);
  UI.mFatigue.textContent=minsS+t('time.minute');
  UI.mFatigueBar.style.width=Math.min(minsSince/intervalMinutes*100,100)+'%';
  UI.mFatigueBar.style.background=minsSince<intervalMinutes*.6?'var(--teal)':minsSince<intervalMinutes*.9?'var(--amber)':'var(--red)';
  UI.mFatigueSub.textContent=minsSince<intervalMinutes*.6?t('metric.ok'):minsSince<intervalMinutes?t('metric.soon'):t('metric.urgent');
  if(!inBreak){
    UI.timerDisp.textContent=fmt(workLeft);
    UI.timerDisp.classList.toggle('warn',breakPending||(workLeft<=60&&running));
  }
  UI.timerNext.textContent=t('timer.'+nextReminderKind);
  if(breakPending)UI.startBtn.textContent=t('action.startBreak');
  const mins=Math.floor((Date.now()-sessionStart)/60000);
  UI.sTime.textContent=mins<60?mins+t('time.minute'):Math.floor(mins/60)+t('time.hour')+(mins%60)+t('time.minute');
  UI.sBreaks.textContent=breaksTaken;
  const nextEx=getUpcomingExercise(nextReminderKind);
  UI.sExercise.textContent=nextEx?nextEx.ico:'—';
  const coachPlan=getCoachPlan(minsSince,nextEx);
  UI.coachLevel.textContent=coachPlan.level;
  UI.coachTitle.textContent=coachPlan.title;
  UI.coachCopy.textContent=coachPlan.copy;
  UI.coachNextIcon.textContent=coachPlan.next?coachPlan.next.ico:'—';
  UI.coachNextText.textContent=coachPlan.next?`${catLabel(coachPlan.next.cat)} · ${exText(coachPlan.next,'name')}`:t('coach.next');
  UI.coachBreakBtn.disabled=inBreak;
  UI.coachBreakBtn.textContent=breakPending?t('action.confirmBreak'):inBreak?t('action.breakRunning'):t('action.breakNow');
  const hs=scoreHistory.map(h=>h.s);
  if(hs.length){const avg=Math.round(hs.reduce((a,b)=>a+b)/hs.length);UI.sAvg.textContent=avg;UI.sAvg.style.color=scoreColor(avg);}
}
function fmt(s){return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}
function remainingSeconds(deadline){
  if(!deadline)return 0;
  return Math.max(0,Math.ceil((deadline-Date.now())/1000));
}
function syncWorkLeft(){
  if(running&&!inBreak){
    REMINDER_KINDS.forEach(kind=>{
      if(reminderEndAt[kind])reminderLeft[kind]=remainingSeconds(reminderEndAt[kind]);
    });
    updateDerivedWorkLeft();
  }
  return workLeft;
}
function updateDerivedWorkLeft(){
  const activeKinds=getActiveReminderKinds();
  workLeft=activeKinds.length?Math.min(...activeKinds.map(kind=>reminderLeft[kind])):0;
  return workLeft;
}
function getActiveReminderKinds(){
  return REMINDER_KINDS.filter(kind=>getEligibleExercises(kind).length>0);
}
function getNextReminderKind(){
  const activeKinds=getActiveReminderKinds();
  return activeKinds.sort((a,b)=>reminderLeft[a]-reminderLeft[b])[0]||'visual';
}
function getDueReminderKind(){
  const activeKinds=getActiveReminderKinds();
  if(activeKinds.includes('visual')&&reminderLeft.visual<=0)return 'visual';
  if(activeKinds.includes('posture')&&reminderLeft.posture<=0)return 'posture';
  return null;
}
function reminderIntervalSeconds(kind){
  if(devMode)return kind==='visual'?2:5;
  return kind==='posture'?postureSec:visualSec;
}
function setReminderDeadlines(){
  const now=Date.now();
  const activeKinds=getActiveReminderKinds();
  REMINDER_KINDS.forEach(kind=>{reminderEndAt[kind]=activeKinds.includes(kind)?now+reminderLeft[kind]*1000:null;});
}
function clearReminderDeadlines(){
  REMINDER_KINDS.forEach(kind=>{reminderEndAt[kind]=null;});
}
function syncBreakLeft(){
  if(inBreak&&breakEndAt)breakLeft=remainingSeconds(breakEndAt);
  return breakLeft;
}
function updateBreakProgress(){
  if(!inBreak)return;
  UI.brTxt.textContent=breakComplete?'✓':breakLeft;
  const progress=breakTotal===0?1:1-breakLeft/breakTotal;
  UI.brProg.setAttribute('stroke-dashoffset',(213.6*progress).toFixed(1));
}
function setBreakStageMode(exercise){
  activeBreakLarge=true;
  UI.breakOverlay.classList.add('immersive');
  const offscreen=exercise?.pauseMode==='offscreen';
  UI.breakOverlay.classList.toggle('offscreen',offscreen);
  UI.offscreenIcon.textContent=exercise?.ico||'↗';
  const cueKind=activeBreakKind==='posture'?'posture':'visual';
  UI.offscreenCueTitle.textContent=t(`break.${cueKind}Cue`);
  UI.offscreenCueDetail.textContent=t('break.cuePersistent');
}
function scheduleAnimationResize(){
  if(inBreak&&activeBreakExercise&&activeBreakExercise.pauseMode!=='offscreen'){
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(renderBreakAnimation,120);
  }
  if(activePracticeExercise&&UI.pModal.classList.contains('active')){
    clearTimeout(practiceResizeTimer);
    practiceResizeTimer=setTimeout(renderPracticeAnimation,120);
  }
}
function renderBreakAnimation(){
  if(!inBreak||!activeBreakExercise||activeBreakExercise.pauseMode==='offscreen')return;
  const wrap=UI.breakAnimWrap;
  const W=wrap.clientWidth,H=wrap.clientHeight||190;
  const ctx=prepareCanvas(UI.breakCanvas,W,H);
  startAnim(ctx,W,H,activeBreakExercise.anim,false,currentLanguage());
}
async function toggleBreakFullscreen(){
  if(!UI.breakOverlay.classList.contains('active')||breakPending)return;
  if(!document.fullscreenElement){
    try{await UI.breakOverlay.requestFullscreen?.();}catch{}
    UI.breakOverlay.classList.add('immersive');
  }else{
    try{await document.exitFullscreen();}catch{}
    if(!activeBreakLarge)UI.breakOverlay.classList.remove('immersive');
  }
  updateFullscreenButton();
  scheduleAnimationResize();
}
function requestDefaultFullscreen(){
  if(settings.breakDisplayMode!=='fullscreen')return;
  if(document.fullscreenElement||!UI.breakOverlay.requestFullscreen)return;
  UI.breakOverlay.requestFullscreen().then(()=>{
    updateFullscreenButton();
    scheduleAnimationResize();
  }).catch(()=>{
    updateFullscreenButton();
  });
}
function updateFullscreenButton(){
  if(!UI.fullBtn)return;
  if(!document.fullscreenElement&&!activeBreakLarge)UI.breakOverlay.classList.remove('immersive');
  UI.fullBtn.textContent=document.fullscreenElement?t('action.exitFullscreen'):t('action.fullscreen');
}
function catchUpTimers(){
  if(inBreak){
    syncBreakLeft();
    if(breakLeft<=0){completeOrEndBreak();return;}
    updateBreakProgress();
    updateUI();
    return;
  }
  if(running){
    syncWorkLeft();
    const dueKind=getDueReminderKind();
    if(dueKind){queueBreak(dueKind);return;}
  }
  updateUI();
}

// ═══ TIMER ═════════════════════════════════════════════════════
function toggleTimer(){
  if(inBreak)return;
  if(breakPending){startPendingBreak();return;}
  running=!running;
  if(running){
    UI.startBtn.textContent=t('action.pause');
    startWorkTicker();
  }else{
    syncWorkLeft();
    clearReminderDeadlines();
    stopWorkTicker();
    UI.startBtn.textContent=t('action.resume');
    updateUI();
  }
}
function startWorkTicker(){
  stopWorkTicker();
  setReminderDeadlines();
  ticker=setInterval(()=>{
    syncWorkLeft();
    if(breakPending){
      REMINDER_KINDS.filter(kind=>kind!==pendingReminderKind&&reminderLeft[kind]<=0).forEach(kind=>{reminderEndAt[kind]=null;});
      updateUI();
      return;
    }
    const dueKind=getDueReminderKind();
    if(dueKind)queueBreak(dueKind);
    else updateUI();
  },1000);
}
function stopWorkTicker(){
  if(ticker){clearInterval(ticker);ticker=null;}
}
function stopBreakTicker(){
  if(breakTicker){clearInterval(breakTicker);breakTicker=null;}
}
function resetTimer(){
  stopWorkTicker();stopBreakTicker();stopAllAnims();
  running=false;inBreak=false;breakPending=false;breakComplete=false;breakLeft=breakSec;breakTotal=breakSec;
  reminderLeft={ visual:reminderIntervalSeconds('visual'),posture:reminderIntervalSeconds('posture') };
  updateDerivedWorkLeft();
  clearReminderDeadlines();breakEndAt=null;pendingPick=null;pendingReminderKind=null;scheduledDueOpen=false;
  UI.startBtn.textContent=t('action.start');
  UI.breakOverlay.classList.remove('active','pending','complete','immersive','offscreen');
  UI.breakOverlay.setAttribute('aria-hidden','true');
  hideBreakNudge();
  activeBreakExercise=null;activeBreakKind=null;activeBreakLarge=false;
  syncOverlayState();
  updateUI();
}

// ═══ BREAK ═════════════════════════════════════════════════════
function queueBreak(kind=getDueReminderKind()||getNextReminderKind()){
  if(breakPending||inBreak)return;
  if(running)syncWorkLeft();
  if(pendingReminderKind&&pendingReminderKind!==kind)pendingPick=null;
  breakPending=true;pendingReminderKind=kind;workLeft=0;
  reminderEndAt[kind]=null;
  if(!scheduledDueOpen){breaksDue++;scheduledDueOpen=true;}
  pendingPick=pendingPick||selectNextExercise(kind);
  notifyBreakDue(pendingPick.exercise,kind);
  showPendingBreak();
  UI.startBtn.textContent=t('action.startBreak');
  addHistPoint();
  updateUI();
}
function showPendingBreak(){
  const kind=pendingReminderKind||getNextReminderKind();
  const ex=pendingPick?.exercise||getUpcomingExercise(kind);
  UI.nudgeTitle.textContent=t(`nudge.${kind}Title`);
  UI.nudgeExercise.textContent=`${exerciseName(ex)} · ${exText(ex,'tip')}`;
  UI.breakNudge.classList.add('active');
  UI.breakNudge.setAttribute('aria-hidden','false');
  UI.breakNudge.removeAttribute('inert');
}
function hideBreakNudge(){
  UI.breakNudge.classList.remove('active');
  UI.breakNudge.setAttribute('aria-hidden','true');
  UI.breakNudge.setAttribute('inert','');
}
function snoozeBreak(){
  if(!breakPending||inBreak)return;
  syncWorkLeft();
  const kind=pendingReminderKind||'visual';
  breakPending=false;
  running=true;
  reminderLeft[kind]=devMode?2:5*60;
  REMINDER_KINDS.filter(item=>item!==kind&&reminderLeft[item]<=0).forEach(item=>{reminderLeft[item]=OVERLAP_GRACE_SECONDS;});
  updateDerivedWorkLeft();
  hideBreakNudge();
  UI.startBtn.textContent=t('action.pause');
  startWorkTicker();
  updateUI();
}
function startPendingBreak(){
  if(!breakPending)return;
  closePractice();
  const picked=pendingPick;
  const kind=pendingReminderKind||picked?.exercise?.reminderKind||'visual';
  breakPending=false;
  pendingPick=null;pendingReminderKind=null;
  hideBreakNudge();
  startBreak({ picked, kind, countDue:false });
}
function startBreak(options={}){
  const { countDue=true, picked=null } = options;
  const kind=options.kind||picked?.exercise?.reminderKind||getNextReminderKind();
  if(running)syncWorkLeft();
  stopWorkTicker();stopBreakTicker();running=false;inBreak=true;extUsed=false;
  clearReminderDeadlines();
  if(countDue){breaksDue++;scheduledDueOpen=true;}
  const ex=chooseNextExercise(picked,kind);
  const exerciseSeconds=Number.parseInt(ex.dur,10);
  breakComplete=false;breakLeft=breakTotal=devMode?4:(Number.isFinite(exerciseSeconds)?exerciseSeconds:20);
  activeBreakExercise=ex;activeBreakKind=kind;
  setBreakStageMode(ex);
  if(kind==='posture')lastPostureBreakTime=Date.now();
  else{lastVisualBreakTime=Date.now();lastBreakTime=lastVisualBreakTime;}
  breakEndAt=Date.now()+breakLeft*1000;
  const cat=CATS[ex.cat];
  UI.bCat.textContent=catLabel(ex.cat);UI.bCat.style.color=cat.color;
  UI.bSrc.textContent=exText(ex,'source');
  UI.bTitle.textContent=exerciseName(ex);
  UI.bDesc.textContent=exText(ex,'desc');
  UI.bTip.textContent=exText(ex,'tip');
  UI.extBtn.disabled=false;
  UI.endBreakBtn.textContent=t('action.endBreak');
  UI.endBreakBtn.setAttribute('aria-label',t('break.ariaEnd'));
  UI.startBtn.textContent=t('action.breakRunning');
  UI.breakOverlay.classList.remove('complete');
  updateFullscreenButton();
  updateBreakProgress();
  UI.breakOverlay.classList.add('active');
  UI.breakOverlay.setAttribute('aria-hidden','false');
  hideBreakNudge();
  syncOverlayState();
  requestDefaultFullscreen();
  if(ex.pauseMode==='screen'){
    setTimeout(renderBreakAnimation,40);
  }
  breakTicker=setInterval(()=>{
    syncBreakLeft();
    updateBreakProgress();
    if(breakLeft<=0)completeOrEndBreak();
    else updateUI();
  },1000);
}
function startManualBreak(){
  if(inBreak)return;
  if(breakPending){startPendingBreak();return;}
  closePractice();
  const picked=pendingPick;
  const kind=pendingReminderKind||picked?.exercise?.reminderKind||getNextReminderKind();
  pendingPick=null;pendingReminderKind=null;
  startBreak({ picked, kind, countDue:!scheduledDueOpen });
}
function startTestExercise(i){
  openPractice(i,true);
}
function selectNextExercise(kind=getNextReminderKind()){
  const fatigueMinutes=(Date.now()-lastBreakTime)/60000;
  const eligible=getEligibleExercises(kind);
  const queue=exerciseQueues[kind]||exerciseQueues.all;
  return pickExercise({
    exercises:eligible,
    order:queue.order,
    cursor:queue.cursor,
    lastCategory:lastExerciseCat,
    fatigueMinutes,
    missedBreaks:Math.max(0,breaksDue-breaksTaken)
  });
}
function chooseNextExercise(picked,kind=getNextReminderKind()){
  picked=picked||selectNextExercise(kind);
  const queue=exerciseQueues[kind]||exerciseQueues.all;
  queue.order=picked.order;
  queue.cursor=picked.cursor;
  lastExerciseCat=picked.exercise.cat;
  exerciseDiversity.add(picked.exercise.cat);
  return picked.exercise;
}
function endBreak(auto=false){
  if(!inBreak)return;
  stopBreakTicker();stopAllAnims();
  UI.breakOverlay.classList.remove('active','complete','immersive','offscreen');
  UI.breakOverlay.setAttribute('aria-hidden','true');
  if(document.fullscreenElement===UI.breakOverlay)document.exitFullscreen?.().catch(()=>{});
  const completedKind=activeBreakKind||'visual';
  reminderLeft[completedKind]=reminderIntervalSeconds(completedKind);
  REMINDER_KINDS.filter(kind=>kind!==completedKind&&reminderLeft[kind]<=0).forEach(kind=>{reminderLeft[kind]=OVERLAP_GRACE_SECONDS;});
  updateDerivedWorkLeft();
  activeBreakExercise=null;activeBreakKind=null;activeBreakLarge=false;
  breakEndAt=null;scheduledDueOpen=false;
  inBreak=false;breakComplete=false;breaksTaken++;running=true;
  syncOverlayState();
  UI.startBtn.textContent=t('action.pause');
  UI.endBreakBtn.textContent=t('action.endBreak');
  UI.endBreakBtn.setAttribute('aria-label',t('break.ariaEnd'));
  if(auto)notifyBreakEnd();
  startWorkTicker();
  addHistPoint();updateUI();
}
function completeOrEndBreak(){
  if(settings.exitMode==='auto'){endBreak(true);return;}
  completeBreakTimer();
}
function completeBreakTimer(){
  if(breakComplete)return;
  breakComplete=true;breakLeft=0;breakEndAt=null;
  stopBreakTicker();
  UI.breakOverlay.classList.add('complete');
  UI.brTxt.textContent='✓';
  UI.brProg.setAttribute('stroke-dashoffset','213.6');
  UI.extBtn.disabled=true;
  UI.endBreakBtn.textContent=getBreakCompleteLabel();
  UI.endBreakBtn.setAttribute('aria-label',t('break.ariaReady'));
  UI.endBreakBtn.focus();
  notifyBreakReadyToEnd();
  updateUI();
}
function extendBreak(){
  if(extUsed||breakComplete)return;
  extUsed=true;
  syncBreakLeft();
  breakTotal+=30;
  breakEndAt=(breakEndAt||Date.now()+breakLeft*1000)+30000;
  syncBreakLeft();
  UI.extBtn.disabled=true;
  updateBreakProgress();
  updateUI();
}

// ═══ PRACTICE MODAL ════════════════════════════════════════════
function openPractice(i,testMode=false){
  const ex=EX[i];const cat=CATS[ex.cat];
  practiceReturnFocus=document.activeElement;
  activePracticeExercise=ex;
  UI.pmSource.textContent=`${catLabel(ex.cat)} · ${exText(ex,'source')}${ex.evidence?' · '+t('practice.evidence')+evidenceText(ex.evidence):''}`;
  UI.pmName.textContent=exerciseName(ex);
  UI.pmDur.textContent=ex.dur;
  UI.pmDesc.textContent=exText(ex,'desc');
  UI.pmTip.textContent=`${exText(ex,'tip')} ${ex.contraindications ? t('practice.caution')+t('exercise.contra') : ''}`;
  UI.pModal.classList.toggle('test',testMode);
  UI.pModal.classList.toggle('offscreen',ex.pauseMode==='offscreen');
  UI.pmOffscreenIcon.textContent=ex.ico;
  UI.pModal.classList.add('active');
  UI.pModal.setAttribute('aria-hidden','false');
  syncOverlayState();
  if(ex.pauseMode!=='offscreen')setTimeout(renderPracticeAnimation,40);
  UI.pModal.querySelector('[data-action="close-practice"]')?.focus();
}
function renderPracticeAnimation(){
  if(!activePracticeExercise||activePracticeExercise.pauseMode==='offscreen'||!UI.pModal.classList.contains('active'))return;
  const width=UI.pmCanvas.offsetWidth,height=UI.pmCanvas.offsetHeight;
  const ctx=prepareCanvas(UI.pmCanvas,width,height);
  startAnim(ctx,width,height,activePracticeExercise.anim,true,currentLanguage());
}
function closePractice(){
  if(!UI.pModal.classList.contains('active'))return;
  stopAllAnims();
  clearTimeout(practiceResizeTimer);
  activePracticeExercise=null;
  UI.pModal.classList.remove('active','test','offscreen');
  UI.pModal.setAttribute('aria-hidden','true');
  syncOverlayState();
  restoreFocus(practiceReturnFocus);
  practiceReturnFocus=null;
}

// ═══ DEV MODE ══════════════════════════════════════════════════
function toggleDev(){
  devMode=!devMode;
  visualSec=settings.visualIntervalMinutes*60;
  postureSec=settings.postureIntervalMinutes*60;
  workSec=visualSec;
  breakSec=devMode?4:20;
  UI.devBtn.classList.toggle('on',devMode);
  UI.devBadge.classList.toggle('show',devMode);
  UI.devBadgeTimer.style.display=devMode?'inline-block':'none';
  resetTimer();
}

// ═══ CHART ═════════════════════════════════════════════════════
function resizeChartCanvas(){
  const canvas=UI.histChart;
  const ratio=Math.min(window.devicePixelRatio||1,2);
  const width=Math.max(1,canvas.clientWidth);
  const height=Math.max(1,canvas.clientHeight);
  const targetWidth=Math.round(width*ratio);
  const targetHeight=Math.round(height*ratio);
  if(canvas.width!==targetWidth||canvas.height!==targetHeight){
    canvas.width=targetWidth;
    canvas.height=targetHeight;
  }
  const ctx=canvas.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0);
  return { ctx, width, height };
}
function drawChart(){
  if(!chart)return;
  const { ctx, width, height }=resizeChartCanvas();
  const padX=14,padY=12,plotW=Math.max(1,width-padX*2),plotH=Math.max(1,height-padY*2);
  ctx.clearRect(0,0,width,height);
  ctx.lineWidth=1;
  ctx.strokeStyle='rgba(255,255,255,.045)';
  [0,25,50,75,100].forEach(value=>{
    const y=padY+(100-value)/100*plotH;
    ctx.beginPath();
    ctx.moveTo(padX,y);
    ctx.lineTo(width-padX,y);
    ctx.stroke();
  });
  if(!scoreHistory.length){
    UI.chartMeta.textContent=t('chart.empty');
    return;
  }
  const points=scoreHistory.map((item,index)=>{
    const x=padX+(scoreHistory.length===1?0.5:index/(scoreHistory.length-1))*plotW;
    const y=padY+(100-Math.max(0,Math.min(100,item.s)))/100*plotH;
    return { x,y,s:item.s };
  });
  const current=points[points.length-1];
  const color=scoreColor(current.s);
  const fill=ctx.createLinearGradient(0,padY,0,height-padY);
  fill.addColorStop(0,'rgba(40,212,180,.16)');
  fill.addColorStop(1,'rgba(40,212,180,0)');
  if(points.length>1){
    ctx.beginPath();
    ctx.moveTo(points[0].x,height-padY);
    points.forEach(point=>ctx.lineTo(point.x,point.y));
    ctx.lineTo(current.x,height-padY);
    ctx.closePath();
    ctx.fillStyle=fill;
    ctx.fill();
    ctx.beginPath();
    points.forEach((point,index)=>{
      if(index===0)ctx.moveTo(point.x,point.y);
      else ctx.lineTo(point.x,point.y);
    });
    ctx.strokeStyle=color;
    ctx.lineWidth=2;
    ctx.lineJoin='round';
    ctx.lineCap='round';
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(current.x,current.y,3.5,0,Math.PI*2);
  ctx.fillStyle=color;
  ctx.fill();
  UI.chartMeta.textContent=scoreHistory.length+t('chart.points')+current.s;
}
function initChart(){
  chart={ ready:true };
  drawChart();
  window.addEventListener('resize',()=>{
    clearTimeout(chartResizeTimer);
    chartResizeTimer=setTimeout(drawChart,120);
  });
}
function addHistPoint(){
  const now=new Date(),lbl=now.getHours()+':'+String(now.getMinutes()).padStart(2,'0'),s=Math.round(smoothScore);
  if(lbl===lastHistMinute)return;
  lastHistMinute=lbl;
  scoreHistory.push({t:lbl,s});if(scoreHistory.length>60)scoreHistory.shift();saveHistory(scoreHistory);
  drawChart();
}
function resetSession(){
  if(!confirm(t('reset.confirm')))return;
  scoreHistory=[];saveHistory(scoreHistory);breaksTaken=0;breaksDue=0;sessionStart=Date.now();
  smoothScore=100;lastBreakTime=Date.now();lastVisualBreakTime=lastBreakTime;lastPostureBreakTime=lastBreakTime;resetExerciseQueues();exerciseDiversity=new Set();lastExerciseCat=null;
  drawChart();
  resetTimer();
}

// ═══ INIT ══════════════════════════════════════════════════════
registerServiceWorker();
bindActions();
renderExerciseLibrary();
renderSettings();
applyLanguage();
initChart();
handleLaunchAction();
updateNotificationButton();
setInterval(()=>{updateUI();if(running||inBreak)addHistPoint();},60000);
setInterval(updateUI,3000);
updateUI();
})();
