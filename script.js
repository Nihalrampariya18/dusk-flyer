/* =============================================================================
   DUSK FLYER — a Flappy-Bird-style game
   Pure vanilla JS + HTML5 Canvas. No frameworks, no external image/audio
   assets — everything you see and hear is drawn/generated in code.

   -----------------------------------------------------------------------
   HOW THIS FILE IS ORGANIZED
   1. CONFIG        - every tunable number/color lives here. Tweak freely.
   2. STATE         - variables that change as the game runs.
   3. SETUP         - canvas sizing, DOM references, event listeners.
   4. SOUND         - tiny synthesized sound effects (Web Audio API).
   5. GAME LOGIC    - reset/start/end game, physics update, collisions.
   6. DRAWING       - everything that paints pixels to the canvas.
   7. MAIN LOOP     - the requestAnimationFrame heartbeat.
   ============================================================================= */


/* =============================================================================
   1. CONFIG — tweak these to customize the game
   ============================================================================= */
const CONFIG = {
  // --- Logical drawing resolution. All game-object coordinates use this
  //     coordinate space; CSS/canvas scaling maps it onto any screen size. ---
  world: {
    width: 400,
    height: 600,
    groundHeight: 90,
  },

  // --- Bird tuning ---
  bird: {
    startX: 90,          // fixed horizontal position on screen
    radius: 16,
    gravity: 0.45,        // how fast the bird accelerates downward
    flapVelocity: -7.6,   // upward velocity applied on each flap (more negative = stronger flap)
    maxFallSpeed: 10,     // terminal velocity
    maxRotationDown: 90,  // degrees, how far the bird tips nose-down while falling
    maxRotationUp: -25,   // degrees, how far the bird tips nose-up while flapping
  },

  // --- Pipe tuning ---
  pipes: {
    width: 56,
    spacing: 210,     // horizontal distance between consecutive pipe pairs
    baseGap: 165,      // vertical gap size at score 0
    minGap: 118,       // gap never shrinks smaller than this (keeps it fair)
    gapShrinkPerPoint: 1.2,   // gap shrinks this many px per point scored
    baseSpeed: 2.3,    // pipe scroll speed at score 0
    maxSpeed: 5.2,     // speed never exceeds this (keeps it playable)
    speedGainPerPoint: 0.045, // how quickly speed ramps up with score
    edgeMargin: 40,    // minimum distance from sky-top / ground to a gap edge
  },

  // --- Color palette used by the canvas renderer ---
  colors: {
    skyTop: '#241748',
    skyMid: '#6c3f91',
    skyHorizon: '#ff8c61',
    sun: '#ffd166',
    cloud: 'rgba(255,255,255,0.85)',
    pipeBody: '#0ead8c',
    pipeBodyDark: '#087f63',
    pipeHighlight: '#4fe9c9',
    pipeCap: '#0a9478',
    groundBase: '#c88b3e',
    groundTop: '#e8b76b',
    groundStripe: '#b97a33',
    birdBody: '#ffc93c',
    birdBodyDark: '#ff9f1c',
    birdBelly: '#fff3d6',
    birdWing: '#ffffff',
    beak: '#ff6b35',
  },
};


/* =============================================================================
   2. STATE
   ============================================================================= */
let gameState = 'start';   // 'start' | 'playing' | 'gameover'

const bird = {
  x: CONFIG.bird.startX,
  y: CONFIG.world.height / 2,
  velocity: 0,
  rotation: 0,
};

let pipes = [];            // { x, topHeight, gap, passed }
let clouds = [];           // decorative background clouds
let score = 0;
let bestScore = Number(localStorage.getItem('duskFlyerBestScore')) || 0;
let groundOffset = 0;      // scrolling offset for the ground texture
let animTime = 0;          // ms timestamp, drives wing-flap / bob animations
let muted = false;


/* =============================================================================
   3. SETUP — DOM references, canvas sizing, input handlers
   ============================================================================= */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('gameContainer');

const hud = document.getElementById('hud');
const liveScoreEl = document.getElementById('liveScore');
const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const startBestEl = document.getElementById('startBest');
const finalScoreEl = document.getElementById('finalScore');
const finalBestEl = document.getElementById('finalBest');
const newBestBadge = document.getElementById('newBestBadge');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const muteBtn = document.getElementById('muteBtn');

// Resize the canvas' internal pixel buffer to match however big the CSS
// layout has made the container, while keeping our drawing code entirely
// in the fixed 400x600 "logical" coordinate space (see CONFIG.world).
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();

  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  const scaleX = rect.width / CONFIG.world.width;
  const scaleY = rect.height / CONFIG.world.height;

  // One transform: device-pixel-ratio scaling combined with logical->CSS scaling.
  ctx.setTransform(dpr * scaleX, 0, 0, dpr * scaleY, 0, 0);
}

