// ═══════════════════════════════════════════════════════════
//  COLOR RUSH — classic gravity/jump color-switcher
// ═══════════════════════════════════════════════════════════

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ── Palette ─────────────────────────────────────────────
const COLORS = [
    { hex: '#ff3b3b', name: 'red' },
    { hex: '#3b82f6', name: 'blue' },
    { hex: '#22c55e', name: 'green' },
    { hex: '#facc15', name: 'yellow' },
];

// ── Config ──────────────────────────────────────────────
// Base visual sizes; these are scaled at runtime for smaller screens.
const BASE_C = {
    ballRadius: 11,
    ringRadius: 72,
    ringThickness: 14,
    ballScreenFrac: 0.70,   // camera keeps ball here
    gravity: -0.42,         // world units / frame^2 @60fps (pulls down)
    jumpImpulse: 5.5,       // world units / frame (shorter tap = lower)
    maxFallSpeed: -14,
    baseSpacing: 400,       // world units between obstacles
    minSpacing: 300,
    spacingPerScore: 3.5,
    baseAngularSpeed: 0.015,
    maxAngularSpeed: 0.09,
    angularSpeedPerScore: 0.0015,
    colorCountDropAt: 8,    // drop to 3 colors
    colorCountDrop2At: 20,  // drop to 2 colors
    arcShrinkAt: 12,        // shrink matching arc size from here
    arcShrinkRate: 0.05,    // reaches minimum arc 20 points after arcShrinkAt
    spawnAheadWorld: 1000,
    removeBehindWorld: 500,
    maxParticles: 160,
};

let C = { ...BASE_C };

// Scale game constants based on the rendered canvas width so the game plays
// well on phones without overlapping UI or tiny hit targets.
function scaleGameConstants() {
    const minDim = Math.min(CSS_W, CSS_H);
    // On a 400px-wide canvas, scale ~0.85; on 600px+, keep full size.
    const baseWidth = 520;
    const scale = Math.max(0.72, Math.min(1, minDim / baseWidth));

    C.ballRadius = BASE_C.ballRadius * scale;
    C.ringRadius = BASE_C.ringRadius * scale;
    C.ringThickness = Math.max(8, BASE_C.ringThickness * scale);
    C.jumpImpulse = BASE_C.jumpImpulse * (0.92 + scale * 0.08);
    C.baseSpacing = BASE_C.baseSpacing * (0.9 + scale * 0.1);
    C.minSpacing = BASE_C.minSpacing * (0.9 + scale * 0.1);
}

const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// ── Seeded RNG (for fair 1v1 matches) ───────────────────
// If the arcade hub embeds this game with ?seed=<matchId>, both players in a
// wager get the exact same ring color/rotation sequence, so the outcome is
// decided purely by skill and reaction time, not who got an easier layout.
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
// rng() drives all gameplay-affecting randomness (ring color order/rotation).
// Cosmetic effects (particles) keep using Math.random().
const rng = mulberry32(matchSeed);

// ── State ───────────────────────────────────────────────
let G = {};
let ball, particles = [];
let rings = [];
let lastRingWorldY = 0;
let animId;
let lastTime = 0;
let attempt = parseInt(localStorage.getItem('cr_attempts') || '0');
let bestScore = parseInt(localStorage.getItem('cr_best') || '0');

// ── Audio ───────────────────────────────────────────────
let audioCtx, sfxGain;
let soundOn = false;

function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = 0.4;
    sfxGain.connect(audioCtx.destination);
}

