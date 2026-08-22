// ═══════════════════════════════════════════════════════════
//  GEOMETRY RUSH — 2025 EDITION
// ═══════════════════════════════════════════════════════════

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ── Config ──────────────────────────────────────────────
const C = {
    gravity: 0.65,
    jumpForce: -12.5,
    playerSize: 28,
    baseSpeed: 5.5,
    groundH: 48,
    coyoteFrames: 6,
    jumpBuffer: 8,
    levelLength: 2400,      // distance units for 100%
    maxParticles: 120,
};

// ── State ───────────────────────────────────────────────
let G = {};
let player, cam;
let obstacles = [], orbs = [], particles = [], bgShapes = [], stars = [], hills = [];
let animId, lastSpawn, lastOrbSpawn;
let attempt = parseInt(localStorage.getItem('gd_attempts') || '0');
let bestScore = parseInt(localStorage.getItem('gd_best') || '0');

// ── Audio ───────────────────────────────────────────────
let audioCtx, masterGain, musicGain, sfxGain;
let soundOn = false;
let musicPlaying = false;

function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.connect(audioCtx.destination);
    musicGain = audioCtx.createGain();
    musicGain.gain.value = 0.25;
    musicGain.connect(masterGain);
    sfxGain = audioCtx.createGain();
    sfxGain.gain.value = 0.4;
    sfxGain.connect(masterGain);
}

function sfx(type) {
    if (!soundOn || !audioCtx) return;
    const t = audioCtx.currentTime;
    if (type === 'jump') {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.connect(g); g.connect(sfxGain);
        o.type = 'sine';
        o.frequency.setValueAtTime(520, t);
        o.frequency.exponentialRampToValueAtTime(780, t + 0.07);
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        o.start(t); o.stop(t + 0.1);
    } else if (type === 'land') {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.connect(g); g.connect(sfxGain);
        o.type = 'triangle';
        o.frequency.setValueAtTime(200, t);
        o.frequency.exponentialRampToValueAtTime(80, t + 0.06);
        g.gain.setValueAtTime(0.15, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        o.start(t); o.stop(t + 0.06);
    } else if (type === 'orb') {
        [600, 800, 1000].forEach((f, i) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.connect(g); g.connect(sfxGain);
            o.type = 'sine';
            o.frequency.value = f;
            g.gain.setValueAtTime(0.18, t + i * 0.04);
            g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.04 + 0.12);
            o.start(t + i * 0.04); o.stop(t + i * 0.04 + 0.12);
        });
    } else if (type === 'death') {
        // noise burst
        const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.4, audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 0.06));
        const s = audioCtx.createBufferSource(); s.buffer = buf;
        const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.4, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        s.connect(f); f.connect(g); g.connect(sfxGain);
        s.start(t);
        // low boom
        const o = audioCtx.createOscillator();
        const og = audioCtx.createGain();
        o.connect(og); og.connect(sfxGain);
        o.frequency.setValueAtTime(120, t);
        o.frequency.exponentialRampToValueAtTime(25, t + 0.25);
        og.gain.setValueAtTime(0.35, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.start(t); o.stop(t + 0.3);
    }
}

// ── Music ───────────────────────────────────────────────
function startMusic() {
    if (!soundOn || !audioCtx || musicPlaying) return;
    musicPlaying = true;
    playMusicBar();
}

