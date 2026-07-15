const TICK_MS = 33;
let primaryLoop = null;
let modalLoop = null;
let animationLanguage = 'fr';
const ANIM_TEXT = {
  fr: {
    focusCenter: 'Fixe le centre et relâche le focus',
    eyesClosed: 'Yeux fermés, aucune tension',
    drift: 'Laisse le regard dériver',
    pendulum: 'Suis le pendule en douceur',
    movingTarget: 'Suis la cible mobile',
    nearFocus: 'Focus proche',
    farFocus: 'Focus lointain',
    approaching: 'Objet qui s’approche',
    receding: 'Objet qui s’éloigne',
    spiralDepth: 'Suis la spirale en profondeur',
    beads: 'Déplace le focus perle par perle',
    blink: 'Clignement lent et complet',
    centerFixed: 'Garde le centre fixe',
    fieldOpen: 'Perçois le champ qui s’ouvre',
    softFocus: 'Laisse le focus se relâcher puis revenir',
    inhale: 'Inspire et regarde loin',
    exhale: 'Expire et relâche les yeux',
    passiveRest: 'Repos visuel passif',
    turnRight: 'Tourne doucement à droite',
    turnLeft: 'Tourne doucement à gauche',
    tilt: 'Incline sans tirer',
    tiltBreathe: 'Incline puis respire',
    chin: 'Menton vers poitrine',
    neutral: 'Retour au neutre',
    shouldersBack: 'Épaules arrière',
    releaseDown: 'Relâche vers le bas',
    infinity: 'Suis le tracé en infini',
    circle: 'Suis le cercle',
    quadrants: 'Traverse les quatre quadrants',
    wave: 'Suis la vague',
    saccade: 'Sauts oculaires nets',
    star: 'Trace l’étoile',
    cardinal: 'Centre, direction, retour'
  },
  en: {
    focusCenter: 'Fix the center and relax focus',
    eyesClosed: 'Eyes closed, no tension',
    drift: 'Let your gaze drift',
    pendulum: 'Follow the pendulum gently',
    movingTarget: 'Follow the moving target',
    nearFocus: 'Near focus',
    farFocus: 'Far focus',
    approaching: 'Object approaching',
    receding: 'Object moving away',
    spiralDepth: 'Follow the spiral in depth',
    beads: 'Move focus bead by bead',
    blink: 'Slow complete blink',
    centerFixed: 'Keep the center fixed',
    fieldOpen: 'Notice the field opening',
    softFocus: 'Let focus release, then return',
    inhale: 'Inhale and look far',
    exhale: 'Exhale and relax the eyes',
    passiveRest: 'Passive visual rest',
    turnRight: 'Turn gently right',
    turnLeft: 'Turn gently left',
    tilt: 'Tilt without pulling',
    tiltBreathe: 'Tilt, then breathe',
    chin: 'Chin toward chest',
    neutral: 'Back to neutral',
    shouldersBack: 'Shoulders back',
    releaseDown: 'Release downward',
    infinity: 'Follow the infinity path',
    circle: 'Follow the circle',
    quadrants: 'Cross the four quadrants',
    wave: 'Follow the wave',
    saccade: 'Clean eye jumps',
    star: 'Trace the star',
    cardinal: 'Center, direction, return'
  }
};

function a(key) {
  return ANIM_TEXT[animationLanguage]?.[key] || ANIM_TEXT.fr[key] || key;
}

function startLoop(draw) {
  let active = true;
  let frameId = 0;
  let lastTs = 0;

  const tick = ts => {
    if (!active) return;
    if (!lastTs || ts - lastTs >= TICK_MS) {
      lastTs = ts;
      draw();
    }
    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);
  return {
    stop() {
      active = false;
      cancelAnimationFrame(frameId);
    }
  };
}

function stopLoop(loop) {
  if (loop && typeof loop.stop === 'function') loop.stop();
}

function stopAllAnims() {
  stopLoop(primaryLoop);
  stopLoop(modalLoop);
  primaryLoop = null;
  modalLoop = null;
}