function sfx(type) {
    if (!soundOn || !audioCtx) return;
    const t = audioCtx.currentTime;
    if (type === 'jump') {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.connect(g); g.connect(sfxGain);
        o.type = 'sine';
        o.frequency.setValueAtTime(320, t);
        o.frequency.exponentialRampToValueAtTime(540, t + 0.12);
        g.gain.setValueAtTime(0.14, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        o.start(t); o.stop(t + 0.12);
    } else if (type === 'switch') {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.connect(g); g.connect(sfxGain);
        o.type = 'square';
        o.frequency.setValueAtTime(660, t);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        o.start(t); o.stop(t + 0.06);
    } else if (type === 'pass') {
        [660, 880].forEach((f, i) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.connect(g); g.connect(sfxGain);
            o.type = 'sine';
            o.frequency.value = f;
            g.gain.setValueAtTime(0.18, t + i * 0.03);
            g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.03 + 0.1);
            o.start(t + i * 0.03); o.stop(t + i * 0.03 + 0.1);
        });
    } else if (type === 'death') {
        const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.35, audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 0.05));
        const s = audioCtx.createBufferSource(); s.buffer = buf;
        const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.4, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        s.connect(f); f.connect(g); g.connect(sfxGain);
        s.start(t);
    }
}

// ── Canvas sizing ───────────────────────────────────────
// Use the container size and devicePixelRatio for crisp rendering on phones.
// CSS_W / CSS_H are the logical CSS-pixel dimensions used for all drawing.
let CSS_W = 0, CSS_H = 0;
function resize() {
    const wrap = canvas.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    CSS_W = wrap ? wrap.clientWidth : window.innerWidth;
    CSS_H = wrap ? wrap.clientHeight : window.innerHeight;

    // Avoid zero-size during page transitions / hidden iframe.
    if (CSS_W === 0 || CSS_H === 0) return;

    canvas.style.width = CSS_W + 'px';
    canvas.style.height = CSS_H + 'px';
    canvas.width = Math.floor(CSS_W * dpr);
    canvas.height = Math.floor(CSS_H * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scaleGameConstants();
}
resize();
window.addEventListener('resize', resize);

// ── Camera ──────────────────────────────────────────────
// worldY increases upward; cameraY is the worldY shown at the top of the canvas.
let cameraY = 0;
function screenY(worldY) { return cameraY - worldY; }
function updateCamera() {
    const target = ball.worldY + CSS_H * C.ballScreenFrac;
    // Camera follows the ball up (target gets larger) but never scrolls back down.
    cameraY = Math.max(cameraY, target);
}

// ── Particle ────────────────────────────────────────────
class Particle {
    constructor(x, y, hex, type) {
        this.x = x; this.y = y; this.hex = hex; this.type = type;
        const angle = Math.random() * Math.PI * 2;
        const force = type === 'shatter' ? Math.random() * 10 + 4 : Math.random() * 5 + 2;
        this.vx = Math.cos(angle) * force;
        this.vy = Math.sin(angle) * force;
        this.size = type === 'shatter' ? Math.random() * 5 + 2 : Math.random() * 4 + 2;
        this.life = 1;
        this.decay = type === 'shatter' ? 0.02 + Math.random() * 0.015 : 0.035;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.15;
        this.vx *= 0.98;
        this.life -= this.decay;
    }
    draw() {
        if (this.life <= 0) return;
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = this.hex;
        ctx.shadowColor = this.hex;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(this.x, this.y, Math.max(0.5, this.size * this.life), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    dead() { return this.life <= 0; }
}

// ── Color switcher ──────────────────────────────────────
class ColorSwitcher {
    constructor(worldY, targetColorIdx) {
        this.worldY = worldY;
        this.targetColorIdx = targetColorIdx;
        this.collected = false;
        this.pulse = 0;
    }
    update(frameScale) {
        this.pulse += 0.08 * frameScale;
    }
    draw(sy) {
        if (this.collected) return;
        const cx = CSS_W / 2;
        const r = 10 + Math.sin(this.pulse) * 2;
        const hex = COLORS[this.targetColorIdx].hex;
        ctx.save();
        ctx.fillStyle = hex;
        ctx.shadowColor = hex;
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(cx, sy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }
}

// ── Ring ────────────────────────────────────────────────
class Ring {
    constructor(worldY, scoreForDiff) {
        this.worldY = worldY;
        this.scoreForDiff = scoreForDiff;
        this.colorCount = this.chooseColorCount();
        this.colors = this.pickColors();
        this.targetColorIdx = this.colors[Math.floor(rng() * this.colors.length)];
        this.arcSizes = this.computeArcSizes();
        this.order = this.buildOrder();
        this.rotation = rng() * Math.PI * 2;
        const dir = rng() < 0.5 ? -1 : 1;
        const speedT = Math.min(1, scoreForDiff / 50);
        const angSpeed = C.baseAngularSpeed + (C.maxAngularSpeed - C.baseAngularSpeed) * speedT;
        this.angularSpeed = dir * angSpeed;
        this.entered = false;
        this.resolved = false;
    }
    chooseColorCount() {
        if (this.scoreForDiff >= C.colorCountDrop2At) return 2;
        if (this.scoreForDiff >= C.colorCountDropAt) return 3;
        return 4;
    }
    pickColors() {
        const all = [0, 1, 2, 3];
        for (let i = all.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [all[i], all[j]] = [all[j], all[i]];
        }
        return all.slice(0, this.colorCount);
    }
    computeArcSizes() {
        const total = Math.PI * 2;
        if (this.colorCount <= 1) return { target: total, other: total };
        // The safe arc must span at least 180° so the ball's entry (bottom) and
        // exit (top) can both be the safe color. It shrinks from 240° to 200°,
        // then only wheel speed raises the difficulty.
        let shrink = 1;
        if (this.scoreForDiff > C.arcShrinkAt) {
            shrink = Math.max(0, 1 - (this.scoreForDiff - C.arcShrinkAt) * C.arcShrinkRate);
        }
        const maxArc = (4 * Math.PI) / 3; // 240°
        const minArc = (10 * Math.PI) / 9; // 200°
        const targetArc = minArc + (maxArc - minArc) * shrink;
        const otherArc = (total - targetArc) / (this.colorCount - 1);
        return { target: targetArc, other: otherArc };
    }
    buildOrder() {
        const targetPos = Math.floor(rng() * this.colorCount);
        const items = [];
        for (let i = 0; i < this.colorCount; i++) {
            if (i === targetPos) {
                items.push({ colorIdx: this.targetColorIdx, size: this.arcSizes.target });
            } else {
                let c;
                do { c = this.colors[Math.floor(rng() * this.colors.length)]; } while (c === this.targetColorIdx);
                items.push({ colorIdx: c, size: this.arcSizes.other });
            }
        }
        return items;
    }
    colorAtAngle(angle) {
        let rel = (angle - this.rotation) % (Math.PI * 2);
        if (rel < 0) rel += Math.PI * 2;
        let a = 0;
        for (const item of this.order) {
            if (rel >= a && rel < a + item.size) return COLORS[item.colorIdx];
            a += item.size;
        }
        return COLORS[this.order[this.order.length - 1].colorIdx];
    }
    bottomColor() { return this.colorAtAngle(Math.PI / 2); }
    topColor() { return this.colorAtAngle(-Math.PI / 2); }
    update(frameScale) {
        this.rotation += this.angularSpeed * frameScale;
    }
    draw(sy) {
        const cx = CSS_W / 2;
        let a = this.rotation;
        for (const item of this.order) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, sy, C.ringRadius, a, a + item.size);
            const hex = COLORS[item.colorIdx].hex;
            ctx.strokeStyle = hex;
            ctx.lineWidth = C.ringThickness;
            ctx.shadowColor = hex;
            ctx.shadowBlur = item.colorIdx === this.targetColorIdx ? 18 : 5;
            ctx.globalAlpha = item.colorIdx === this.targetColorIdx ? 1 : 0.55;
            ctx.stroke();
            ctx.restore();
            a += item.size;
        }
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, sy + C.ringRadius - C.ringThickness);
        ctx.lineTo(cx, sy + C.ringRadius + C.ringThickness);
        ctx.stroke();
        ctx.restore();
    }
}

// ── Ball ────────────────────────────────────────────────
class Ball {
    constructor() {
        this.worldY = 0;
        this.vy = 0;
        this.colorIdx = 0;
        this.pulseT = 0;
        this.alive = true;
        this.rot = 0;
    }
    jump() {
        if (!this.alive) return;
        this.vy = C.jumpImpulse;
        this.pulseT = 1;
        sfx('jump');
    }
    update(frameScale) {
        if (!this.alive) return;
        this.vy += C.gravity * frameScale;
        if (this.vy < C.maxFallSpeed) this.vy = C.maxFallSpeed;
        this.worldY += this.vy * frameScale;
        this.pulseT = Math.max(0, this.pulseT - 0.06 * frameScale);
        this.rot += 0.05 * frameScale;
    }
    draw(sy) {
        const cx = CSS_W / 2;
        const hex = COLORS[this.colorIdx].hex;
        const r = C.ballRadius + this.pulseT * 5;
        ctx.save();
        ctx.translate(cx, sy);
        ctx.rotate(this.rot);
        ctx.shadowColor = hex;
        ctx.shadowBlur = 20;
        ctx.fillStyle = hex;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    }
}

// ── Obstacle spawning / recycling ───────────────────────
let switchers = [];

function nextSpacing(score) {
    return Math.max(C.minSpacing, C.baseSpacing - score * C.spacingPerScore);
}

function ensureContentAhead() {
    while (lastRingWorldY < ball.worldY + C.spawnAheadWorld) {
        const scoreForDiff = Math.max(G.score, rings.length);
        const spacing = nextSpacing(scoreForDiff);
        const prevRingWorldY = lastRingWorldY;
        lastRingWorldY += spacing;
        const ring = new Ring(lastRingWorldY, scoreForDiff);
        rings.push(ring);
        // Color switcher sits exactly in the middle of the gap between rings.
        switchers.push(new ColorSwitcher((prevRingWorldY + lastRingWorldY) / 2, ring.targetColorIdx));
    }
}

function pruneContent() {
    rings = rings.filter(r => r.worldY > ball.worldY - C.removeBehindWorld);
    switchers = switchers.filter(s => s.worldY > ball.worldY - C.removeBehindWorld);
}

// ── Flash overlay ──────────────────────────────────────
let flashAlpha = 0;
let flashColor = '#fff';
function flash(a, color) { flashAlpha = a; flashColor = color || '#fff'; }
function drawFlash() {
    if (flashAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = flashAlpha;
        ctx.fillStyle = flashColor;
        ctx.fillRect(0, 0, CSS_W, CSS_H);
        ctx.restore();
        flashAlpha = Math.max(0, flashAlpha - 0.05);
    }
}

// ── Score popup ─────────────────────────────────────────
function showScorePopup(x, y, text, color) {
    const el = document.createElement('div');
    el.className = 'score-popup';
    el.textContent = text;
    el.style.color = color || '#fff';
    const rect = canvas.getBoundingClientRect();
    el.style.left = (rect.left + x) + 'px';
    el.style.top = (rect.top + y) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 600);
}

