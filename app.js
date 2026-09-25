(() => {
const { CATS, EX } = window.VisuData;
const { startAnim, stopAllAnims } = window.VisuAnimations;
const { reminderProgress, secondsUntil, rhythmState } = window.VisuRhythm;
const { pickExercise, shuffleIndices } = window.VisuSelector;
const {
  loadActivity, appendActivityEvent, clearLegacyHistory,
  loadTimerState, saveTimerState, clearTimerState,
  loadSettings, saveSettings
} = window.VisuStorage;
const { UI_TEXT, CAT_TEXT, EVIDENCE_TEXT, EX_TEXT } = window.VisuI18n;

const NOTIFY_PREF_KEY='vp_notify_enabled';
const BASE_TITLE=document.title;
const SERVICE_WORKER_PATH='service-worker.js';
const BACKGROUND_TIMER_PATH='src/background-timer.js?v=20';
const REMINDER_KINDS=['visual','posture'];
const INTERVAL_LIMITS={
  visual:{ min:10,max:30,step:5 },
  posture:{ min:30,max:90,step:15 }
};
const OVERLAP_GRACE_SECONDS=5*60;
const REMINDER_REPEAT_MS=10*60*1000;
const NOTIFICATION_READY_TIMEOUT_MS=2500;
const IDLE_THRESHOLD_MS=3*60*1000;
const TIMER_STATE_VERSION=1;
const TIMER_STATE_MAX_AGE_MS=7*24*60*60*1000;
const SETTINGS_VERSION=4;
const DEFAULT_ENABLED_CATEGORIES=[...new Set(EX.filter(ex=>ex.defaultEnabled).map(ex=>ex.cat))];
const DEFAULT_DISABLED_EXERCISES=EX.filter(ex=>!ex.defaultEnabled).map(ex=>ex.id);
const DEFAULT_SETTINGS={
  enabledCategories:DEFAULT_ENABLED_CATEGORIES,
  disabledExercises:DEFAULT_DISABLED_EXERCISES,
  exitMode:'manual',
  idleDetectionEnabled:true,
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
  exContainer:$('exContainer'), arcVisual:$('arcVisual'), arcPosture:$('arcPosture'),
  rhythmValue:$('rhythmValue'), rhythmStatus:$('rhythmStatus'), mBreak:$('mBreak'),
  mBreakSub:$('mBreakSub'), mFatigue:$('mFatigue'), mFatigueBar:$('mFatigueBar'), mFatigueSub:$('mFatigueSub'),
  timerDisp:$('timerDisp'), startBtn:$('startBtn'), sTime:$('sTime'), sNatural:$('sNatural'), sBreaks:$('sBreaks'),
  sExercise:$('sExercise'), breakOverlay:$('breakOverlay'), bCat:$('bCat'), bSrc:$('bSrc'), bTitle:$('bTitle'),
  bDesc:$('bDesc'), bTip:$('bTip'), extBtn:$('extBtn'), brTxt:$('brTxt'), brProg:$('brProg'),
  breakAnimWrap:$('breakAnimWrap'), breakCanvas:$('breakCanvas'), pModal:$('pModal'), pmCanvas:$('pmCanvas'),
  pmSource:$('pmSource'), pmName:$('pmName'), pmDur:$('pmDur'), pmDesc:$('pmDesc'), pmTip:$('pmTip'),
  activityList:$('activityList'), chartMeta:$('chartMeta'), exSectionTitle:$('exSectionTitle'), coachLevel:$('coachLevel'),
  coachTitle:$('coachTitle'), coachCopy:$('coachCopy'), coachNextIcon:$('coachNextIcon'),
  coachNextText:$('coachNextText'), coachBreakBtn:$('coachBreakBtn'), notifyBtn:$('notifyBtn'),
  settingsBtn:$('settingsBtn'),
  settingsModal:$('settingsModal'), categorySettings:$('categorySettings'), exerciseSettings:$('exerciseSettings'),
  settingsSummary:$('settingsSummary'), exitModeSettings:$('exitModeSettings'),
  idleDetectionSettings:$('idleDetectionSettings'), idleDetectionStatus:$('idleDetectionStatus'),
  languageSettings:$('languageSettings'), endBreakBtn:$('endBreakBtn'),
  visualIntervalRange:$('visualIntervalRange'), visualIntervalValue:$('visualIntervalValue'),
  postureIntervalRange:$('postureIntervalRange'), postureIntervalValue:$('postureIntervalValue'),
  breakNudge:$('breakNudge'), nudgeExercise:$('nudgeExercise'), offscreenCue:$('offscreenCue'),
  nudgeTitle:document.querySelector('#breakNudge strong'), timerNext:$('timerNext'),
  offscreenIcon:$('offscreenIcon'), offscreenCueTitle:$('offscreenCueTitle'), offscreenCueDetail:$('offscreenCueDetail'),
  pmOffscreen:$('pmOffscreen'), pmOffscreenIcon:$('pmOffscreenIcon'), pmOffscreenText:$('pmOffscreenText')
};

// ═══ STATE ═════════════════════════════════════════════════════
let visualSec=DEFAULT_SETTINGS.visualIntervalMinutes*60,postureSec=DEFAULT_SETTINGS.postureIntervalMinutes*60,workSec=visualSec,breakSec=20;
let reminderLeft={ visual:visualSec,posture:postureSec };
let reminderEndAt={ visual:null,posture:null };
let workLeft=Math.min(reminderLeft.visual,reminderLeft.posture),breakLeft=breakSec,breakTotal=breakSec;
let breakEndAt=null;
let running=false,inBreak=false,breakPending=false,breakComplete=false,timerPaused=false;
let visualBreaksTaken=0,postureBreaksTaken=0,naturalBreaksTaken=0;
let exerciseQueues={ visual:{ order:[],cursor:0 },posture:{ order:[],cursor:0 },all:{ order:[],cursor:0 } };
let extUsed=false;
let ticker=null,breakTicker=null;
let sessionId=Date.now(),sessionStarted=false,activityLog=loadActivity();
let lastBreakTime=Date.now();
let activeTrackedMs=0,activeTrackingStartedAt=null;
let lastExerciseCat=null,pendingPick=null;
let notificationsEnabled=loadNotificationPreference(),titleTimer=null;
let activeBreakExercise=null,activeBreakKind=null,activeBreakSource='manual',resizeTimer=null;
let activePracticeExercise=null,practiceResizeTimer=null;
let practiceReturnFocus=null,settingsReturnFocus=null;
let pendingReminderKind=null;
let pendingRepeatAt=null,pendingAcknowledged=false;
let pendingReminderId=null,pendingNotificationChannel=null;
let lockedAt=null,lockTimer=null;
let idleDetector=null,idleController=null,idlePaused=false,idleStartedAt=null,resumeAfterIdle=false,idlePermissionState='unknown';
let backgroundTimerWorker=null,restoredTimerState=false;
let settings=normalizeSettings(loadSettings());
clearLegacyHistory();
saveSettings(settings);
let serviceWorkerReady=null;
visualSec=settings.visualIntervalMinutes*60;
postureSec=settings.postureIntervalMinutes*60;
workSec=visualSec;
reminderLeft={ visual:visualSec,posture:postureSec };
workLeft=Math.min(reminderLeft.visual,reminderLeft.posture);
resetExerciseQueues();
restoredTimerState=restoreTimerSnapshot(loadTimerState());

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
    view:raw.view==='expert'?'expert':'simple',
    theme:['light','dark'].includes(raw.theme)?raw.theme:'system',
    palette:['orange','violet','blue'].includes(raw.palette)?raw.palette:'mint',
    idleDetectionEnabled:raw.idleDetectionEnabled!==false,
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
function finiteTimestamp(value,fallback=null){
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>0?parsed:fallback;
}
function boundedCount(value){
  const parsed=Math.round(Number(value)||0);
  return Math.min(100000,Math.max(0,parsed));
}
function persistTimerSnapshot(){
  if(!sessionStarted&&!running&&!inBreak&&!breakPending&&!idlePaused){
    clearTimerState();
    return;
  }
  if(running&&!inBreak)syncWorkLeft();
  if(inBreak)syncBreakLeft();
  syncActiveTracking();
  saveTimerState({
    version:TIMER_STATE_VERSION,
    savedAt:Date.now(),
    running,inBreak,breakPending,breakComplete,timerPaused,sessionStarted,
    reminderLeft:{ ...reminderLeft },
    reminderEndAt:{ ...reminderEndAt },
    breakLeft,breakTotal,breakEndAt,
    pendingReminderKind,pendingReminderId,pendingNotificationChannel,
    pendingRepeatAt,
    pendingAcknowledged,
    activeBreakExerciseId:activeBreakExercise?.id||null,
    activeBreakKind,
    activeBreakSource,
    extUsed,
    visualBreaksTaken,postureBreaksTaken,naturalBreaksTaken,
    sessionId,lastBreakTime,activeTrackedMs,activeTrackingStartedAt,
    idlePaused,idleStartedAt,resumeAfterIdle
  });
}
function restoreTimerSnapshot(snapshot){
  const now=Date.now();
  if(!snapshot||snapshot.version!==TIMER_STATE_VERSION){
    if(snapshot)clearTimerState();
    return false;
  }
  const savedAt=finiteTimestamp(snapshot.savedAt);
  if(!savedAt||savedAt>now+60000||now-savedAt>TIMER_STATE_MAX_AGE_MS){
    clearTimerState();
    return false;
  }
  const visualLeft=Math.min(visualSec,Math.max(0,Math.round(Number(snapshot.reminderLeft?.visual)||0)));
  const postureLeft=Math.min(postureSec,Math.max(0,Math.round(Number(snapshot.reminderLeft?.posture)||0)));
  running=Boolean(snapshot.running);
  inBreak=Boolean(snapshot.inBreak);
  breakPending=Boolean(snapshot.breakPending)&&!inBreak;
  breakComplete=Boolean(snapshot.breakComplete)&&inBreak;
  timerPaused=Boolean(snapshot.timerPaused)&&!running&&!inBreak&&!breakPending;
  sessionStarted=Boolean(snapshot.sessionStarted)||running||inBreak||breakPending;
  reminderLeft={ visual:visualLeft,posture:postureLeft };
  reminderEndAt={ visual:null,posture:null };
  if(running&&!inBreak){
    REMINDER_KINDS.forEach(kind=>{
      const deadline=finiteTimestamp(snapshot.reminderEndAt?.[kind]);
      reminderEndAt[kind]=deadline;
      if(deadline)reminderLeft[kind]=secondsUntil(deadline,now);
    });
  }
  pendingReminderKind=REMINDER_KINDS.includes(snapshot.pendingReminderKind)?snapshot.pendingReminderKind:null;
  pendingReminderId=typeof snapshot.pendingReminderId==='string'?snapshot.pendingReminderId:null;
  pendingNotificationChannel=snapshot.pendingNotificationChannel==='system'?'system':null;
  if(breakPending){
    pendingReminderKind=pendingReminderKind||getNextReminderKind();
    pendingPick=selectNextExercise(pendingReminderKind);
  }
  pendingRepeatAt=finiteTimestamp(snapshot.pendingRepeatAt);
  pendingAcknowledged=Boolean(snapshot.pendingAcknowledged);
  const restoredExercise=EX.find(ex=>ex.id===snapshot.activeBreakExerciseId)||null;
  if(inBreak&&!restoredExercise){
    inBreak=false;
    breakComplete=false;
  }
  if(inBreak)running=false;
  activeBreakExercise=inBreak?restoredExercise:null;
  activeBreakKind=inBreak&&REMINDER_KINDS.includes(snapshot.activeBreakKind)?snapshot.activeBreakKind:null;
  activeBreakSource=['scheduled','manual'].includes(snapshot.activeBreakSource)?snapshot.activeBreakSource:'manual';
  breakTotal=Math.max(1,Math.round(Number(snapshot.breakTotal)||breakSec));
  breakEndAt=inBreak&&!breakComplete?finiteTimestamp(snapshot.breakEndAt):null;
  breakLeft=inBreak?(breakEndAt?secondsUntil(breakEndAt,now):Math.max(0,Math.round(Number(snapshot.breakLeft)||0))):breakSec;
  extUsed=Boolean(snapshot.extUsed);
  visualBreaksTaken=boundedCount(snapshot.visualBreaksTaken);
  postureBreaksTaken=boundedCount(snapshot.postureBreaksTaken);
  naturalBreaksTaken=boundedCount(snapshot.naturalBreaksTaken);
  sessionId=finiteTimestamp(snapshot.sessionId,now);
  lastBreakTime=finiteTimestamp(snapshot.lastBreakTime,now);
  activeTrackedMs=Math.max(0,Number(snapshot.activeTrackedMs)||0);
  activeTrackingStartedAt=running&&!inBreak?finiteTimestamp(snapshot.activeTrackingStartedAt,now):null;
  idlePaused=Boolean(snapshot.idlePaused)&&!inBreak;
  idleStartedAt=idlePaused?finiteTimestamp(snapshot.idleStartedAt,savedAt):null;
  resumeAfterIdle=idlePaused&&Boolean(snapshot.resumeAfterIdle);
  if(idlePaused){running=false;activeTrackingStartedAt=null;}
  updateDerivedWorkLeft();
  return true;
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
  renderActivityJournal();
  updateUI();
  persistTimerSnapshot();
}
function applyAppearance(){
  const dark=settings.theme==='dark'||(settings.theme==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme=dark?'dark':'light';
  document.documentElement.dataset.palette=settings.palette;
  document.body.dataset.view=settings.view;
  document.querySelector('meta[name="theme-color"]').content=dark?'#16212a':'#f4f7fa';
  ['view','theme','palette'].forEach(key=>{
    document.querySelectorAll(`[data-action="set-${key}"]`).forEach(button=>{
      const selected=button.dataset.value===settings[key];
      button.classList.toggle('active',selected);
      button.setAttribute('aria-pressed',String(selected));
    });
  });
}
function setAppearance(key,value){
  settings[key]=value;
  settings=normalizeSettings(settings);
  saveSettings(settings);
  applyAppearance();
  if(key==='view'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    document.querySelector('main').animate([{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:240,easing:'ease-out'});
  }
}
function syncSimpleControls(){
  const button=$('simpleStartBtn');
  button.textContent=UI.startBtn.textContent;
  button.disabled=UI.startBtn.disabled;
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
function applyLanguage(){
  document.documentElement.lang=currentLanguage();
  document.querySelectorAll('[data-i18n]').forEach(node=>{node.textContent=t(node.dataset.i18n);});
  document.querySelectorAll('[data-i18n-aria-label]').forEach(node=>{node.setAttribute('aria-label',t(node.dataset.i18nAriaLabel));});
  if(UI.settingsBtn)UI.settingsBtn.textContent='⚙ '+t('settings.title');
  if(UI.extBtn)UI.extBtn.textContent='+ 30 sec';
  if(!inBreak&&!breakPending&&UI.startBtn)UI.startBtn.textContent=running?t('action.pause'):timerPaused?t('action.resume'):t('action.start');
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
  UI.idleDetectionSettings.querySelectorAll('[data-mode]').forEach(btn=>{
    btn.classList.toggle('active',(btn.dataset.mode==='on')===settings.idleDetectionEnabled);
  });
  const idleSupported='IdleDetector' in window&&window.isSecureContext;
  UI.idleDetectionSettings.querySelector('[data-mode="on"]').disabled=!idleSupported;
  UI.idleDetectionStatus.textContent=!idleSupported
    ? t('settings.idleUnavailable')
    : idleDetector?t('settings.idleActive')
      : idlePermissionState==='denied'?t('settings.idleDenied')
        : settings.idleDetectionEnabled?t('settings.idleReady'):t('settings.idleOff');
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
        'reset-session':resetSession,'toggle-timer':toggleTimer,
        'reset-timer':resetTimer,'extend-break':extendBreak,'end-break':endBreak,
        'close-practice':closePractice,'start-break-now':startManualBreak,
        'register-natural-break':()=>registerNaturalBreak({ source:'manual' }),
        'snooze-break':snoozeBreak,
        'toggle-notifications':toggleNotifications,'confirm-break-start':startPendingBreak,
        'open-settings':openSettings,
        'close-settings':closeSettings,'reset-exercise-settings':resetExerciseSettings,
        'set-view':()=>setAppearance('view',actionTarget.dataset.value),
        'set-theme':()=>setAppearance('theme',actionTarget.dataset.value),
        'set-palette':()=>setAppearance('palette',actionTarget.dataset.value),
        'set-exit-mode':()=>setExitMode(actionTarget.dataset.mode),
        'set-idle-detection':()=>setIdleDetection(actionTarget.dataset.mode),
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
  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('freeze', handleLifecycleFreeze);
  document.addEventListener('resume', handleLifecycleWake);
  window.addEventListener('focus', handleLifecycleWake);
  window.addEventListener('pageshow', handleLifecycleWake);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('resize', scheduleAnimationResize);
  document.addEventListener('visibilitychange', clearTitleAnnouncement);
}

function backgroundHeartbeatNeeded(){
  return document.hidden&&!idlePaused&&(running||inBreak||breakPending);
}
function stopBackgroundHeartbeat(){
  if(!backgroundTimerWorker)return;
  try{backgroundTimerWorker.postMessage({ type:'STOP' });}
  catch{}
  backgroundTimerWorker.terminate();
  backgroundTimerWorker=null;
}
function syncBackgroundHeartbeat(){
  if(!backgroundHeartbeatNeeded()){
    stopBackgroundHeartbeat();
    return;
  }
  if(backgroundTimerWorker||!('Worker' in window))return;
  try{
    backgroundTimerWorker=new Worker(BACKGROUND_TIMER_PATH);
    backgroundTimerWorker.addEventListener('message',event=>{
      if(event.data?.type==='VISUPAUSE_TIMER_TICK')catchUpTimers();
    });
    backgroundTimerWorker.addEventListener('error',stopBackgroundHeartbeat,{ once:true });
    backgroundTimerWorker.postMessage({ type:'START',intervalMs:1000 });
  }catch{
    stopBackgroundHeartbeat();
  }
}
function handleVisibilityChange(){
  if(!document.hidden){
    handleLifecycleWake();
    return;
  }
  catchUpTimers();
  persistTimerSnapshot();
  syncBackgroundHeartbeat();
}
function suspendTimerSchedulers(){
  stopBackgroundHeartbeat();
  stopWorkTicker();
  stopBreakTicker();
}
function handleLifecycleFreeze(){
  catchUpTimers();
  persistTimerSnapshot();
  suspendTimerSchedulers();
}
function handlePageHide(event){
  catchUpTimers();
  persistTimerSnapshot();
  if(event.persisted)suspendTimerSchedulers();
}
function handleLifecycleWake(){
  stopBackgroundHeartbeat();
  catchUpTimers();
  if(running&&!inBreak&&!ticker)startWorkTicker({ preserveDeadlines:true });
  if(inBreak&&!breakComplete&&!breakTicker)startBreakTicker();
  maybeRepeatPendingReminder();
  persistTimerSnapshot();
  syncBackgroundHeartbeat();
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
  if(!value){
    closeDueNotifications();
    if(breakPending){pendingNotificationChannel='fallback';showPendingBreak();}
  }
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
async function getNotificationRegistration(){
  if(!('serviceWorker' in navigator))return null;
  try{
    const current=await navigator.serviceWorker.getRegistration();
    if(current?.active)return current;
  }catch{}
  if(!serviceWorkerReady)return null;
  let timeoutId=null;
  try{
    return await Promise.race([
      serviceWorkerReady,
      new Promise(resolve=>{timeoutId=setTimeout(()=>resolve(null),NOTIFICATION_READY_TIMEOUT_MS);})
    ]);
  }finally{
    if(timeoutId!==null)clearTimeout(timeoutId);
  }
}
async function sendNotification(title,body,tag,data={}){
  if(!notificationsEnabled||notificationStatus()!=='granted')return false;
  const options={
    body,
    tag,
    renotify:true,
    requireInteraction:true,
    icon:'icons/icon-192.png',
    badge:'icons/icon-192.png',
    data:{ url:'./index.html',...data }
  };
  const isReminder=tag==='visupause-break-due';
  if(isReminder){
    if('maxActions' in Notification&&Notification.maxActions<2)return false;
    options.actions=[
      { action:'start-break',title:t('notify.startBreak') },
      { action:'snooze',title:t('nudge.snooze') }
    ];
  }
  const registration=await getNotificationRegistration();
  if(isReminder&&(!notificationsEnabled||!breakPending||data.reminderId!==pendingReminderId||idlePaused))return false;
  if(registration&&registration.showNotification){
    try{
      await registration.showNotification(title,options);
      if(isReminder&&(!notificationsEnabled||!breakPending||data.reminderId!==pendingReminderId||idlePaused)){
        const notices=await registration.getNotifications({ tag });
        notices.filter(notice=>notice.data?.reminderId===data.reminderId).forEach(notice=>notice.close());
        return false;
      }
      if(navigator.vibrate)navigator.vibrate([180,80,180]);
      return true;
    }catch{}
  }
  // A reminder without system action buttons uses only the in-app fallback.
  if(isReminder)return false;
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
  if(data.tag==='visupause-break-due'){
    if(!breakPending||idlePaused)return;
    if(data.reminderId&&data.reminderId!==pendingReminderId)return;
    if(data.reminderKind&&data.reminderKind!==pendingReminderKind)return;
    if(data.action==='snooze')snoozeBreak();
    else startPendingBreak();
    return;
  }
  catchUpTimers();
  updateUI();
  persistTimerSnapshot();
}
function handleLaunchAction(){
  if(!location.hash.startsWith('#pause-due='))return;
  const params=new URLSearchParams(location.hash.slice(1));
  const requestedKind=params.get('pause-due');
  const launchKind=REMINDER_KINDS.includes(requestedKind)?requestedKind:'visual';
  history.replaceState(null,'',location.pathname+location.search);
  if(!restoredTimerState&&!inBreak&&!breakPending){
    stopWorkTicker();
    running=false;
    clearReminderDeadlines();
    reminderLeft[launchKind]=0;
    workLeft=0;
    sessionStarted=true;
    pendingReminderKind=launchKind;
    pendingReminderId=params.get('id');
    pendingPick=selectNextExercise(pendingReminderKind);
    breakPending=true;
  }
  handleNotificationClick({
    tag:'visupause-break-due',reminderKind:launchKind,
    reminderId:params.get('id'),action:params.get('action')
  });
}
function announceInTitle(text){
  clearTimeout(titleTimer);
  document.title=text;
  titleTimer=setTimeout(clearTitleAnnouncement,9000);
}
function clearTitleAnnouncement(){
  if(!document.hidden)document.title=BASE_TITLE;
}
async function notifyBreakDue(ex,kind){
  announceInTitle(t('title.breakReady'));
  const reminderId=pendingReminderId;
  pendingNotificationChannel='sending';
  hideBreakNudge();
  const delivered=await sendNotification(t('notify.breakDueTitle'), `${exerciseName(ex)}. ${t('notify.breakDueBody')}`, 'visupause-break-due', { reminderKind:kind,reminderId });
  if(!breakPending||pendingReminderId!==reminderId||idlePaused)return;
  pendingNotificationChannel=delivered?'system':'fallback';
  showPendingBreak();
  persistTimerSnapshot();
}
function schedulePendingReminderRepeat(){
  pendingAcknowledged=false;
  pendingRepeatAt=Date.now()+REMINDER_REPEAT_MS;
}
function clearPendingReminderAttention(){
  pendingRepeatAt=null;
  pendingAcknowledged=false;
  pendingNotificationChannel=null;
  UI.breakNudge.classList.remove('realert');
}
function maybeRepeatPendingReminder(){
  if(!breakPending||idlePaused||pendingAcknowledged||!pendingRepeatAt||Date.now()<pendingRepeatAt)return false;
  pendingAcknowledged=true;
  const kind=pendingReminderKind||getNextReminderKind();
  const ex=pendingPick?.exercise||getUpcomingExercise(kind);
  showPendingBreak();
  UI.breakNudge.classList.remove('realert');
  void UI.breakNudge.offsetWidth;
  UI.breakNudge.classList.add('realert');
  notifyBreakDue(ex,kind);
  persistTimerSnapshot();
  return true;
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
async function setIdleDetection(mode){
  settings.idleDetectionEnabled=mode==='on';
  if(!settings.idleDetectionEnabled){
    stopIdleDetection();
    if(idlePaused)finishIdlePause();
    persistSettings();
    return;
  }
  await ensureIdleDetection(true);
  persistSettings();
}
function stopIdleDetection(){
  clearTimeout(lockTimer);
  lockTimer=null;lockedAt=null;
  idleController?.abort();
  idleController=null;
  idleDetector=null;
}
async function ensureIdleDetection(requestPermission=false){
  if(!settings.idleDetectionEnabled||idleDetector)return Boolean(idleDetector);
  if(!('IdleDetector' in window)||!window.isSecureContext){
    idlePermissionState='unavailable';
    renderSettings();
    return false;
  }
  try{
    if(requestPermission){
      idlePermissionState=await window.IdleDetector.requestPermission();
      if(idlePermissionState!=='granted'){
        renderSettings();
        return false;
      }
    }
    idleController=new AbortController();
    idleDetector=new window.IdleDetector();
    idleDetector.addEventListener('change',handleIdleChange);
    await idleDetector.start({ threshold:IDLE_THRESHOLD_MS,signal:idleController.signal });
    idlePermissionState='granted';
    renderSettings();
    return true;
  }catch(error){
    stopIdleDetection();
    idlePermissionState=error?.name==='NotAllowedError'?'denied':'unavailable';
    renderSettings();
    return false;
  }
}
function handleIdleChange(){
  clearTimeout(lockTimer);
  lockTimer=null;
  if(idleDetector.screenState==='locked'){
    if(lockedAt===null)lockedAt=Date.now();
    if(idleDetector.userState==='idle')beginIdlePause();
    else if(Date.now()-lockedAt>=IDLE_THRESHOLD_MS)beginIdlePause(lockedAt);
    else lockTimer=setTimeout(()=>beginIdlePause(lockedAt),IDLE_THRESHOLD_MS-(Date.now()-lockedAt));
  }else{
    // Timers can be suspended while locked: qualify the absence on unlock too.
    if(lockedAt!==null&&Date.now()-lockedAt>=IDLE_THRESHOLD_MS)beginIdlePause(lockedAt);
    lockedAt=null;
    if(idleDetector.userState==='idle')beginIdlePause();
    else finishIdlePause();
  }
}
function beginIdlePause(idleBeganAt=Date.now()-IDLE_THRESHOLD_MS){
  if(idlePaused||inBreak||(!running&&!breakPending))return;
  syncWorkLeft();
  if(activeTrackingStartedAt!==null){
    activeTrackedMs+=Math.max(0,idleBeganAt-activeTrackingStartedAt);
    activeTrackingStartedAt=null;
  }
  resumeAfterIdle=running||breakPending;
  running=false;
  idlePaused=true;
  idleStartedAt=idleBeganAt;
  hideBreakNudge();
  closeDueNotifications();
  clearReminderDeadlines();
  stopWorkTicker();
  UI.startBtn.textContent=t('action.away');
  updateUI();
  persistTimerSnapshot();
  syncBackgroundHeartbeat();
}
function finishIdlePause(){
  if(!idlePaused)return;
  const durationSeconds=Math.max(0,Math.round((Date.now()-(idleStartedAt||Date.now()))/1000));
  const shouldResume=resumeAfterIdle;
  idlePaused=false;
  idleStartedAt=null;
  resumeAfterIdle=false;
  registerNaturalBreak({ source:'idle',durationSeconds,resume:shouldResume });
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
  const nextSeconds=settings[settingKey]*60;
  const elapsed=Math.max(0,previousSeconds-previousLeft);
  if(kind==='posture')postureSec=nextSeconds;
  else{visualSec=nextSeconds;workSec=nextSeconds;}
  if(!inBreak&&!breakPending){
    reminderLeft[kind]=Math.max(0,nextSeconds-elapsed);
    updateDerivedWorkLeft();
    if(running)setReminderDeadlines();
  }
  persistSettings();
  const dueKind=getDueReminderKind();
  if(running&&!inBreak&&!breakPending&&dueKind){
    closeSettings();
    queueBreak(dueKind);
  }
}
function setLanguage(language){
  settings.language=language==='en'?'en':'fr';
  persistSettings();
}

// ═══ SESSION RHYTHM ════════════════════════════════════════════
function setArc(node,circ,pct){node.setAttribute('stroke-dashoffset',(circ*(1-Math.max(0,Math.min(1,pct)))).toFixed(1));}
function syncActiveTracking(now=Date.now()){
  const active=running&&!inBreak&&!idlePaused;
  if(active&&activeTrackingStartedAt===null)activeTrackingStartedAt=now;
  if(!active&&activeTrackingStartedAt!==null){
    activeTrackedMs+=Math.max(0,now-activeTrackingStartedAt);
    activeTrackingStartedAt=null;
  }
}
function getActiveTrackedMs(){
  syncActiveTracking();
  return activeTrackedMs+(activeTrackingStartedAt===null?0:Math.max(0,Date.now()-activeTrackingStartedAt));
}
function recordActivity(kind,source,durationSeconds){
  const event={ at:Date.now(),kind,source,durationSeconds,sessionId };
  activityLog=appendActivityEvent(activityLog,event);
  renderActivityJournal();
}
function isToday(timestamp){
  const date=new Date(timestamp),today=new Date();
  return date.getFullYear()===today.getFullYear()&&date.getMonth()===today.getMonth()&&date.getDate()===today.getDate();
}
function todayActivity(){return activityLog.filter(event=>isToday(event.at));}
function getUpcomingExercise(kind=getNextReminderKind()){
  const eligible=getEligibleExercises(kind);
  const queue=exerciseQueues[kind]||exerciseQueues.all;
  return eligible[queue.order[queue.cursor%eligible.length]]||eligible[0]||EX[0];
}
function getCoachPlan(minsSince,nextEx){
  const intervalMinutes=workSec/60;
  if(idlePaused)return {
    level:t('coach.away'),
    title:t('coach.awayTitle'),
    copy:t('coach.awayCopy'),
    next:nextEx
  };
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
  if(!running&&!sessionStarted)return {
    level:t('coach.ready'),
    title:t('coach.startTitle'),
    copy:t('coach.startCopy'),
    next:nextEx
  };
  if(minsSince>=intervalMinutes)return {
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
  syncActiveTracking();
  if(running&&!inBreak)syncWorkLeft();
  if(inBreak){syncBreakLeft();updateBreakProgress();}
  const minsSince=(Date.now()-lastBreakTime)/60000;
  const intervalMinutes=workSec/60;
  setArc(UI.arcVisual,565.5,reminderProgress(reminderLeft.visual,visualSec));
  setArc(UI.arcPosture,464.9,reminderProgress(reminderLeft.posture,postureSec));
  const nextReminderKind=breakPending?pendingReminderKind:getNextReminderKind();
  const state=rhythmState({ running,inBreak,breakPending,idlePaused });
  UI.rhythmValue.textContent=state==='running'?fmt(workLeft)
    :state==='pending'?t('rhythm.readyValue')
      :state==='break'?`${breakLeft}s`
        :state==='away'?t('rhythm.awayValue'):fmt(workLeft);
  UI.rhythmStatus.textContent=state==='running'?t('timer.'+nextReminderKind)
    :state==='pending'?t(`nudge.${nextReminderKind}Title`)
      :state==='break'?t('rhythm.status.break')
        :state==='away'?t('rhythm.status.away'):t('rhythm.status.ready');
  const guidedBreaks=visualBreaksTaken+postureBreaksTaken;
  UI.mBreak.textContent=String(guidedBreaks+naturalBreaksTaken);
  UI.mBreakSub.textContent=`${guidedBreaks} ${t('metric.guided')} · ${naturalBreaksTaken} ${t('metric.natural')}`;
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
  const mins=Math.floor(getActiveTrackedMs()/60000);
  UI.sTime.textContent=mins<60?mins+t('time.minute'):Math.floor(mins/60)+t('time.hour')+(mins%60)+t('time.minute');
  UI.sNatural.textContent=naturalBreaksTaken;
  UI.sBreaks.textContent=guidedBreaks;
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
}
function fmt(s){return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}
function remainingSeconds(deadline,now=Date.now()){return secondsUntil(deadline,now);}
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
  return kind==='posture'?postureSec:visualSec;
}
function setReminderDeadlines(){
  const now=Date.now();
  const activeKinds=getActiveReminderKinds();
  REMINDER_KINDS.forEach(kind=>{reminderEndAt[kind]=activeKinds.includes(kind)?now+reminderLeft[kind]*1000:null;});
}
function preserveOrSetReminderDeadlines(){
  const now=Date.now();
  const activeKinds=getActiveReminderKinds();
  REMINDER_KINDS.forEach(kind=>{
    if(!activeKinds.includes(kind))reminderEndAt[kind]=null;
    else if(!reminderEndAt[kind])reminderEndAt[kind]=now+reminderLeft[kind]*1000;
  });
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
  UI.breakOverlay.classList.add('immersive');
  const offscreen=exercise?.pauseMode==='offscreen';
  UI.breakOverlay.classList.toggle('offscreen',offscreen);
  UI.offscreenIcon.textContent=exercise?.ico||'↗';
  const cueKind=activeBreakKind==='posture'?'posture':'visual';
  UI.offscreenCueTitle.textContent=t(`break.${cueKind}Cue`);
  UI.offscreenCueDetail.textContent=t(`break.${cueKind}CueDetail`);
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
function catchUpTimers(){
  maybeRepeatPendingReminder();
  if(idlePaused){updateUI();return;}
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
  if(inBreak||idlePaused)return;
  if(breakPending){startPendingBreak();return;}
  running=!running;
  if(running){
    timerPaused=false;
    sessionStarted=true;
    ensureIdleDetection(true);
    UI.startBtn.textContent=t('action.pause');
    startWorkTicker();
  }else{
    timerPaused=true;
    syncWorkLeft();
    clearReminderDeadlines();
    stopWorkTicker();
    UI.startBtn.textContent=t('action.resume');
    updateUI();
  }
  persistTimerSnapshot();
  syncBackgroundHeartbeat();
}
function startWorkTicker({ preserveDeadlines=false }={}){
  stopWorkTicker();
  if(idlePaused)return;
  if(preserveDeadlines)preserveOrSetReminderDeadlines();
  else setReminderDeadlines();
  ticker=setInterval(()=>{
    syncWorkLeft();
    if(breakPending){
      maybeRepeatPendingReminder();
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
function startBreakTicker(){
  stopBreakTicker();
  if(!inBreak||breakComplete)return;
  breakTicker=setInterval(()=>{
    syncBreakLeft();
    updateBreakProgress();
    if(breakLeft<=0)completeOrEndBreak();
    else updateUI();
  },1000);
}
function resetTimer(){
  stopWorkTicker();stopBreakTicker();stopAllAnims();
  stopBackgroundHeartbeat();
  running=false;inBreak=false;breakPending=false;breakComplete=false;timerPaused=false;breakLeft=breakSec;breakTotal=breakSec;
  idlePaused=false;idleStartedAt=null;resumeAfterIdle=false;
  reminderLeft={ visual:reminderIntervalSeconds('visual'),posture:reminderIntervalSeconds('posture') };
  updateDerivedWorkLeft();
  clearReminderDeadlines();breakEndAt=null;pendingPick=null;pendingReminderKind=null;
  clearPendingReminderAttention();
  closeDueNotifications();
  UI.startBtn.textContent=t('action.start');
  UI.breakOverlay.classList.remove('active','pending','complete','immersive','offscreen');
  UI.breakOverlay.setAttribute('aria-hidden','true');
  hideBreakNudge();
  activeBreakExercise=null;activeBreakKind=null;
  syncOverlayState();
  updateUI();
  clearTimerState();
}

// ═══ BREAK ═════════════════════════════════════════════════════
function queueBreak(kind=getDueReminderKind()||getNextReminderKind()){
  if(breakPending||inBreak)return;
  if(running)syncWorkLeft();
  if(pendingReminderKind&&pendingReminderKind!==kind)pendingPick=null;
  breakPending=true;pendingReminderKind=kind;workLeft=0;
  reminderEndAt[kind]=null;
  sessionStarted=true;
  pendingPick=pendingPick||selectNextExercise(kind);
  pendingReminderId=crypto.randomUUID();
  schedulePendingReminderRepeat();
  notifyBreakDue(pendingPick.exercise,kind);
  showPendingBreak();
  UI.startBtn.textContent=t('action.startBreak');
  updateUI();
  persistTimerSnapshot();
  syncBackgroundHeartbeat();
}
function showPendingBreak(){
  if(idlePaused||!breakPending||pendingNotificationChannel==='sending'||
    (pendingNotificationChannel==='system'&&notificationsEnabled&&notificationStatus()==='granted')){
    hideBreakNudge();
    return;
  }
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
  clearPendingReminderAttention();
  closeDueNotifications();
  running=true;
  reminderLeft[kind]=5*60;
  REMINDER_KINDS.filter(item=>item!==kind&&reminderLeft[item]<=0).forEach(item=>{reminderLeft[item]=OVERLAP_GRACE_SECONDS;});
  updateDerivedWorkLeft();
  hideBreakNudge();
  UI.startBtn.textContent=t('action.pause');
  startWorkTicker();
  updateUI();
  persistTimerSnapshot();
}
async function closeDueNotifications(){
  const registration=serviceWorkerReady?await serviceWorkerReady:null;
  if(!registration?.getNotifications)return;
  try{
    const notifications=await registration.getNotifications({ tag:'visupause-break-due' });
    notifications.forEach(notification=>notification.close());
  }catch{}
}
function registerNaturalBreak({ source='manual',durationSeconds=0,resume }={}){
  if(inBreak)return;
  if(running)syncWorkLeft();
  const shouldResume=typeof resume==='boolean'?resume:(running||breakPending);
  breakPending=false;
  pendingPick=null;
  pendingReminderKind=null;
  clearPendingReminderAttention();
  hideBreakNudge();
  closeDueNotifications();
  reminderLeft={ visual:reminderIntervalSeconds('visual'),posture:reminderIntervalSeconds('posture') };
  updateDerivedWorkLeft();
  clearReminderDeadlines();
  const now=Date.now();
  lastBreakTime=now;
  naturalBreaksTaken++;
  recordActivity('natural',source,durationSeconds);
  running=shouldResume;
  if(running)timerPaused=false;
  UI.startBtn.textContent=running?t('action.pause'):t('action.start');
  if(running)startWorkTicker();
  else stopWorkTicker();
  updateUI();
  persistTimerSnapshot();
  syncBackgroundHeartbeat();
}
function startPendingBreak(){
  if(!breakPending)return;
  closePractice();
  const picked=pendingPick;
  const kind=pendingReminderKind||picked?.exercise?.reminderKind||'visual';
  breakPending=false;
  clearPendingReminderAttention();
  pendingPick=null;pendingReminderKind=null;
  hideBreakNudge();
  startBreak({ picked, kind, source:'scheduled' });
}
function presentActiveBreak(){
  const ex=activeBreakExercise;
  if(!inBreak||!ex)return;
  const cat=CATS[ex.cat];
  setBreakStageMode(ex);
  UI.bCat.textContent=catLabel(ex.cat);UI.bCat.style.color=cat.color;
  UI.bSrc.textContent=exText(ex,'source');
  UI.bTitle.textContent=exerciseName(ex);
  UI.bDesc.textContent=exText(ex,'desc');
  UI.bTip.textContent=exText(ex,'tip');
  UI.extBtn.disabled=extUsed||breakComplete;
  UI.startBtn.textContent=t('action.breakRunning');
  UI.breakOverlay.classList.toggle('complete',breakComplete);
  if(breakComplete){
    UI.brTxt.textContent='✓';
    UI.brProg.setAttribute('stroke-dashoffset','213.6');
    UI.endBreakBtn.textContent=getBreakCompleteLabel();
    UI.endBreakBtn.setAttribute('aria-label',t('break.ariaReady'));
  }else{
    UI.endBreakBtn.textContent=t('action.endBreak');
    UI.endBreakBtn.setAttribute('aria-label',t('break.ariaEnd'));
    updateBreakProgress();
  }
  UI.breakOverlay.classList.add('active');
  UI.breakOverlay.setAttribute('aria-hidden','false');
  hideBreakNudge();
  syncOverlayState();
  if(ex.pauseMode==='screen'&&!breakComplete)setTimeout(renderBreakAnimation,40);
  startBreakTicker();
}
function startBreak(options={}){
  const { picked=null, source='manual' } = options;
  const kind=options.kind||picked?.exercise?.reminderKind||getNextReminderKind();
  if(running)syncWorkLeft();
  stopWorkTicker();stopBreakTicker();running=false;inBreak=true;timerPaused=false;extUsed=false;
  clearPendingReminderAttention();
  clearReminderDeadlines();
  const ex=chooseNextExercise(picked,kind);
  const exerciseSeconds=Number.parseInt(ex.dur,10);
  breakComplete=false;breakLeft=breakTotal=Number.isFinite(exerciseSeconds)?exerciseSeconds:20;
  activeBreakExercise=ex;activeBreakKind=kind;activeBreakSource=source;
  sessionStarted=true;
  closeDueNotifications();
  if(kind==='visual')lastBreakTime=Date.now();
  breakEndAt=Date.now()+breakLeft*1000;
  presentActiveBreak();
  persistTimerSnapshot();
  syncBackgroundHeartbeat();
}
function startManualBreak(){
  if(inBreak)return;
  if(breakPending){startPendingBreak();return;}
  closePractice();
  const picked=pendingPick;
  const kind=pendingReminderKind||picked?.exercise?.reminderKind||getNextReminderKind();
  pendingPick=null;pendingReminderKind=null;
  startBreak({ picked, kind, source:'manual' });
}
function startTestExercise(i){
  openPractice(i,true);
}
function selectNextExercise(kind=getNextReminderKind()){
  const eligible=getEligibleExercises(kind);
  const queue=exerciseQueues[kind]||exerciseQueues.all;
  return pickExercise({
    exercises:eligible,
    order:queue.order,
    cursor:queue.cursor,
    lastCategory:lastExerciseCat
  });
}
function chooseNextExercise(picked,kind=getNextReminderKind()){
  picked=picked||selectNextExercise(kind);
  const queue=exerciseQueues[kind]||exerciseQueues.all;
  queue.order=picked.order;
  queue.cursor=picked.cursor;
  lastExerciseCat=picked.exercise.cat;
  return picked.exercise;
}
function endBreak(){
  if(!inBreak)return;
  stopBreakTicker();stopAllAnims();
  UI.breakOverlay.classList.remove('active','complete','immersive','offscreen');
  UI.breakOverlay.setAttribute('aria-hidden','true');
  const completedKind=activeBreakKind||'visual';
  reminderLeft[completedKind]=reminderIntervalSeconds(completedKind);
  REMINDER_KINDS.filter(kind=>kind!==completedKind&&reminderLeft[kind]<=0).forEach(kind=>{reminderLeft[kind]=OVERLAP_GRACE_SECONDS;});
  updateDerivedWorkLeft();
  const completedSource=activeBreakSource;
  activeBreakExercise=null;activeBreakKind=null;activeBreakSource='manual';
  breakEndAt=null;
  inBreak=false;breakComplete=false;running=true;timerPaused=false;
  if(completedKind==='posture')postureBreaksTaken++;
  else visualBreaksTaken++;
  recordActivity(completedKind,completedSource,breakTotal-breakLeft);
  syncOverlayState();
  UI.startBtn.textContent=t('action.pause');
  UI.endBreakBtn.textContent=t('action.endBreak');
  UI.endBreakBtn.setAttribute('aria-label',t('break.ariaEnd'));
  startWorkTicker();
  updateUI();
  persistTimerSnapshot();
  syncBackgroundHeartbeat();
}
function completeOrEndBreak(){
  if(settings.exitMode==='auto'){endBreak();return;}
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
  updateUI();
  persistTimerSnapshot();
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
  persistTimerSnapshot();
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
  UI.pmOffscreenText.textContent=t(ex.reminderKind==='posture'?'practice.postureCue':'practice.visualCue');
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

// ═══ ACTIVITY JOURNAL ═════════════════════════════════════════
function renderActivityJournal(){
  if(!UI.activityList)return;
  UI.activityList.textContent='';
  const events=todayActivity();
  UI.chartMeta.textContent=events.length?`${events.length} ${t('chart.eventsToday')}`:t('chart.empty');
  if(!events.length){
    UI.activityList.append(el('p',{ className:'activity-empty',text:t('chart.empty') }));
    return;
  }
  events.slice(-6).reverse().forEach(event=>{
    const row=el('article',{ className:`activity-item ${event.kind}` });
    const at=new Date(event.at);
    const time=`${String(at.getHours()).padStart(2,'0')}:${String(at.getMinutes()).padStart(2,'0')}`;
    const icon=event.kind==='visual'?'↗':event.kind==='posture'?'◌':'☕';
    const detail=event.kind==='natural'&&event.durationSeconds
      ? `${Math.max(1,Math.round(event.durationSeconds/60))}${t('time.minute')} · ${t(`activity.source.${event.source}`)}`
      : t(`activity.source.${event.source}`);
    row.append(
      el('time',{ className:'activity-time',text:time,attrs:{ datetime:at.toISOString() } }),
      el('span',{ className:'activity-icon',text:icon,attrs:{ 'aria-hidden':'true' } }),
      el('div',{ className:'activity-copy' })
    );
    row.lastElementChild.append(
      el('strong',{ text:t(`activity.${event.kind}`) }),
      el('small',{ text:detail })
    );
    UI.activityList.append(row);
  });
}
function resetSession(){
  if(!confirm(t('reset.confirm')))return;
  visualBreaksTaken=0;postureBreaksTaken=0;naturalBreaksTaken=0;
  sessionId=Date.now();sessionStarted=false;activeTrackedMs=0;activeTrackingStartedAt=null;
  lastBreakTime=Date.now();resetExerciseQueues();lastExerciseCat=null;
  renderActivityJournal();
  resetTimer();
}

function resumeRestoredTimerState(){
  if(!restoredTimerState)return;
  if(idlePaused){
    finishIdlePause();
    return;
  }
  if(inBreak){
    syncBreakLeft();
    if(breakLeft<=0&&settings.exitMode==='auto'){
      endBreak();
      return;
    }
    if(breakLeft<=0){breakComplete=true;breakEndAt=null;}
    presentActiveBreak();
  }else{
    if(breakPending){
      showPendingBreak();
      UI.startBtn.textContent=t('action.startBreak');
    }
    if(running){
      startWorkTicker();
      ensureIdleDetection(false);
    }else if(timerPaused){
      UI.startBtn.textContent=t('action.resume');
    }
  }
  catchUpTimers();
  persistTimerSnapshot();
  syncBackgroundHeartbeat();
}

// ═══ INIT ══════════════════════════════════════════════════════
applyAppearance();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyAppearance);
new MutationObserver(syncSimpleControls).observe(UI.startBtn,{childList:true,attributes:true,characterData:true,subtree:true});
syncSimpleControls();
registerServiceWorker();
bindActions();
renderExerciseLibrary();
renderSettings();
applyLanguage();
renderActivityJournal();
resumeRestoredTimerState();
handleLaunchAction();
updateNotificationButton();
updateUI();
setInterval(catchUpTimers,3000);
catchUpTimers();
})();