// ResizeObserver catches window resizes, orientation changes, and the very
// first layout pass (important on mobile where sizes settle asynchronously).
new ResizeObserver(resizeCanvas).observe(container);
resizeCanvas();

function updateScoreHUD() {
  liveScoreEl.textContent = String(score);
}

function initClouds() {
  clouds = [];
  const cloudCount = 5;
  for (let i = 0; i < cloudCount; i++) {
    clouds.push(randomCloud(Math.random() * CONFIG.world.width));
  }
}

function randomCloud(startX) {
  return {
    x: startX,
    y: 40 + Math.random() * 160,
    scale: 0.6 + Math.random() * 0.9,
    parallax: 0.25 + Math.random() * 0.35, // slower than pipes -> depth illusion
  };
}


/* =============================================================================
   4. SOUND — tiny synthesized effects via the Web Audio API.
   No audio files are loaded; every sound is generated on the fly, so there
   are zero copyright concerns and zero network requests.
   ============================================================================= */
let audioCtx = null;
let masterGain = null;

function ensureAudio() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return; // very old browser fallback: silently no-op
  audioCtx = new AC();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = muted ? 0 : 0.4;
  masterGain.connect(audioCtx.destination);
}

function playSound(type) {
  if (muted) return;
  ensureAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(masterGain);

  if (type === 'flap') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(480, t);
    osc.frequency.exponentialRampToValueAtTime(760, t + 0.08);
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.start(t);
    osc.stop(t + 0.12);
  } else if (type === 'score') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(680, t);
    osc.frequency.setValueAtTime(1020, t + 0.09);
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    osc.start(t);
    osc.stop(t + 0.27);
  } else if (type === 'hit') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.22);
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.start(t);
    osc.stop(t + 0.3);
  } else if (type === 'gameover') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(420, t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.5);
    gain.gain.setValueAtTime(0.28, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.start(t);
    osc.stop(t + 0.6);
  }
}

muteBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  muted = !muted;
  if (masterGain) masterGain.gain.value = muted ? 0 : 0.4;
  muteBtn.textContent = muted ? '🔇' : '🔊';
  muteBtn.title = muted ? 'Unmute sound' : 'Mute sound';
});


/* =============================================================================
   5. GAME LOGIC
   ============================================================================= */

function currentGap() {
  return Math.max(
    CONFIG.pipes.minGap,
    CONFIG.pipes.baseGap - score * CONFIG.pipes.gapShrinkPerPoint
  );
}

function currentSpeed() {
  return Math.min(
    CONFIG.pipes.maxSpeed,
    CONFIG.pipes.baseSpeed + score * CONFIG.pipes.speedGainPerPoint
  );
}

function addPipe(xPos) {
  const gap = currentGap();
  const margin = CONFIG.pipes.edgeMargin;
  const floor = CONFIG.world.height - CONFIG.world.groundHeight;
  const maxTop = floor - margin - gap;
  const topHeight = margin + Math.random() * Math.max(10, maxTop - margin);
  pipes.push({ x: xPos, topHeight, gap, passed: false });
}

function resetGame() {
  bird.y = CONFIG.world.height / 2;
  bird.velocity = 0;
  bird.rotation = 0;
  pipes = [];
  score = 0;
  groundOffset = 0;
  updateScoreHUD();
  // give the player a little runway before the first pipe arrives
  addPipe(CONFIG.world.width + 120);
}

function startGame() {
  resetGame();
  gameState = 'playing';
  startScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  hud.classList.remove('hidden');
}

function endGame() {
  if (gameState !== 'playing') return;
  gameState = 'gameover';
  playSound('hit');
  setTimeout(() => playSound('gameover'), 180);

  let isNewBest = false;
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem('duskFlyerBestScore', String(bestScore));
    isNewBest = true;
  }

  finalScoreEl.textContent = String(score);
  finalBestEl.textContent = String(bestScore);
  newBestBadge.classList.toggle('hidden', !isNewBest);

  hud.classList.add('hidden');
  gameOverScreen.classList.remove('hidden');
}

function flap() {
  if (gameState === 'start') {
    startGame();
    return;
  }
  if (gameState === 'gameover') {
    return; // must use the Restart button explicitly
  }
  bird.velocity = CONFIG.bird.flapVelocity;
  playSound('flap');
}