// ── Init ────────────────────────────────────────────────
function init() {
    resize();
    ball = new Ball();
    particles = [];
    rings = [];
    switchers = [];
    lastRingWorldY = 0;
    cameraY = CSS_H * C.ballScreenFrac;
    G = {
        playing: false,
        paused: false,
        score: 0,
        dead: false,
        deathTimer: 0,
    };
    // First ring sits a comfortable jump above the ball.
    lastRingWorldY = C.baseSpacing * 0.8;
    const firstRing = new Ring(lastRingWorldY, 0);
    rings.push(firstRing);
    ball.colorIdx = firstRing.targetColorIdx; // start with the color needed for the first ring
    ensureContentAhead();
    updateUI();
}

function updateUI() {
    document.getElementById('score').textContent = G.score;
    document.getElementById('bestScore').textContent = bestScore;
}

// ── Game loop (fixed-timestep normalized) ─────────────────
function loop(ts) {
    if (!G.playing) return;
    if (G.paused) { lastTime = ts; animId = requestAnimationFrame(loop); return; }

    const dtMs = lastTime ? ts - lastTime : 16.7;
    lastTime = ts;
    const dt = Math.min(dtMs / 1000, 0.033);
    const frameScale = dt * 60;

    ctx.clearRect(0, 0, CSS_W, CSS_H);
    drawBackground();

    const cx = CSS_W / 2;

    if (!G.dead) {
        ball.update(frameScale);
        updateCamera();
        ensureContentAhead();

        rings.forEach(r => r.update(frameScale));
        switchers.forEach(s => s.update(frameScale));

        // Collect color switchers when the ball passes them going up.
        for (const s of switchers) {
            if (!s.collected && ball.worldY >= s.worldY && ball.vy > 0) {
                s.collected = true;
                ball.colorIdx = s.targetColorIdx;
                sfx('switch');
                flash(0.08, COLORS[s.targetColorIdx].hex);
            }
        }

        // Resolve ring collisions at the circle's edge: the ball must match
        // the color at the bottom of the circle on entry, and at the top on exit.
        for (const ring of rings) {
            if (ball.vy <= 0) continue;
            const ringBottom = ring.worldY - C.ringRadius;
            const ringTop = ring.worldY + C.ringRadius;
            if (!ring.entered && ball.worldY + C.ballRadius >= ringBottom) {
                ring.entered = true;
                const needed = ring.bottomColor();
                if (needed.name !== COLORS[ball.colorIdx].name) {
                    die(needed.hex);
                    break;
                }
            }
            if (!ring.resolved && ring.entered && ball.worldY - C.ballRadius >= ringTop) {
                ring.resolved = true;
                const needed = ring.topColor();
                const sy = screenY(ring.worldY);
                if (needed.name === COLORS[ball.colorIdx].name) {
                    G.score++;
                    sfx('pass');
                    flash(0.12, needed.hex);
                    for (let i = 0; i < 10; i++) particles.push(new Particle(cx, sy, needed.hex, 'pass'));
                    showScorePopup(cx, sy - 10, '+1', needed.hex);
                    updateUI();
                } else {
                    die(needed.hex);
                    break;
                }
            }
        }

        // Fell off the bottom of the screen.
        if (screenY(ball.worldY) > CSS_H + C.ballRadius * 2) {
            die('#fff');
        }

        pruneContent();
    } else {
        G.deathTimer++;
        if (G.deathTimer > 55) {
            showGameOver();
        }
    }

    // Draw switchers (below the ring they lead to)
    switchers.forEach(s => {
        const sy = screenY(s.worldY);
        if (sy < -C.ringRadius * 2 || sy > CSS_H + C.ringRadius * 2) return;
        s.draw(sy);
    });

    // Draw rings back-to-front by world order
    const sorted = [...rings].sort((a, b) => b.worldY - a.worldY);
    sorted.forEach(r => {
        const sy = screenY(r.worldY);
        if (sy < -C.ringRadius * 2 || sy > CSS_H + C.ringRadius * 2) return;
        r.draw(sy);
    });

    // Ball
    ball.draw(screenY(ball.worldY));

    // Particles
    particles = particles.filter(p => { p.update(); p.draw(); return !p.dead(); });
    if (particles.length > C.maxParticles) particles = particles.slice(particles.length - C.maxParticles);

    drawFlash();

    animId = requestAnimationFrame(loop);
}