function setLoop(isPractice, loop) {
  if (isPractice) {
    stopLoop(modalLoop);
    modalLoop = loop;
  } else {
    stopLoop(primaryLoop);
    primaryLoop = loop;
  }
}

function clear(ctx, width, height, alpha = 1) {
  ctx.fillStyle = `rgba(5,7,9,${alpha})`;
  ctx.fillRect(0, 0, width, height);
}

function orb(ctx, x, y, color) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 24);
  glow.addColorStop(0, color);
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(x, y, 24, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fillStyle = color.includes('rgba') ? '#28d4b4' : color;
  ctx.fill();
}

function label(ctx, width, height, text, color = 'rgba(155,181,204,.4)') {
  ctx.font = '12px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, height - 12);
}

function alphaColor(color, alpha) {
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `,${alpha})`);
  return color;
}

function depthTarget(ctx, width, height, depth, color, text) {
  const near = 1 - depth;
  const cx = width / 2;
  const horizon = height * 0.34;
  const floorY = height * 0.82;
  const y = horizon + near * (floorY - horizon);
  const size = Math.max(8, Math.min(width, height) * (0.026 + near * 0.105));
  clear(ctx, width, height, 1);

  const vignette = ctx.createRadialGradient(cx, horizon, 0, cx, horizon, Math.max(width, height) * 0.74);
  vignette.addColorStop(0, 'rgba(40,212,180,.035)');
  vignette.addColorStop(1, 'rgba(5,7,9,0)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(155,181,204,.09)';
  for (let i = -4; i <= 4; i += 1) {
    const footX = cx + i * width * 0.13;
    ctx.beginPath();
    ctx.moveTo(cx, horizon);
    ctx.lineTo(footX, floorY);
    ctx.stroke();
  }
  for (let i = 1; i <= 7; i += 1) {
    const p = i / 7;
    const lineY = horizon + (floorY - horizon) * (p * p);
    ctx.beginPath();
    ctx.moveTo(width * (0.5 - p * 0.46), lineY);
    ctx.lineTo(width * (0.5 + p * 0.46), lineY);
    ctx.stroke();
  }

  const shadowW = size * (1.4 + near * 1.4);
  const shadowH = Math.max(3, size * 0.22);
  ctx.beginPath();
  ctx.ellipse(cx, y + size * 0.82, shadowW, shadowH, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0,0,0,${(0.12 + near * 0.32).toFixed(2)})`;
  ctx.fill();

  const halo = ctx.createRadialGradient(cx, y, 0, cx, y, size * 2.6);
  halo.addColorStop(0, color);
  halo.addColorStop(0.35, alphaColor(color, 0.24));
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath();
  ctx.arc(cx, y, size * 2.6, 0, Math.PI * 2);
  ctx.fillStyle = halo;
  ctx.fill();

  for (let i = 2; i >= 0; i -= 1) {
    ctx.beginPath();
    ctx.arc(cx, y, size * (1 + i * 0.56), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(216,234,255,${(0.11 + near * 0.1 - i * 0.025).toFixed(3)})`;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, y, size, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx - size * 0.28, y - size * 0.32, size * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,.62)';
  ctx.fill();
  label(ctx, width, height, text);
}

function createDepth(ctx, width, height) {
  const stars = Array.from({ length: 70 }, () => ({
    nx: (Math.random() - 0.5) * 2.2,
    ny: (Math.random() - 0.5) * 2.2,
    z: Math.random(),
    speed: 0.008 + Math.random() * 0.01
  }));
  return () => {
    clear(ctx, width, height, 0.35);
    stars.forEach(star => {
      star.z -= star.speed;
      if (star.z <= 0) {
        star.z = 1;
        star.nx = (Math.random() - 0.5) * 2.2;
        star.ny = (Math.random() - 0.5) * 2.2;
      }
      const p = 1 - star.z;
      const x = width / 2 + star.nx * width * 0.5 * p;
      const y = height / 2 + star.ny * height * 0.5 * p;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.5, p * 3), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(160,220,210,${(p * 0.88).toFixed(2)})`;
      ctx.fill();
    });
    const pulseDepth = 0.42 + 0.22 * Math.sin(Date.now() / 1200);
    depthTarget(ctx, width, height, pulseDepth, '#28d4b4', a('focusCenter'));
    stars.forEach(star => {
      const p = 1 - star.z;
      const x = width / 2 + star.nx * width * 0.5 * p;
      const y = height / 2 + star.ny * height * 0.5 * p;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.5, p * 2.2), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(160,220,210,${(p * 0.45).toFixed(2)})`;
      ctx.fill();
    });
    label(ctx, width, height, a('focusCenter'));
  };
}