function playMusicBar() {
    if (!musicPlaying || !soundOn) return;
    const t = audioCtx.currentTime;
    const bpm = 140;
    const beat = 60 / bpm;

    // Driving bass
    const bassNotes = [110, 110, 147, 131, 110, 110, 165, 147,
                       110, 110, 147, 131, 110, 110, 196, 165];
    bassNotes.forEach((freq, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        const f = audioCtx.createBiquadFilter();
        o.type = 'sawtooth';
        f.type = 'lowpass';
        f.frequency.value = 400 + Math.sin(i * 0.5) * 200;
        f.Q.value = 5;
        o.frequency.value = freq;
        g.gain.setValueAtTime(0, t + i * beat);
        g.gain.linearRampToValueAtTime(0.12, t + i * beat + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * beat + beat * 0.85);
        o.connect(f); f.connect(g); g.connect(musicGain);
        o.start(t + i * beat); o.stop(t + (i + 1) * beat);
    });

    // Melody — pentatonic feel
    const melody = [440, 523, 587, 523, 659, 587, 523, 784,
                    440, 523, 587, 523, 659, 784, 880, 784];
    melody.forEach((freq, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'triangle';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0, t + i * beat);
        g.gain.linearRampToValueAtTime(0.06, t + i * beat + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * beat + beat * 0.5);
        o.connect(g); g.connect(musicGain);
        o.start(t + i * beat); o.stop(t + (i + 1) * beat);
    });

    // Kick on every beat
    for (let i = 0; i < 16; i++) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.frequency.setValueAtTime(160, t + i * beat);
        o.frequency.exponentialRampToValueAtTime(35, t + i * beat + 0.05);
        g.gain.setValueAtTime(0.22, t + i * beat);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * beat + 0.09);
        o.connect(g); g.connect(musicGain);
        o.start(t + i * beat); o.stop(t + i * beat + 0.1);
    }

    // Hi-hat
    for (let i = 0; i < 16; i++) {
        const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.025, audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        for (let j = 0; j < d.length; j++) d[j] = (Math.random() * 2 - 1) * Math.exp(-j / (audioCtx.sampleRate * 0.004));
        const s = audioCtx.createBufferSource(); s.buffer = buf;
        const f = audioCtx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(i % 2 === 0 ? 0.06 : 0.03, t + i * beat);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * beat + 0.025);
        s.connect(f); f.connect(g); g.connect(musicGain);
        s.start(t + i * beat);
    }

    setTimeout(() => playMusicBar(), beat * 16 * 1000);
}

function stopMusic() { musicPlaying = false; }

// ── Canvas sizing ───────────────────────────────────────
function resize() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
}
resize();
window.addEventListener('resize', resize);

// ── Background shapes (floating geometry) ───────────────
class BgShape {
    constructor() {
        this.reset(true);
    }
    reset(initial) {
        this.x = initial ? Math.random() * canvas.width : canvas.width + 50;
        this.y = Math.random() * (canvas.height - C.groundH - 40);
        this.size = Math.random() * 18 + 6;
        this.speed = Math.random() * 0.6 + 0.15;
        this.rot = Math.random() * Math.PI * 2;
        this.rotSpeed = (Math.random() - 0.5) * 0.01;
        this.sides = [3, 4, 5, 6][Math.floor(Math.random() * 4)];
        this.alpha = Math.random() * 0.06 + 0.02;
    }
    update(spd) {
        this.x -= this.speed * spd;
        this.rot += this.rotSpeed;
        if (this.x < -30) this.reset(false);
    }
    draw(hue) {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rot);
        ctx.strokeStyle = `hsl(${hue}, 60%, 50%)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= this.sides; i++) {
            const a = (i / this.sides) * Math.PI * 2;
            const method = i === 0 ? 'moveTo' : 'lineTo';
            ctx[method](Math.cos(a) * this.size, Math.sin(a) * this.size);
        }
        ctx.stroke();
        ctx.restore();
    }
}

// ── Stars (parallax) ───────────────────────────────────
class Star {
    constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * (canvas.height - C.groundH);
        this.r = Math.random() * 1.5 + 0.3;
        this.speed = this.r * 0.3;
        this.twinkle = Math.random() * Math.PI * 2;
    }
    update(spd) {
        this.x -= this.speed * spd;
        this.twinkle += 0.03;
        if (this.x < -2) { this.x = canvas.width + 2; this.y = Math.random() * (canvas.height - C.groundH); }
    }
    draw(hue) {
        const a = 0.3 + Math.sin(this.twinkle) * 0.2;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = `hsl(${hue + 30}, 40%, 70%)`;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// ── Rolling Hills (parallax layers) ────────────────────
class HillLayer {
    constructor(depth) {
        // depth: 0 = farthest, 1 = mid, 2 = nearest
        this.depth = depth;
        this.speed = 0.15 + depth * 0.25;  // farther = slower
        this.offset = 0;
        this.alpha = 0.06 + depth * 0.04;  // nearer = more opaque
        this.baseY = 0.45 - depth * 0.08;  // fraction of playable height; nearer = lower
        this.amplitude = 25 + depth * 15;  // nearer = taller hills
        this.frequency = 0.004 + depth * 0.002; // nearer = wider hills
        // Each layer has its own set of harmonic offsets for organic shape
        this.phase1 = Math.random() * 1000;
        this.phase2 = Math.random() * 1000;
        this.phase3 = Math.random() * 1000;
    }
    update(spd) {
        this.offset += this.speed * spd * 0.4;
    }
    draw(hue) {
        const groundTop = canvas.height - C.groundH;
        const baseY = groundTop * (1 - this.baseY);

        ctx.save();
        ctx.globalAlpha = this.alpha;

        // Gradient fill for each hill layer
        const grad = ctx.createLinearGradient(0, baseY - this.amplitude, 0, groundTop);
        const h = (hue + this.depth * 40) % 360;
        grad.addColorStop(0, `hsl(${h}, 35%, ${18 + this.depth * 5}%)`);
        grad.addColorStop(1, `hsl(${h}, 30%, ${8 + this.depth * 3}%)`);
        ctx.fillStyle = grad;

        ctx.beginPath();
        ctx.moveTo(0, groundTop);

        // Generate smooth rolling hill curve using layered sine waves
        for (let x = 0; x <= canvas.width; x += 3) {
            const wx = x + this.offset;
            const y = baseY
                + Math.sin(wx * this.frequency + this.phase1) * this.amplitude
                + Math.sin(wx * this.frequency * 0.5 + this.phase2) * this.amplitude * 0.6
                + Math.sin(wx * this.frequency * 2.1 + this.phase3) * this.amplitude * 0.2;
            ctx.lineTo(x, y);
        }

        ctx.lineTo(canvas.width, groundTop);
        ctx.closePath();
        ctx.fill();

        // Subtle top edge highlight
        ctx.globalAlpha = this.alpha * 0.5;
        ctx.strokeStyle = `hsl(${h}, 50%, ${30 + this.depth * 8}%)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= canvas.width; x += 3) {
            const wx = x + this.offset;
            const y = baseY
                + Math.sin(wx * this.frequency + this.phase1) * this.amplitude
                + Math.sin(wx * this.frequency * 0.5 + this.phase2) * this.amplitude * 0.6
                + Math.sin(wx * this.frequency * 2.1 + this.phase3) * this.amplitude * 0.2;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.restore();
    }
}