function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, CSS_H);
    g.addColorStop(0, '#0a0a1a');
    g.addColorStop(1, '#14102a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CSS_W, CSS_H);

    // Vertical guide line along the ball's path
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(CSS_W / 2, 0);
    ctx.lineTo(CSS_W / 2, CSS_H);
    ctx.stroke();
    ctx.restore();
}

// ── Death ───────────────────────────────────────────────
function die(hex) {
    if (G.dead) return;
    G.dead = true;
    G.deathTimer = 0;
    ball.alive = false;
    ball.vy = 0;

    const cx = CSS_W / 2;
    const sy = screenY(ball.worldY);
    for (let i = 0; i < 30; i++) {
        particles.push(new Particle(cx, sy, hex || '#fff', 'shatter'));
    }
    flash(0.5, '#ff3b3b');
    sfx('death');

    if (G.score > bestScore) {
        bestScore = G.score;
        localStorage.setItem('cr_best', bestScore.toString());
    }
    attempt++;
    localStorage.setItem('cr_attempts', attempt.toString());
}

function showGameOver() {
    G.playing = false;
    cancelAnimationFrame(animId);
    document.getElementById('finalScore').textContent = G.score;
    document.getElementById('attemptNum').textContent = attempt;
    document.getElementById('gameOver').style.display = 'block';
    document.getElementById('restartBtn').style.display = 'inline-block';
    document.getElementById('startBtn').style.display = 'none';
    updateUI();

    try {
        window.parent.postMessage({ type: 'color-rush-gameover', score: G.score }, '*');
    } catch (e) { /* not embedded, ignore */ }
}