function createPalm(ctx, width, height) {
  let t = 0;
  return () => {
    t += 0.04;
    clear(ctx, width, height, 0.96);
    const glow = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, width * 0.5);
    glow.addColorStop(0, `rgba(180,80,20,${(0.04 + Math.sin(t) * 0.03).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(5,7,9,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    ctx.font = `${Math.min(width, height) * 0.28}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText('🤲', width / 2, height / 2 + 24);
    label(ctx, width, height, a('eyesClosed'));
  };
}

function createNature(ctx, width, height) {
  const particles = Array.from({ length: 45 }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    r: 1 + Math.random() * 2.5,
    vx: (Math.random() - 0.5) * 0.4,
    vy: -0.25 - Math.random() * 0.35,
    alpha: 0.08 + Math.random() * 0.25
  }));
  return () => {
    clear(ctx, width, height, 0.18);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.y < -10) {
        p.x = Math.random() * width;
        p.y = height + 8;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(100,190,120,${p.alpha})`;
      ctx.fill();
    });
    label(ctx, width, height, a('drift'));
  };
}

function createPendulum(ctx, width, height) {
  const cx = width / 2;
  const pivotY = height * 0.16;
  const length = height * 0.62;
  let angle = Math.PI / 4;
  let velocity = 0;
  return () => {
    clear(ctx, width, height, 1);
    velocity += -0.0055 * Math.sin(angle);
    velocity *= 0.998;
    angle += velocity;
    const x = cx + Math.sin(angle) * length;
    const y = pivotY + Math.cos(angle) * length;
    ctx.beginPath();
    ctx.moveTo(cx, pivotY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = 'rgba(155,181,204,.2)';
    ctx.stroke();
    orb(ctx, x, y, 'rgba(40,212,180,.9)');
    label(ctx, width, height, a('pendulum'));
  };
}

function createPathMotion(ctx, width, height, resolver, lineColor, text) {
  let t = 0;
  const trail = [];
  return () => {
    clear(ctx, width, height, 1);
    t += 0.025;
    const pos = resolver(t);
    trail.push(pos);
    if (trail.length > 18) trail.shift();
    if (lineColor) {
      ctx.beginPath();
      for (let i = 0; i < 180; i += 1) {
        const p = resolver((i / 180) * Math.PI * 2);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = lineColor;
      ctx.stroke();
    }
    trail.forEach((point, index) => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, (index / trail.length) * 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(40,212,180,${(index / trail.length * 0.4).toFixed(2)})`;
      ctx.fill();
    });
    orb(ctx, pos.x, pos.y, 'rgba(40,212,180,.9)');
    label(ctx, width, height, text);
  };
}

function createBounce(ctx, width, height) {
  let x = width / 2;
  let y = height / 2;
  let vx = 3;
  let vy = 2.6;
  return () => {
    clear(ctx, width, height, 1);
    x += vx;
    y += vy;
    if (x < 28 || x > width - 28) vx *= -1;
    if (y < 28 || y > height - 28) vy *= -1;
    orb(ctx, x, y, 'rgba(40,212,180,.9)');
    label(ctx, width, height, a('movingTarget'));
  };
}

function createNearFar(ctx, width, height) {
  let t = 0;
  return () => {
    t += 0.018;
    const depth = 0.5 + 0.5 * Math.sin(t);
    depthTarget(ctx, width, height, depth, depth < 0.5 ? '#e05050' : '#28d4b4', depth < 0.5 ? a('nearFocus') : a('farFocus'));
  };
}