// ── Particle ────────────────────────────────────────────
class Particle {
    constructor(x, y, type) {
        this.x = x; this.y = y; this.type = type;
        if (type === 'shatter') {
            const angle = Math.random() * Math.PI * 2;
            const force = Math.random() * 12 + 4;
            this.vx = Math.cos(angle) * force;
            this.vy = Math.sin(angle) * force;
            this.size = Math.random() * 6 + 3;
            this.rot = Math.random() * Math.PI * 2;
            this.rotV = (Math.random() - 0.5) * 0.4;
            this.life = 1;
            this.decay = 0.015 + Math.random() * 0.01;
        } else if (type === 'trail') {
            this.vx = (Math.random() - 0.5) * 2;
            this.vy = (Math.random() - 0.5) * 2 - 1;
            this.size = Math.random() * 3 + 1;
            this.life = 1;
            this.decay = 0.03 + Math.random() * 0.02;
            this.rot = 0; this.rotV = 0;
        } else if (type === 'land') {
            this.vx = (Math.random() - 0.5) * 6;
            this.vy = -Math.random() * 4 - 1;
            this.size = Math.random() * 3 + 1;
            this.life = 1;
            this.decay = 0.04;
            this.rot = 0; this.rotV = 0;
        } else if (type === 'orb') {
            const angle = Math.random() * Math.PI * 2;
            const force = Math.random() * 5 + 2;
            this.vx = Math.cos(angle) * force;
            this.vy = Math.sin(angle) * force;
            this.size = Math.random() * 4 + 2;
            this.life = 1;
            this.decay = 0.03;
            this.rot = 0; this.rotV = 0;
        }
        this.hue = Math.random() * 60;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.2;
        this.vx *= 0.99;
        this.rot += this.rotV;
        this.life -= this.decay;
    }
    draw(baseHue) {
        if (this.life <= 0) return;
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rot);
        const h = this.type === 'orb' ? 45 : (baseHue + this.hue) % 360;
        const l = this.type === 'orb' ? 65 : 55;
        ctx.fillStyle = `hsl(${h}, 100%, ${l}%)`;
        ctx.shadowColor = `hsl(${h}, 100%, ${l}%)`;
        ctx.shadowBlur = 6;
        if (this.type === 'shatter') {
            ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
        } else {
            ctx.beginPath();
            ctx.arc(0, 0, Math.max(0.5, this.size * this.life), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
    dead() { return this.life <= 0; }
}

// ── Obstacle ────────────────────────────────────────────
class Obstacle {
    constructor(x, type) {
        this.x = x;
        this.type = type; // 'spike', 'block', 'spike2', 'spike3', 'pillar'
        this.hue = Math.random() * 360;
        this.passed = false;

        switch (type) {
            case 'spike':
                this.w = 28; this.h = 36;
                break;
            case 'spike2': // double spike
                this.w = 56; this.h = 36;
                break;
            case 'spike3': // triple spike
                this.w = 84; this.h = 36;
                break;
            case 'block':
                this.w = 40; this.h = 40;
                break;
            case 'pillar':
                this.w = 24; this.h = 70;
                break;
            default:
                this.w = 28; this.h = 36;
        }
        this.y = canvas.height - C.groundH - this.h;
    }
    update(spd) {
        this.x -= spd;
        this.hue = (this.hue + 0.8) % 360;
    }
    draw() {
        ctx.save();
        const g = ctx.createLinearGradient(this.x, this.y, this.x + this.w, this.y + this.h);
        g.addColorStop(0, `hsl(${this.hue}, 85%, 55%)`);
        g.addColorStop(1, `hsl(${(this.hue + 40) % 360}, 85%, 35%)`);
        ctx.fillStyle = g;
        ctx.shadowColor = `hsl(${this.hue}, 100%, 50%)`;
        ctx.shadowBlur = 12;

        if (this.type === 'spike') {
            this.drawSpike(this.x, this.y, this.w, this.h);
        } else if (this.type === 'spike2') {
            this.drawSpike(this.x, this.y, 28, this.h);
            this.drawSpike(this.x + 28, this.y, 28, this.h);
        } else if (this.type === 'spike3') {
            this.drawSpike(this.x, this.y, 28, this.h);
            this.drawSpike(this.x + 28, this.y, 28, this.h);
            this.drawSpike(this.x + 56, this.y, 28, this.h);
        } else if (this.type === 'block') {
            ctx.fillRect(this.x, this.y, this.w, this.h);
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 2;
            ctx.strokeRect(this.x, this.y, this.w, this.h);
            // inner cross
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y); ctx.lineTo(this.x + this.w, this.y + this.h);
            ctx.moveTo(this.x + this.w, this.y); ctx.lineTo(this.x, this.y + this.h);
            ctx.stroke();
        } else if (this.type === 'pillar') {
            ctx.fillRect(this.x, this.y, this.w, this.h);
            ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            ctx.lineWidth = 2;
            ctx.strokeRect(this.x, this.y, this.w, this.h);
            // stripes
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            for (let i = 0; i < this.h; i += 10) {
                ctx.fillRect(this.x, this.y + i, this.w, 5);
            }
        }
        ctx.restore();
    }
    drawSpike(x, y, w, h) {
        ctx.beginPath();
        ctx.moveTo(x + w / 2, y);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
    offscreen() { return this.x + this.w < -10; }
    hitbox() {
        // Forgiving hitboxes — shrink by 6px on each side
        const pad = 6;
        if (this.type.startsWith('spike')) {
            // Triangle hitbox approximation — narrower at top
            return { x: this.x + pad + 4, y: this.y + this.h * 0.3, w: this.w - pad * 2 - 8, h: this.h * 0.7 - pad };
        }
        return { x: this.x + pad, y: this.y + pad, w: this.w - pad * 2, h: this.h - pad * 2 };
    }
}

// ── Orb (collectible) ──────────────────────────────────
class Orb {
    constructor(x, y) {
        this.x = x;
        this.y = y || (canvas.height - C.groundH - 80 - Math.random() * 60);
        this.size = 10;
        this.rot = 0;
        this.pulse = Math.random() * Math.PI * 2;
        this.collected = false;
    }
    update(spd) {
        this.x -= spd;
        this.rot += 0.04;
        this.pulse += 0.08;
    }
    draw() {
        if (this.collected) return;
        const s = this.size + Math.sin(this.pulse) * 2;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rot);

        // Outer glow
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 15;

        // Diamond shape
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.7, 0);
        ctx.lineTo(0, s);
        ctx.lineTo(-s * 0.7, 0);
        ctx.closePath();
        ctx.fill();

        // Inner highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.5);
        ctx.lineTo(s * 0.3, 0);
        ctx.lineTo(0, s * 0.5);
        ctx.lineTo(-s * 0.3, 0);
        ctx.closePath();
        ctx.fill();

        ctx.restore();

        // Sparkle dots
        for (let i = 0; i < 3; i++) {
            const a = this.pulse + i * 2.1;
            const r = s + 6 + Math.sin(a * 1.5) * 4;
            ctx.save();
            ctx.globalAlpha = 0.4 + Math.sin(a) * 0.3;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(this.x + Math.cos(a) * r, this.y + Math.sin(a) * r, 1.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }
    offscreen() { return this.x < -20; }
    hits(p) {
        if (this.collected) return false;
        const dx = this.x - (p.x + p.size / 2);
        const dy = this.y - (p.y + p.size / 2);
        return Math.sqrt(dx * dx + dy * dy) < this.size + p.size * 0.6;
    }
}

// ── Player ──────────────────────────────────────────────
class Player {
    constructor() {
        this.size = C.playerSize;
        this.x = 80;
        this.y = canvas.height - C.groundH - this.size;
        this.vy = 0;
        this.onGround = true;
        this.rot = 0;
        this.hue = 0;
        this.coyote = 0;     // frames since last grounded
        this.jumpBuf = 0;    // frames since jump pressed
        this.wasOnGround = false;
        this.trail = [];     // position history for ribbon trail
        this.alive = true;
    }
    jump() {
        if (!this.alive) return;
        if (this.onGround || this.coyote < C.coyoteFrames) {
            this.vy = C.jumpForce;
            this.onGround = false;
            this.coyote = C.coyoteFrames; // consume coyote time
            this.jumpBuf = 0;
            sfx('jump');
        } else {
            this.jumpBuf = C.jumpBuffer; // buffer the input
        }
    }
    update() {
        if (!this.alive) return;

        // Gravity
        this.vy += C.gravity;
        this.y += this.vy;

        // Ground
        const groundY = canvas.height - C.groundH - this.size;
        this.wasOnGround = this.onGround;
        if (this.y >= groundY) {
            this.y = groundY;
            if (!this.onGround && this.vy > 2) {
                // Landing particles
                for (let i = 0; i < 6; i++) {
                    particles.push(new Particle(this.x + this.size / 2, groundY + this.size, 'land'));
                }
                sfx('land');
            }
            this.vy = 0;
            this.onGround = true;
            this.coyote = 0;
            this.rot = Math.round(this.rot / 90) * 90; // snap rotation
        } else {
            this.onGround = false;
            this.coyote++;
        }

        // Buffered jump
        if (this.jumpBuf > 0) {
            this.jumpBuf--;
            if (this.onGround) {
                this.jump();
            }
        }

        // Rotation
        if (!this.onGround) {
            this.rot += 4.5;
        }

        // Color
        this.hue = (this.hue + 1.5) % 360;

        // Trail
        this.trail.push({ x: this.x + this.size / 2, y: this.y + this.size / 2 });
        if (this.trail.length > 18) this.trail.shift();

        // Trail particles
        if (Math.random() > 0.6) {
            particles.push(new Particle(
                this.x + Math.random() * 4,
                this.y + this.size / 2 + (Math.random() - 0.5) * this.size * 0.6,
                'trail'
            ));
        }
    }
    draw() {
        if (!this.alive) return;

        // Draw trail ribbon
        if (this.trail.length > 2) {
            ctx.save();
            for (let i = 1; i < this.trail.length; i++) {
                const t = i / this.trail.length;
                ctx.globalAlpha = t * 0.25;
                ctx.strokeStyle = `hsl(${(this.hue + i * 5) % 360}, 100%, 55%)`;
                ctx.lineWidth = t * 4;
                ctx.beginPath();
                ctx.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
                ctx.lineTo(this.trail[i].x, this.trail[i].y);
                ctx.stroke();
            }
            ctx.restore();
        }

        // Draw player
        ctx.save();
        ctx.translate(this.x + this.size / 2, this.y + this.size / 2);
        ctx.rotate(this.rot * Math.PI / 180);

        const grad = ctx.createLinearGradient(-this.size / 2, -this.size / 2, this.size / 2, this.size / 2);
        grad.addColorStop(0, `hsl(${this.hue}, 100%, 55%)`);
        grad.addColorStop(1, `hsl(${(this.hue + 50) % 360}, 100%, 45%)`);

        // Glow
        ctx.shadowColor = `hsl(${this.hue}, 100%, 55%)`;
        ctx.shadowBlur = 18;

        // Body
        ctx.fillStyle = grad;
        ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);

        // Border
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2;
        ctx.strokeRect(-this.size / 2, -this.size / 2, this.size, this.size);

        // Inner highlight
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(-this.size / 4, -this.size / 4, this.size / 2, this.size / 2);

        // Eye detail (small circle)
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(this.size * 0.15, -this.size * 0.05, this.size * 0.12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.beginPath();
        ctx.arc(this.size * 0.18, -this.size * 0.05, this.size * 0.06, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

// ── Camera (screen shake) ──────────────────────────────
class Camera {
    constructor() { this.x = 0; this.y = 0; this.trauma = 0; }
    shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }
    update() {
        this.trauma = Math.max(0, this.trauma - 0.03);
        const shake = this.trauma * this.trauma;
        this.x = (Math.random() - 0.5) * shake * 16;
        this.y = (Math.random() - 0.5) * shake * 16;
    }
}

// ── Obstacle pattern spawner ────────────────────────────
const PATTERNS = [
    // [type, offsetX]
    [['spike', 0]],
    [['block', 0]],
    [['spike2', 0]],
    [['spike', 0], ['spike', 60]],
    [['block', 0], ['spike', 55]],
    [['spike3', 0]],
    [['pillar', 0]],
    [['spike', 0], ['block', 50], ['spike', 100]],
    [['pillar', 0], ['spike', 40]],
    [['spike', 0], ['spike', 45], ['spike', 90]],
];

function spawnPattern(baseX) {
    const difficulty = Math.min(G.score / 30, 1); // 0 to 1
    // More complex patterns at higher difficulty
    const maxIdx = Math.floor(2 + difficulty * (PATTERNS.length - 2));
    const pattern = PATTERNS[Math.floor(Math.random() * maxIdx)];
    pattern.forEach(([type, offset]) => {
        obstacles.push(new Obstacle(baseX + offset, type));
    });
}

function spawnOrb(baseX) {
    if (Math.random() < 0.35) {
        const gap = 40 + Math.random() * 80;
        orbs.push(new Orb(baseX + gap));
    }
}

// ── Drawing helpers ─────────────────────────────────────
function drawBackground(hue) {
    // Gradient sky
    const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height - C.groundH);
    skyGrad.addColorStop(0, `hsl(${hue}, 30%, 6%)`);
    skyGrad.addColorStop(1, `hsl(${(hue + 30) % 360}, 25%, 10%)`);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height - C.groundH);

    // Grid lines (scrolling)
    const gridSize = 50;
    const scrollOffset = G.distance * 2 % gridSize;
    ctx.strokeStyle = `hsla(${hue}, 40%, 30%, 0.06)`;
    ctx.lineWidth = 1;
    for (let x = -scrollOffset; x < canvas.width + gridSize; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height - C.groundH); ctx.stroke();
    }
    for (let y = 0; y < canvas.height - C.groundH; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
}

function drawGround(hue, spd) {
    const gY = canvas.height - C.groundH;

    // Ground glow line
    ctx.save();
    ctx.shadowColor = `hsl(${hue}, 100%, 55%)`;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = `hsl(${hue}, 80%, 55%)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, gY);
    ctx.lineTo(canvas.width, gY);
    ctx.stroke();
    ctx.restore();

    // Ground body
    const gGrad = ctx.createLinearGradient(0, gY, 0, canvas.height);
    gGrad.addColorStop(0, `hsl(${hue}, 50%, 18%)`);
    gGrad.addColorStop(1, `hsl(${hue}, 40%, 8%)`);
    ctx.fillStyle = gGrad;
    ctx.fillRect(0, gY, canvas.width, C.groundH);

    // Scrolling chevron pattern on ground
    const chevSize = 24;
    const scrollX = G.distance * C.baseSpeed * G.speed % (chevSize * 2);
    ctx.strokeStyle = `hsla(${hue}, 60%, 40%, 0.15)`;
    ctx.lineWidth = 1;
    for (let x = -scrollX - chevSize * 2; x < canvas.width + chevSize * 2; x += chevSize * 2) {
        for (let row = 0; row < 2; row++) {
            const cy = gY + 14 + row * 16;
            ctx.beginPath();
            ctx.moveTo(x, cy);
            ctx.lineTo(x + chevSize, cy - 6);
            ctx.lineTo(x + chevSize * 2, cy);
            ctx.stroke();
        }
    }
}

// Flash overlay
let flashAlpha = 0;
function flash(a) { flashAlpha = a; }

function drawFlash() {
    if (flashAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = flashAlpha;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        flashAlpha = Math.max(0, flashAlpha - 0.04);
    }
}

// Score popup
function showScorePopup(x, y, text) {
    const el = document.createElement('div');
    el.className = 'score-popup';
    el.textContent = text;
    const rect = canvas.getBoundingClientRect();
    el.style.left = (rect.left + x) + 'px';
    el.style.top = (rect.top + y) + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 800);
}

// ── Init ────────────────────────────────────────────────
function init() {
    player = new Player();
    cam = new Camera();
    obstacles = [];
    orbs = [];
    particles = [];
    G = {
        playing: false,
        paused: false,
        score: 0,
        distance: 0,
        speed: 1,
        combo: 0,
        hue: 220,       // background hue — shifts through the run
        startTime: 0,
        dead: false,
        deathTimer: 0,
    };
    lastSpawn = 0;
    lastOrbSpawn = 0;
    updateUI();

    // Init bg elements
    if (bgShapes.length === 0) {
        for (let i = 0; i < 25; i++) bgShapes.push(new BgShape());
        for (let i = 0; i < 60; i++) stars.push(new Star());
        hills = [new HillLayer(0), new HillLayer(1), new HillLayer(2)];
    }
}

function updateUI() {
    document.getElementById('score').textContent = G.score;
    document.getElementById('bestScore').textContent = bestScore;
    const pct = Math.min(100, Math.floor((G.distance / C.levelLength) * 100));
    document.getElementById('progressFill').style.width = pct + '%';
}

// ── Game loop ───────────────────────────────────────────
function loop(ts) {
    if (!G.playing) return;
    if (G.paused) { animId = requestAnimationFrame(loop); return; }

    const spd = C.baseSpeed * G.speed;

    // Track distance
    G.distance += G.speed * 0.08;

    // Background hue shifts slowly through the run
    G.hue = (220 + G.distance * 3) % 360;

    // Camera
    cam.update();
    ctx.save();
    ctx.translate(cam.x, cam.y);

    // Clear
    ctx.clearRect(-20, -20, canvas.width + 40, canvas.height + 40);

    // Background
    drawBackground(G.hue);

    // Stars
    stars.forEach(s => { s.update(spd); s.draw(G.hue); });

    // Bg shapes
    bgShapes.forEach(s => { s.update(spd); s.draw(G.hue); });

    // Rolling hills
    hills.forEach(h => { h.update(spd); h.draw(G.hue); });

    // Player
    if (!G.dead) {
        player.update();

        // ── Spawn obstacles ──
        const spawnInterval = Math.max(600, 1600 - G.score * 8);
        if (ts - lastSpawn > spawnInterval) {
            spawnPattern(canvas.width + 20);
            lastSpawn = ts;
        }

        // ── Spawn orbs ──
        if (ts - lastOrbSpawn > 2200) {
            spawnOrb(canvas.width + 60);
            lastOrbSpawn = ts;
        }

        // ── Update obstacles ──
        obstacles = obstacles.filter(ob => {
            ob.update(spd);

            // Collision
            if (!ob.passed) {
                const hb = ob.hitbox();
                const px = player.x + 5, py = player.y + 5;
                const pw = player.size - 10, ph = player.size - 10;
                if (px < hb.x + hb.w && px + pw > hb.x && py < hb.y + hb.h && py + ph > hb.y) {
                    die();
                    return true;
                }
            }

            // Passed
            if (!ob.passed && ob.x + ob.w < player.x) {
                ob.passed = true;
                G.score++;
                G.combo++;
                const comboBonus = Math.floor(G.combo / 5);
                if (comboBonus > 0) {
                    G.score += comboBonus;
                    showScorePopup(player.x, player.y - 20, `+${1 + comboBonus}`);
                }
                updateUI();
            }

            return !ob.offscreen();
        });

        // ── Update orbs ──
        orbs = orbs.filter(o => {
            o.update(spd);
            if (o.hits(player)) {
                o.collected = true;
                G.score += 3;
                sfx('orb');
                flash(0.15);
                for (let i = 0; i < 10; i++) particles.push(new Particle(o.x, o.y, 'orb'));
                showScorePopup(o.x, o.y - 15, '+3');
                updateUI();
                return false;
            }
            return !o.offscreen();
        });
    } else {
        // Death animation — just tick timer
        G.deathTimer++;
        if (G.deathTimer > 90) {
            showGameOver();
        }
    }

    // Draw obstacles
    obstacles.forEach(ob => ob.draw());

    // Draw orbs
    orbs.forEach(o => o.draw());

    // Draw player
    player.draw();

    // Particles
    particles = particles.filter(p => {
        p.update();
        p.draw(G.hue);
        return !p.dead();
    });
    // Cap particles
    if (particles.length > C.maxParticles) {
        particles = particles.slice(particles.length - C.maxParticles);
    }

    // Ground (on top of everything)
    drawGround(G.hue, spd);

    // Speed ramp
    G.speed = 1 + G.distance * 0.003;

    // Flash overlay
    ctx.restore();
    drawFlash();

    animId = requestAnimationFrame(loop);
}

// ── Death ───────────────────────────────────────────────
function die() {
    if (G.dead) return;
    G.dead = true;
    player.alive = false;
    G.combo = 0;

    // Shatter particles
    for (let i = 0; i < 35; i++) {
        particles.push(new Particle(
            player.x + player.size / 2,
            player.y + player.size / 2,
            'shatter'
        ));
    }

    cam.shake(0.8);
    flash(0.5);
    sfx('death');
    stopMusic();

    // Update best
    if (G.score > bestScore) {
        bestScore = G.score;
        localStorage.setItem('gd_best', bestScore.toString());
    }
    attempt++;
    localStorage.setItem('gd_attempts', attempt.toString());
}

function showGameOver() {
    G.playing = false;
    cancelAnimationFrame(animId);
    document.getElementById('finalScore').textContent = G.score;
    document.getElementById('finalDist').textContent = Math.min(100, Math.floor((G.distance / C.levelLength) * 100));
    document.getElementById('attemptNum').textContent = attempt;
    document.getElementById('gameOver').style.display = 'block';
    document.getElementById('restartBtn').style.display = 'inline-block';
    document.getElementById('startBtn').style.display = 'none';
    updateUI();

    try {
        window.parent.postMessage({ type: 'geometry-rush-gameover', score: G.score }, '*');
    } catch (e) { /* not embedded, ignore */ }
}

// ── Start / Restart ────────────────────────────────────
function startGame() {
    init();
    G.playing = true;
    G.startTime = performance.now();
    document.getElementById('gameOver').style.display = 'none';
    document.getElementById('pauseMenu').style.display = 'none';
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('restartBtn').style.display = 'inline-block';
    lastSpawn = performance.now();
    lastOrbSpawn = performance.now();

    if (soundOn) {
        initAudio();
        startMusic();
    }

    animId = requestAnimationFrame(loop);
}

function togglePause() {
    if (!G.playing || G.dead) return;
    G.paused = !G.paused;
    document.getElementById('pauseMenu').style.display = G.paused ? 'block' : 'none';
    if (!G.paused) animId = requestAnimationFrame(loop);
}

// ── Input ───────────────────────────────────────────────
document.addEventListener('keydown', e => {
    if ((e.code === 'Space' || e.code === 'ArrowUp') && G.playing && !G.paused) {
        e.preventDefault();
        player.jump();
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault();
        togglePause();
    }
});

canvas.addEventListener('click', e => {
    e.preventDefault();
    if (G.playing && !G.paused) player.jump();
});

canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    if (G.playing && !G.paused) player.jump();
}, { passive: false });

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('restartBtn').addEventListener('click', startGame);
document.getElementById('resumeBtn').addEventListener('click', togglePause);

// Sound toggle
const soundBtn = document.getElementById('soundBtn');
soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? 'SOUND ON' : 'SOUND OFF';
    soundBtn.classList.toggle('active', soundOn);
    if (soundOn) {
        initAudio();
        if (G.playing && !G.dead) startMusic();
    } else {
        stopMusic();
    }
});

// ── Boot ────────────────────────────────────────────────
init();
updateUI();

// Draw idle scene
function drawIdle() {
    if (G.playing) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground(220);
    stars.forEach(s => { s.update(1); s.draw(220); });
    bgShapes.forEach(s => { s.update(1); s.draw(220); });
    hills.forEach(h => { h.update(1); h.draw(220); });
    player.hue = (player.hue + 1) % 360;
    player.draw();
    drawGround(220, 1);
    requestAnimationFrame(drawIdle);
}
drawIdle();