// ── Start / Restart ────────────────────────────────────
function startGame() {
    init();
    document.getElementById('gameOver').style.display = 'none';
    document.getElementById('pauseMenu').style.display = 'none';
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('restartBtn').style.display = 'none';
    G.countdown = 3;
    showCountdown();
}

function showCountdown() {
    const el = document.getElementById('countdown');
    if (G.countdown > 0) {
        el.textContent = G.countdown;
        el.style.display = 'block';
        G.countdown--;
        setTimeout(showCountdown, 1000);
    } else {
        el.textContent = 'GO';
        setTimeout(() => {
            el.style.display = 'none';
            beginRun();
        }, 500);
    }
}

function beginRun() {
    G.playing = true;
    document.getElementById('restartBtn').style.display = 'inline-block';
    lastTime = 0;
    if (soundOn) initAudio();
    ball.jump();
    animId = requestAnimationFrame(loop);
}

function togglePause() {
    if (!G.playing || G.dead) return;
    G.paused = !G.paused;
    document.getElementById('pauseMenu').style.display = G.paused ? 'block' : 'none';
    if (!G.paused) { lastTime = 0; animId = requestAnimationFrame(loop); }
}

// ── Input ───────────────────────────────────────────────
function handleJump(e) {
    if (e) e.preventDefault();
    if (!G.playing || G.paused || G.dead) return;
    ball.jump();
}