function createConvergence(ctx, width, height) {
  let t = 0;
  return () => {
    t += 0.016;
    const depth = 0.5 + 0.5 * Math.cos(t);
    const approaching = Math.sin(t) < 0;
    depthTarget(ctx, width, height, depth, '#28d4b4', approaching ? a('approaching') : a('receding'));
  };
}

function createSpiral(ctx, width, height) {
  let progress = 0;
  let forward = true;
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius = Math.min(width, height) * 0.35;
  return () => {
    progress += forward ? 0.01 : -0.01;
    if (progress >= 1) forward = false;
    if (progress <= 0) forward = true;
    depthTarget(ctx, width, height, 1 - progress, '#28d4b4', a('spiralDepth'));
    const angle = progress * Math.PI * 6;
    const radius = (0.16 + progress * 0.84) * maxRadius;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    orb(ctx, x, y, 'rgba(40,212,180,.72)');
    label(ctx, width, height, a('spiralDepth'));
  };
}

function createBrock(ctx, width, height) {
  let active = 0;
  let tick = 0;
  const beads = [
    { x: width / 2, y: height * 0.28, color: '#e05050' },
    { x: width / 2, y: height * 0.5, color: '#e8a020' },
    { x: width / 2, y: height * 0.72, color: '#28d4b4' }
  ];
  return () => {
    clear(ctx, width, height, 1);
    tick += 1;
    if (tick % 55 === 0) active = (active + 1) % beads.length;
    beads.forEach((bead, index) => {
      ctx.beginPath();
      ctx.arc(bead.x, bead.y, index === active ? 10 : 6, 0, Math.PI * 2);
      ctx.fillStyle = index === active ? bead.color : `${bead.color}88`;
      ctx.fill();
    });
    label(ctx, width, height, a('beads'));
  };
}

function createSaccade(ctx, width, height, points, text, color = '#28d4b4') {
  let index = 0;
  let age = 0;
  return () => {
    clear(ctx, width, height, 1);
    age += 1;
    if (age % 18 === 0) index = (index + 1) % points.length;
    const point = points[index];
    const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 24);
    glow.addColorStop(0, alphaColor(color, 0.38));
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(point.x, point.y, 24, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    label(ctx, width, height, text);
  };
}

function createBlink(ctx, width, height) {
  let tick = 0;
  return () => {
    clear(ctx, width, height, 1);
    tick += 1;
    const openness = 0.5 + 0.5 * Math.sin(tick * 0.12);
    const eyeHeight = Math.max(4, 50 * openness);
    ctx.beginPath();
    ctx.ellipse(width / 2, height / 2, 92, eyeHeight, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(216,234,255,.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (eyeHeight > 8) {
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 18, 0, Math.PI * 2);
      ctx.fillStyle = '#28d4b4';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 8, 0, Math.PI * 2);
      ctx.fillStyle = '#050709';
      ctx.fill();
    }
    label(ctx, width, height, a('blink'));
  };
}

function createPeripheral(ctx, width, height) {
  const points = Array.from({ length: 10 }, (_, index) => {
    const angle = (index / 10) * Math.PI * 2;
    const radius = Math.min(width, height) * 0.3;
    return { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius };
  });
  let active = 0;
  let tick = 0;
  return () => {
    clear(ctx, width, height, 1);
    tick += 1;
    if (tick % 14 === 0) active = (active + 1) % points.length;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#d8eaff';
    ctx.fill();
    const point = points[active];
    ctx.beginPath();
    ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(216,234,255,.55)';
    ctx.fill();
    label(ctx, width, height, a('centerFixed'));
  };
}