function checkPipeCollision(pipe) {
  const withinX =
    bird.x + CONFIG.bird.radius > pipe.x &&
    bird.x - CONFIG.bird.radius < pipe.x + CONFIG.pipes.width;
  if (!withinX) return false;

  const hitsTop = bird.y - CONFIG.bird.radius < pipe.topHeight;
  const hitsBottom = bird.y + CONFIG.bird.radius > pipe.topHeight + pipe.gap;
  return hitsTop || hitsBottom;
}

function updatePlaying() {
  // --- bird physics ---
  bird.velocity += CONFIG.bird.gravity;
  if (bird.velocity > CONFIG.bird.maxFallSpeed) {
    bird.velocity = CONFIG.bird.maxFallSpeed;
  }
  bird.y += bird.velocity;

  // visual tilt follows velocity: nose-up on flap, nose-down while falling
  const targetRotation = Math.max(
    CONFIG.bird.maxRotationUp,
    Math.min(CONFIG.bird.maxRotationDown, bird.velocity * 4.2)
  );
  bird.rotation = targetRotation;

  // don't let the bird fly above the top of the screen
  if (bird.y - CONFIG.bird.radius < 0) {
    bird.y = CONFIG.bird.radius;
    bird.velocity = 0;
  }

  const speed = currentSpeed();

  // --- move + recycle pipes ---
  for (const pipe of pipes) pipe.x -= speed;
  pipes = pipes.filter((p) => p.x + CONFIG.pipes.width > -20);

  const lastPipe = pipes[pipes.length - 1];
  if (!lastPipe || lastPipe.x < CONFIG.world.width - CONFIG.pipes.spacing) {
    addPipe(CONFIG.world.width + 20);
  }

  // --- scoring + collision ---
  for (const pipe of pipes) {
    if (!pipe.passed && pipe.x + CONFIG.pipes.width < bird.x - CONFIG.bird.radius) {
      pipe.passed = true;
      score += 1;
      updateScoreHUD();
      playSound('score');
    }
    if (checkPipeCollision(pipe)) {
      endGame();
      return;
    }
  }

  // --- ground collision ---
  const floor = CONFIG.world.height - CONFIG.world.groundHeight;
  if (bird.y + CONFIG.bird.radius >= floor) {
    bird.y = floor - CONFIG.bird.radius;
    endGame();
    return;
  }

  groundOffset -= speed;
}

function updateIdle() {
  // gentle bob while waiting on the start screen
  bird.y = CONFIG.world.height / 2 + Math.sin(animTime / 300) * 10;
  bird.rotation = Math.sin(animTime / 300) * 8;
}

function updateClouds(dt) {
  const baseSpeed = 0.4; // slow ambient drift, independent of pipe speed
  for (const cloud of clouds) {
    cloud.x -= baseSpeed * cloud.parallax * (dt / 16.7);
    if (cloud.x < -80) {
      Object.assign(cloud, randomCloud(CONFIG.world.width + 80));
    }
  }
}


/* =============================================================================
   6. DRAWING
   ============================================================================= */
const { world, colors } = CONFIG;

function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, world.height);
  g.addColorStop(0, colors.skyTop);
  g.addColorStop(0.55, colors.skyMid);
  g.addColorStop(1, colors.skyHorizon);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, world.width, world.height);

  // soft glowing sun/moon, upper-right
  const sunX = world.width - 80;
  const sunY = 90;
  const glow = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 70);
  glow.addColorStop(0, 'rgba(255,209,102,0.9)');
  glow.addColorStop(1, 'rgba(255,209,102,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(sunX - 70, sunY - 70, 140, 140);

  ctx.fillStyle = colors.sun;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 26, 0, Math.PI * 2);
  ctx.fill();
}