document.addEventListener('keydown', e => {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        handleJump(e);
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault();
        togglePause();
    }
});

canvas.addEventListener('click', handleJump);

canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    handleJump(e);
}, { passive: false });

// Also allow taps anywhere on the game page on mobile (not just the canvas).
// This catches touches that land slightly outside the canvas border on small screens.
if (isTouchDevice) {
    document.body.addEventListener('touchstart', e => {
        // Ignore touches on buttons/inputs so UI remains usable.
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
        e.preventDefault();
        handleJump(e);
    }, { passive: false });
}

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('restartBtn').addEventListener('click', startGame);
document.getElementById('resumeBtn').addEventListener('click', togglePause);

const soundBtn = document.getElementById('soundBtn');
soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? 'SOUND ON' : 'SOUND OFF';
    soundBtn.classList.toggle('active', soundOn);
    if (soundOn) initAudio();
});

// ── Boot ────────────────────────────────────────────────
init();
updateUI();

function drawIdle() {
    if (G.playing) return;
    ctx.clearRect(0, 0, CSS_W, CSS_H);
    drawBackground();
    const cx = CSS_W / 2;
    switchers.forEach(s => {
        const sy = screenY(s.worldY);
        if (sy > -C.ringRadius * 2 && sy < CSS_H + C.ringRadius * 2) s.draw(sy);
    });
    rings.forEach(r => {
        r.update(0.5);
        const sy = screenY(r.worldY);
        if (sy > -C.ringRadius * 2 && sy < CSS_H + C.ringRadius * 2) r.draw(sy);
    });
    ball.rot += 0.02;
    ball.draw(screenY(ball.worldY));
    requestAnimationFrame(drawIdle);
}
drawIdle();