function createField(ctx, width, height) {
  let t = 0;
  return () => {
    clear(ctx, width, height, 1);
    t += 0.02;
    for (let i = 0; i < 4; i += 1) {
      const radius = 20 + ((t + i * 0.25) % 1) * Math.min(width, height) * 0.35;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(216,234,255,${(0.28 - i * 0.05).toFixed(2)})`;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#28d4b4';
    ctx.fill();
    label(ctx, width, height, a('fieldOpen'));
  };
}

function createSoftFocus(ctx, width, height) {
  let t = 0;
  return () => {
    clear(ctx, width, height, 1);
    t += 0.04;
    const pulse = 0.5 + 0.5 * Math.sin(t);
    for (let i = 5; i >= 1; i -= 1) {
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 12 + i * 8 + pulse * 12, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(40,212,180,${(0.02 * i).toFixed(2)})`;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#28d4b4';
    ctx.fill();
    label(ctx, width, height, a('softFocus'));
  };
}

function createBreathLook(ctx, width, height) {
  let t = 0;
  return () => {
    clear(ctx, width, height, 1);
    t += 0.02;
    const inhale = Math.sin(t) > 0;
    const radius = 16 + Math.abs(Math.sin(t)) * 20;
    ctx.beginPath();
    ctx.arc(width / 2, height * 0.38, radius, 0, Math.PI * 2);
    ctx.strokeStyle = inhale ? '#50a0e0' : '#28d4b4';
    ctx.lineWidth = 2;
    ctx.stroke();
    label(ctx, width, height, inhale ? a('inhale') : a('exhale'), inhale ? '#50a0e0' : '#28d4b4');
  };
}

function createStillness(ctx, width, height) {
  const stars = Array.from({ length: 40 }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    a: 0.03 + Math.random() * 0.05
  }));
  let t = 0;
  return () => {
    clear(ctx, width, height, 0.74);
    t += 0.015;
    stars.forEach(star => {
      ctx.beginPath();
      ctx.arc(star.x, star.y, 1, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(216,234,255,${(star.a * (0.75 + 0.25 * Math.sin(t + star.x))).toFixed(3)})`;
      ctx.fill();
    });
    label(ctx, width, height, a('passiveRest'));
  };
}

function drawHeadGuide(ctx, width, height, angle, text, accent = '#c08af0') {
  clear(ctx, width, height, 1);
  const cx = width / 2;
  const cy = height * 0.46;
  const scale = Math.min(width, height) / 260;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, -16 * scale, 34 * scale, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(216,234,255,.72)';
  ctx.lineWidth = Math.max(2, 2 * scale);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 18 * scale);
  ctx.lineTo(0, 62 * scale);
  ctx.strokeStyle = 'rgba(155,181,204,.36)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(12 * scale, -20 * scale, 3.5 * scale, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.restore();
  const radius = Math.min(width, height) * 0.26;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI * 0.15, Math.PI * 0.85);
  ctx.strokeStyle = 'rgba(192,138,240,.16)';
  ctx.stroke();
  label(ctx, width, height, text, accent);
}

function createNeckTurn(ctx, width, height) {
  let t = 0;
  return () => {
    t += 0.018;
    const angle = Math.sin(t) * 0.38;
    drawHeadGuide(ctx, width, height, angle, angle > 0 ? a('turnRight') : a('turnLeft'));
  };
}

function createNeckTilt(ctx, width, height) {
  let t = 0;
  return () => {
    t += 0.016;
    const angle = Math.sin(t) * 0.32;
    drawHeadGuide(ctx, width, height, angle, angle > 0 ? a('tilt') : a('tiltBreathe'));
  };
}

function createChinNod(ctx, width, height) {
  let t = 0;
  return () => {
    t += 0.018;
    const nod = 0.5 + 0.5 * Math.sin(t);
    drawHeadGuide(ctx, width, height, 0, nod > 0.55 ? a('chin') : a('neutral'));
    ctx.beginPath();
    ctx.moveTo(width / 2, height * 0.28);
    ctx.lineTo(width / 2, height * (0.34 + nod * 0.12));
    ctx.strokeStyle = 'rgba(192,138,240,.32)';
    ctx.lineWidth = 2;
    ctx.stroke();
  };
}

function createShoulderReset(ctx, width, height) {
  let t = 0;
  return () => {
    t += 0.02;
    clear(ctx, width, height, 1);
    const cx = width / 2;
    const cy = height * 0.5;
    const lift = Math.sin(t) * 10;
    ctx.beginPath();
    ctx.arc(cx - 56, cy + lift, 30, Math.PI * 0.15, Math.PI * 1.1);
    ctx.arc(cx + 56, cy + lift, 30, Math.PI * -0.1, Math.PI * 0.85);
    ctx.strokeStyle = 'rgba(216,234,255,.5)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - 56, cy + lift, 44, Math.PI * 0.1, Math.PI * 1.1);
    ctx.arc(cx + 56, cy + lift, 44, Math.PI * -0.1, Math.PI * 0.9);
    ctx.strokeStyle = 'rgba(192,138,240,.18)';
    ctx.stroke();
    label(ctx, width, height, lift > 0 ? a('shouldersBack') : a('releaseDown'), '#c08af0');
  };
}

function startAnim(ctx, width, height, type, isPractice, language = 'fr') {
  animationLanguage = language === 'en' ? 'en' : 'fr';
  const map = {
    depth: createDepth,
    palm: createPalm,
    nature: createNature,
    pendule: createPendulum,
    infinity: (c, w, h) => createPathMotion(c, w, h, t => {
      const a = Math.min(w, h) * 0.3;
      const b = Math.min(w, h) * 0.16;
      const d = 1 + Math.sin(t) ** 2;
      return { x: w / 2 + a * Math.cos(t) / d, y: h / 2 + b * Math.sin(t) * Math.cos(t) / d };
    }, 'rgba(40,212,180,.12)', a('infinity')),
    rotation: (c, w, h) => createPathMotion(c, w, h, t => {
      const r = Math.min(w, h) * 0.28;
      return { x: w / 2 + Math.cos(t) * r, y: h / 2 + Math.sin(t) * r };
    }, 'rgba(40,212,180,.12)', a('circle')),
    butterfly: (c, w, h) => createPathMotion(c, w, h, t => {
      const a = Math.min(w, h) * 0.28;
      return { x: w / 2 + a * Math.sin(2 * t) * Math.cos(t), y: h / 2 + a * Math.sin(2 * t) * Math.sin(t) };
    }, 'rgba(124,131,245,.12)', a('quadrants')),
    bounce: createBounce,
    wave: (c, w, h) => createPathMotion(c, w, h, t => {
      const p = (t % (Math.PI * 2)) / (Math.PI * 2);
      return { x: w * 0.08 + p * w * 0.84, y: h / 2 + Math.sin(t * 2) * h * 0.18 };
    }, 'rgba(40,212,180,.12)', a('wave')),
    nearfar: createNearFar,
    convergence: createConvergence,
    spiral: createSpiral,
    brock: createBrock,
    saccade: (c, w, h) => createSaccade(c, w, h, [
      { x: w / 2, y: h * 0.18 }, { x: w * 0.78, y: h * 0.34 }, { x: w * 0.78, y: h * 0.66 },
      { x: w / 2, y: h * 0.82 }, { x: w * 0.22, y: h * 0.66 }, { x: w * 0.22, y: h * 0.34 }
    ], a('saccade')),
    star: (c, w, h) => createSaccade(c, w, h, [
      { x: w / 2, y: h * 0.18 }, { x: w * 0.68, y: h * 0.72 }, { x: w * 0.2, y: h * 0.38 },
      { x: w * 0.8, y: h * 0.38 }, { x: w * 0.32, y: h * 0.72 }
    ], a('star'), '#e8a020'),
    cardinal: (c, w, h) => createSaccade(c, w, h, [
      { x: w / 2, y: h * 0.18 }, { x: w * 0.78, y: h / 2 }, { x: w / 2, y: h * 0.82 }, { x: w * 0.22, y: h / 2 },
      { x: w * 0.72, y: h * 0.28 }, { x: w * 0.72, y: h * 0.72 }, { x: w * 0.28, y: h * 0.72 }, { x: w * 0.28, y: h * 0.28 }
    ], a('cardinal')),
    blink: createBlink,
    peripheral: createPeripheral,
    field: createField,
    softfocus: createSoftFocus,
    breathlook: createBreathLook,
    stillness: createStillness,
    neckturn: createNeckTurn,
    necktilt: createNeckTilt,
    chinnod: createChinNod,
    shoulder: createShoulderReset
  };

  const factory = map[type] || createDepth;
  setLoop(isPractice, startLoop(factory(ctx, width, height)));
}

window.VisuAnimations = { startAnim, stopAllAnims };
