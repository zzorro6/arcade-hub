// ═══════════════════════════════════════════════════════════
//  FLAPPY RACE — original canvas implementation
//  Fixed-timestep physics + resolution-independent canvas sizing
//  so gameplay feels identical at any screen size or frame rate.
// ═══════════════════════════════════════════════════════════

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ── Config (all distances in "world units" == CSS pixels) ──
const C = {
    gravity: 1500,        // px/s^2
    flapVelocity: -430,   // px/s (instant upward velocity on flap)
    maxFallSpeed: 620,
    birdX: 90,
    birdRadius: 15,
    pipeWidth: 66,
    basePipeGap: 175,
    minPipeGap: 118,
    basePipeSpeed: 190,   // px/s
    maxPipeSpeed: 340,
    baseSpawnInterval: 1.45, // seconds
    minSpawnInterval: 1.0,
    groundH: 46,
    step: 1 / 120, // fixed physics step (seconds)
};

// ── Seeded RNG (for fair 1v1 matches) ───────────────────
// If embedded with ?seed=<matchId>, both players in a wager get the exact
// same pipe-gap sequence, so the outcome is decided purely by skill.
function cyrb53(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const seedParam = new URLSearchParams(window.location.search).get('seed');
const matchSeed = seedParam ? Number(cyrb53(seedParam) % 4294967296) : (Date.now() >>> 0);
const rng = mulberry32(matchSeed);

// ── Canvas sizing (resolution-independent) ─────────────────
let W = 0, H = 0; // CSS-pixel logical size
function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);

// ── State ──────────────────────────────────────────────────
let bird, pipes, particles, clouds;
let score = 0, best = parseInt(localStorage.getItem('fr_best') || '0');
let attempt = parseInt(localStorage.getItem('fr_attempts') || '0');
let playing = false, paused = false, dead = false, started = false;
let spawnTimer = 0;
let elapsed = 0;
let rafId = null;
let lastTs = 0;
let accumulator = 0;
let gameOverReported = false;

// ── Audio ────────────────────────────────────────────────
let audioCtx, masterGain;
let soundOn = false;
function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(audioCtx.destination);
}
function beep(freq, dur, type = 'sine', vol = 1) {
    if (!soundOn || !audioCtx) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(g);
    g.connect(masterGain);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
}
function sfx(name) {
    if (name === 'flap') beep(520, 0.08, 'square', 0.25);
    else if (name === 'score') beep(880, 0.12, 'triangle', 0.3);
    else if (name === 'hit') beep(120, 0.35, 'sawtooth', 0.35);
}