function drawCloudShape(cx, cy, scale) {
  ctx.fillStyle = colors.cloud;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 24 * scale, 14 * scale, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 18 * scale, cy + 4 * scale, 18 * scale, 12 * scale, 0, 0, Math.PI * 2);
  ctx.ellipse(cx - 18 * scale, cy + 5 * scale, 16 * scale, 11 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawClouds() {
  for (const cloud of clouds) {
    drawCloudShape(cloud.x, cloud.y, cloud.scale);
  }
}

function drawPipes() {
  const capH = 18;
  const capOverhang = 6;
  const floor = world.height - world.groundHeight;

  for (const pipe of pipes) {
    const bodyGrad = ctx.createLinearGradient(pipe.x, 0, pipe.x + CONFIG.pipes.width, 0);
    bodyGrad.addColorStop(0, colors.pipeBodyDark);
    bodyGrad.addColorStop(0.18, colors.pipeHighlight);
    bodyGrad.addColorStop(0.35, colors.pipeBody);
    bodyGrad.addColorStop(1, colors.pipeBodyDark);

    // --- top pipe ---
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(pipe.x, 0, CONFIG.pipes.width, pipe.topHeight - capH);
    ctx.fillStyle = colors.pipeCap;
    ctx.fillRect(
      pipe.x - capOverhang,
      pipe.topHeight - capH,
      CONFIG.pipes.width + capOverhang * 2,
      capH
    );

    // --- bottom pipe ---
    const bottomY = pipe.topHeight + pipe.gap;
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(pipe.x, bottomY + capH, CONFIG.pipes.width, floor - (bottomY + capH));
    ctx.fillStyle = colors.pipeCap;
    ctx.fillRect(pipe.x - capOverhang, bottomY, CONFIG.pipes.width + capOverhang * 2, capH);
  }
}

function drawGround() {
  const floor = world.height - world.groundHeight;

  // base
  ctx.fillStyle = colors.groundBase;
  ctx.fillRect(0, floor, world.width, world.groundHeight);

  // lighter top strip
  ctx.fillStyle = colors.groundTop;
  ctx.fillRect(0, floor, world.width, 14);

  // scrolling diagonal stripes for a sense of motion
  const tile = 34;
  ctx.fillStyle = colors.groundStripe;
  const offset = ((groundOffset % tile) + tile) % tile;
  for (let x = -tile + offset; x < world.width + tile; x += tile) {
    ctx.beginPath();
    ctx.moveTo(x, floor + 14);
    ctx.lineTo(x + 16, floor + 14);
    ctx.lineTo(x + 16 - 10, world.height);
    ctx.lineTo(x - 10, world.height);
    ctx.closePath();
    ctx.fill();
  }
}

function drawBird() {
  const wingAngle = Math.sin(animTime / 70) * 0.6; // continuous flap animation

  ctx.save();
  ctx.translate(bird.x, bird.y);
  ctx.rotate((bird.rotation * Math.PI) / 180);

  // body
  const bodyGrad = ctx.createLinearGradient(-16, -16, 16, 16);
  bodyGrad.addColorStop(0, colors.birdBody);
  bodyGrad.addColorStop(1, colors.birdBodyDark);
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  // belly
  ctx.fillStyle = colors.birdBelly;
  ctx.beginPath();
  ctx.ellipse(-2, 4, 10, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // wing (rotates around its base to fake a flap)
  ctx.save();
  ctx.translate(-2, 1);
  ctx.rotate(wingAngle);
  ctx.fillStyle = colors.birdWing;
  ctx.beginPath();
  ctx.ellipse(0, 0, 9, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // tail feather
  ctx.fillStyle = colors.birdBodyDark;
  ctx.beginPath();
  ctx.moveTo(-15, -2);
  ctx.lineTo(-24, -6);
  ctx.lineTo(-24, 2);
  ctx.closePath();
  ctx.fill();

  // beak
  ctx.fillStyle = colors.beak;
  ctx.beginPath();
  ctx.moveTo(13, -2);
  ctx.lineTo(24, 1);
  ctx.lineTo(13, 5);
  ctx.closePath();
  ctx.fill();

  // eye
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(6, -5, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1b1b';
  ctx.beginPath();
  ctx.arc(7.5, -5, 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, world.width, world.height);
  drawSky();
  drawClouds();
  drawPipes();
  drawGround();
  drawBird();
}


/* =============================================================================
   7. MAIN LOOP
   ============================================================================= */
function loop(timestamp) {
  animTime = timestamp;
  updateClouds(16.7); // ambient motion continues in every game state

  if (gameState === 'playing') {
    updatePlaying();
  } else if (gameState === 'start') {
    updateIdle();
  }
  // 'gameover' -> no physics update, frame stays frozen except clouds

  draw();
  requestAnimationFrame(loop);
}


/* =============================================================================
   INPUT HANDLING
   Spacebar, mouse click, and touch all trigger the same flap() action.
   preventDefault stops the page from scrolling/zooming on mobile or when
   Space is pressed on desktop.
   ============================================================================= */
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    flap();
  }
});

container.addEventListener('pointerdown', (e) => {
  // ignore taps on UI buttons — they have their own handlers
  if (e.target.closest('button')) return;
  e.preventDefault();
  flap();
});

// Buttons stop propagation so they don't also trigger a flap underneath them.
startBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  startGame();
});
restartBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  startGame();
});


/* =============================================================================
   INITIALIZATION
   ============================================================================= */
startBestEl.textContent = String(bestScore);
finalBestEl.textContent = String(bestScore);
initClouds();
requestAnimationFrame(loop);