// ── Entities ───────────────────────────────────────────────
class Bird {
    constructor() {
        this.y = H / 2;
        this.vy = 0;
        this.rot = 0;
        this.hue = 42;
        this.trail = [];
    }
    flap() {
        this.vy = C.flapVelocity;
        sfx('flap');
    }
    step(dt) {
        this.vy += C.gravity * dt;
        if (this.vy > C.maxFallSpeed) this.vy = C.maxFallSpeed;
        this.y += this.vy * dt;
        this.rot = Math.max(-0.5, Math.min(1.3, this.vy / 500));
        this.trail.push({ x: C.birdX, y: this.y });
        if (this.trail.length > 14) this.trail.shift();
    }
    draw() {
        if (this.trail.length > 2) {
            ctx.save();
            for (let i = 1; i < this.trail.length; i++) {
                const t = i / this.trail.length;
                ctx.globalAlpha = t * 0.22;
                ctx.strokeStyle = `hsl(${this.hue}, 95%, 60%)`;
                ctx.lineWidth = t * 5;
                ctx.beginPath();
                ctx.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
                ctx.lineTo(this.trail[i].x, this.trail[i].y);
                ctx.stroke();
            }
            ctx.restore();
        }

        ctx.save();
        ctx.translate(C.birdX, this.y);
        ctx.rotate(this.rot);

        ctx.shadowColor = `hsl(${this.hue}, 95%, 55%)`;
        ctx.shadowBlur = 16;

        const grad = ctx.createLinearGradient(-C.birdRadius, -C.birdRadius, C.birdRadius, C.birdRadius);
        grad.addColorStop(0, '#ffe08a');
        grad.addColorStop(1, '#ff9a3c');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(0, 0, C.birdRadius, C.birdRadius * 0.82, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // wing
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.ellipse(-2, 3, 8, 5, Math.sin(elapsed * 18) * 0.4, 0, Math.PI * 2);
        ctx.fill();

        // beak
        ctx.fillStyle = '#ff5e3a';
        ctx.beginPath();
        ctx.moveTo(C.birdRadius - 2, -2);
        ctx.lineTo(C.birdRadius + 9, 1);
        ctx.lineTo(C.birdRadius - 2, 5);
        ctx.closePath();
        ctx.fill();

        // eye
        ctx.fillStyle = '#1a0f24';
        ctx.beginPath();
        ctx.arc(4, -5, 2.4, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
    hitbox() {
        return { x: C.birdX, y: this.y, r: C.birdRadius - 3 };
    }
}

class Pipe {
    constructor(x, gapY, gap) {
        this.x = x;
        this.gapY = gapY;
        this.gap = gap;
        this.passed = false;
    }
    step(dt, speed) {
        this.x -= speed * dt;
    }
    draw() {
        const grad = ctx.createLinearGradient(this.x, 0, this.x + C.pipeWidth, 0);
        grad.addColorStop(0, '#1f8f5f');
        grad.addColorStop(0.5, '#2fd68a');
        grad.addColorStop(1, '#1f8f5f');
        ctx.fillStyle = grad;
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 2;

        const topH = this.gapY - this.gap / 2;
        const bottomY = this.gapY + this.gap / 2;
        const bottomH = (H - C.groundH) - bottomY;

        ctx.fillRect(this.x, 0, C.pipeWidth, topH);
        ctx.strokeRect(this.x, 0, C.pipeWidth, topH);
        ctx.fillRect(this.x, bottomY, C.pipeWidth, bottomH);
        ctx.strokeRect(this.x, bottomY, C.pipeWidth, bottomH);

        // lip caps
        ctx.fillStyle = '#37c98a';
        ctx.fillRect(this.x - 4, topH - 18, C.pipeWidth + 8, 18);
        ctx.strokeRect(this.x - 4, topH - 18, C.pipeWidth + 8, 18);
        ctx.fillRect(this.x - 4, bottomY, C.pipeWidth + 8, 18);
        ctx.strokeRect(this.x - 4, bottomY, C.pipeWidth + 8, 18);
    }
    offscreen() { return this.x + C.pipeWidth < -10; }
}

class Particle {
    constructor(x, y, kind) {
        this.x = x; this.y = y; this.kind = kind;
        const angle = rand() * Math.PI * 2;
        const force = 60 + rand() * 180;
        this.vx = Math.cos(angle) * force;
        this.vy = Math.sin(angle) * force - 80;
        this.life = 1;
        this.size = 3 + rand() * 4;
        this.hue = 30 + rand() * 40;
    }
    step(dt) {
        this.vy += 700 * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt * 1.4;
    }
    draw() {
        if (this.life <= 0) return;
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = `hsl(${this.hue}, 90%, 60%)`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

// Cosmetic randomness only — never affects fairness.
function rand() { return Math.random(); }

function burst(x, y, n) {
    for (let i = 0; i < n; i++) particles.push(new Particle(x, y, 'burst'));
}

// ── Difficulty curve (never stops — speed/spawn keep tightening
//    with score, gap floors out so it always stays beatable) ──
function currentSpeed() {
    return Math.min(C.maxPipeSpeed, C.basePipeSpeed + score * 3.2);
}
function currentGap() {
    return Math.max(C.minPipeGap, C.basePipeGap - score * 1.6);
}
function currentSpawnInterval() {
    return Math.max(C.minSpawnInterval, C.baseSpawnInterval - score * 0.01);
}

function spawnPipe() {
    const margin = 60;
    const gap = currentGap();
    const minY = margin + gap / 2;
    const maxY = (H - C.groundH) - margin - gap / 2;
    const gapY = minY + rng() * Math.max(10, maxY - minY);
    pipes.push(new Pipe(W + 20, gapY, gap));
}

// ── Background (parallax hills + clouds) ────────────────────
let bgTime = 0;
function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H - C.groundH);
    sky.addColorStop(0, '#241233');
    sky.addColorStop(1, '#150a1a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H - C.groundH);

    // sun glow
    ctx.save();
    ctx.globalAlpha = 0.5;
    const glow = ctx.createRadialGradient(W * 0.78, H * 0.28, 10, W * 0.78, H * 0.28, 140);
    glow.addColorStop(0, 'rgba(255, 190, 90, 0.55)');
    glow.addColorStop(1, 'rgba(255, 190, 90, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H - C.groundH);
    ctx.restore();

    // clouds
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    clouds.forEach((c) => {
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, c.r, c.r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
    });

    // distant hills
    ctx.fillStyle = 'rgba(255,154,60,0.08)';
    ctx.beginPath();
    ctx.moveTo(0, H - C.groundH);
    for (let x = 0; x <= W; x += 20) {
        const y = (H - C.groundH) - 30 - Math.sin((x + bgTime * 20) * 0.01) * 18;
        ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H - C.groundH);
    ctx.closePath();
    ctx.fill();
}

function drawGround() {
    const y = H - C.groundH;
    const grad = ctx.createLinearGradient(0, y, 0, H);
    grad.addColorStop(0, '#3a2a1a');
    grad.addColorStop(1, '#241608');
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, W, C.groundH);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 2;
    const stripeW = 30;
    const offset = (elapsed * currentSpeed()) % stripeW;
    for (let x = -offset; x < W; x += stripeW) {
        ctx.beginPath();
        ctx.moveTo(x, y + 6);
        ctx.lineTo(x + 14, y + 6);
        ctx.stroke();
    }
}

// ── Collision ────────────────────────────────────────────
function circleRectHit(cx, cy, r, rx, ry, rw, rh) {
    const nx = Math.max(rx, Math.min(cx, rx + rw));
    const ny = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - nx, dy = cy - ny;
    return (dx * dx + dy * dy) < r * r;
}

function checkCollisions() {
    const hb = bird.hitbox();
    if (hb.y + hb.r > H - C.groundH || hb.y - hb.r < 0) return true;

    for (const p of pipes) {
        const topH = p.gapY - p.gap / 2;
        const bottomY = p.gapY + p.gap / 2;
        if (circleRectHit(hb.x, hb.y, hb.r, p.x, 0, C.pipeWidth, topH)) return true;
        if (circleRectHit(hb.x, hb.y, hb.r, p.x, bottomY, C.pipeWidth, H - C.groundH - bottomY)) return true;
    }
    return false;
}

// ── Game flow ────────────────────────────────────────────
function resetRun() {
    bird = new Bird();
    pipes = [];
    particles = [];
    score = 0;
    spawnTimer = 0;
    elapsed = 0;
    dead = false;
    started = false;
    gameOverReported = false;
    document.getElementById('score').textContent = '0';
    document.getElementById('gameOver').style.display = 'none';
}

function initClouds() {
    clouds = [];
    for (let i = 0; i < 6; i++) {
        clouds.push({ x: Math.random() * W, y: 30 + Math.random() * (H * 0.4), r: 30 + Math.random() * 40, speed: 8 + Math.random() * 10 });
    }
}

function flapInput() {
    if (!playing) return;
    if (paused) return;
    if (!started) {
        started = true;
    }
    if (dead) return;
    initAudio();
    bird.flap();
}

function update(dt) {
    if (!started || dead) return;

    elapsed += dt;
    bgTime += dt;

    clouds.forEach((c) => {
        c.x -= c.speed * dt;
        if (c.x < -c.r) { c.x = W + c.r; c.y = 30 + Math.random() * (H * 0.4); }
    });

    bird.step(dt);

    const speed = currentSpeed();
    spawnTimer += dt;
    if (spawnTimer >= currentSpawnInterval()) {
        spawnTimer = 0;
        spawnPipe();
    }

    pipes.forEach((p) => p.step(dt, speed));
    pipes = pipes.filter((p) => !p.offscreen());

    pipes.forEach((p) => {
        if (!p.passed && p.x + C.pipeWidth < C.birdX) {
            p.passed = true;
            score++;
            document.getElementById('score').textContent = String(score);
            sfx('score');
        }
    });

    particles.forEach((pt) => pt.step(dt));
    particles = particles.filter((pt) => pt.life > 0);

    if (checkCollisions()) {
        dead = true;
        sfx('hit');
        burst(C.birdX, bird.y, 22);
        showGameOver();
    }
}

function draw() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    pipes.forEach((p) => p.draw());
    particles.forEach((p) => p.draw());
    if (!dead) bird.draw();
    drawGround();

    if (!started && playing && !dead) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 15px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText('CLICK / TAP / SPACE TO FLAP', W / 2, H / 2);
        ctx.restore();
    }
}

function loop(ts) {
    if (!playing) return;
    if (!lastTs) lastTs = ts;
    let frameDt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (frameDt > 0.25) frameDt = 0.25; // clamp huge gaps (tab switch)

    if (!paused) {
        accumulator += frameDt;
        while (accumulator >= C.step) {
            update(C.step);
            accumulator -= C.step;
        }
    }

    draw();
    rafId = requestAnimationFrame(loop);
}

function startGame() {
    resizeCanvas();
    resetRun();
    initClouds();
    playing = true;
    paused = false;
    lastTs = 0;
    accumulator = 0;
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('restartBtn').style.display = 'none';
    if (!rafId) rafId = requestAnimationFrame(loop);
}

function showGameOver() {
    playing = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

    attempt++;
    localStorage.setItem('fr_attempts', attempt.toString());
    if (score > best) {
        best = score;
        localStorage.setItem('fr_best', best.toString());
    }
    document.getElementById('bestScore').textContent = best;
    document.getElementById('finalScore').textContent = score;
    document.getElementById('attemptNum').textContent = attempt;
    document.getElementById('gameOver').style.display = 'block';
    document.getElementById('restartBtn').style.display = 'inline-block';

    draw();

    if (!gameOverReported) {
        gameOverReported = true;
        try {
            window.parent.postMessage({ type: 'flappy-race-gameover', score }, '*');
        } catch (e) { /* not embedded, ignore */ }
    }
}

function togglePause() {
    if (!playing || dead) return;
    paused = !paused;
    document.getElementById('pauseMenu').style.display = paused ? 'block' : 'none';
    if (!paused) {
        lastTs = 0;
        if (!rafId) rafId = requestAnimationFrame(loop);
    }
}

// ── Input ────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); flapInput(); }
    if (e.key === 'p' || e.key === 'P') togglePause();
});
canvas.addEventListener('mousedown', flapInput);
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); flapInput(); }, { passive: false });

document.getElementById('startBtn').addEventListener('click', () => {
    initAudio();
    startGame();
});
document.getElementById('restartBtn').addEventListener('click', () => {
    startGame();
});
document.getElementById('resumeBtn').addEventListener('click', togglePause);
document.getElementById('soundBtn').addEventListener('click', (e) => {
    soundOn = !soundOn;
    initAudio();
    e.target.textContent = soundOn ? 'SOUND ON' : 'SOUND OFF';
    e.target.classList.toggle('active', soundOn);
});

// ── Boot ─────────────────────────────────────────────────
resizeCanvas();
document.getElementById('bestScore').textContent = best;
initClouds();
draw();

// If the arcade hub reloads this iframe mid-flow (e.g. starting a fresh
// wager), everything above re-initializes cleanly from scratch.
