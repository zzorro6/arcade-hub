// Pro Golf — 3-hole seeded match golf for the Arcade Hub.
// Each hole (Par 3 / Par 4 / Par 5) is generated from ?seed=<matchId>, so both
// players in a wager get the identical course, hazards and wind — while every
// match produces a brand-new layout that can't be memorized.

// ── Config ──────────────────────────────────────────────
const C = {
    holes: 3,
    fairwayHalfW: 15,      // yards either side of centerline
    greenR: 9,
    viewYards: 118,        // yards visible horizontally
    maxExtraStrokes: 5,    // hole auto-ends at par + 5
};

const CLUBS = {
    driver: { name: 'DRIVER',  dist: 250, roll: 0.16 },
    iron:   { name: '5-IRON',  dist: 150, roll: 0.10 },
    wedge:  { name: 'PW',      dist: 80,  roll: 0.04 },
    putter: { name: 'PUTTER',  dist: 25,  roll: 0.0  },
};

const BONUS = [
    { diff: -3,  pts: 7000, label: 'ALBATROSS!' },
    { diff: -2,  pts: 6000, label: 'EAGLE!' },
    { diff: -1,  pts: 5000, label: 'BIRDIE!' },
    { diff: 0,   pts: 4000, label: 'PAR' },
    { diff: 1,   pts: 3000, label: 'BOGEY' },
    { diff: 2,   pts: 2000, label: 'DOUBLE BOGEY' },
    { diff: 3,   pts: 1000, label: 'TRIPLE+ ' },
];

// ── Seeded RNG ──────────────────────────────────────────
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

// ── Course generation ───────────────────────────────────
function genHoles() {
    const pars = [
        { par: 3, lenMin: 155, lenMax: 205 },
        { par: 4, lenMin: 340, lenMax: 430 },
        { par: 5, lenMin: 480, lenMax: 560 },
    ];
    // Shuffle hole order deterministically.
    for (let i = pars.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pars[i], pars[j]] = [pars[j], pars[i]];
    }
    return pars.map(p => {
        const len = Math.round(p.lenMin + rng() * (p.lenMax - p.lenMin));
        const curveAmp = p.par === 3 ? rng() * 6 : 4 + rng() * 14;     // lateral bend
        const curveFreq = (0.6 + rng() * 0.9) * Math.PI / len;
        const curvePhase = rng() * Math.PI * 2;

        const bunkers = [];
        const nB = p.par === 3 ? 1 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 3);
        for (let i = 0; i < nB; i++) {
            bunkers.push({
                x: len * (0.35 + rng() * 0.55),
                y: (rng() - 0.5) * 26,
                rx: 5 + rng() * 7,
                ry: 4 + rng() * 5,
            });
        }
        // Greenside bunker most holes.
        if (rng() < 0.7) bunkers.push({ x: len - 6 - rng() * 10, y: (rng() - 0.5) * 22, rx: 4 + rng() * 4, ry: 3 + rng() * 3 });

        const waters = [];
        if (p.par >= 4 && rng() < 0.6) {
            waters.push({
                x: len * (0.45 + rng() * 0.3),
                y: (rng() - 0.5) * 30,
                rx: 10 + rng() * 12,
                ry: 7 + rng() * 8,
            });
        }

        const windDirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const windDir = windDirs[Math.floor(rng() * 8)];
        const windMph = Math.round(2 + rng() * 12);

        return {
            par: p.par, len, curveAmp, curveFreq, curvePhase,
            bunkers, waters, windDir, windMph,
        };
    });
}

const HOLES = genHoles();

// Centerline lateral offset at distance x along the hole.
function cy(hole, x) {
    return hole.curveAmp * Math.sin(hole.curvePhase + x * hole.curveFreq);
}
function pinPos(hole) {
    return { x: hole.len, y: cy(hole, hole.len) };
}

function inEllipse(x, y, e) {
    const dx = (x - e.x) / e.rx, dy = (y - e.y) / e.ry;
    return dx * dx + dy * dy <= 1;
}

function lieAt(hole, x, y) {
    const pin = pinPos(hole);
    const dPin = Math.hypot(x - pin.x, y - pin.y);
    for (const w of hole.waters) if (inEllipse(x, y, w)) return 'water';
    if (dPin <= C.greenR) return 'green';
    for (const b of hole.bunkers) if (inEllipse(x, y, b)) return 'sand';
    if (Math.abs(y - cy(hole, x)) <= C.fairwayHalfW) return 'fairway';
    return 'rough';
}

// ── Wind effect ─────────────────────────────────────────
// Hole runs +x direction. Crosswind = E/W component pushes laterally,
// N/S head/tail changes carry.
function windComponents(hole) {
    const map = { E: [1, 0], NE: [0.7, -0.7], N: [0, -1], NW: [-0.7, -0.7], W: [-1, 0], SW: [-0.7, 0.7], S: [0, 0.7], SE: [0.7, 0.7] };
    const [head, cross] = map[hole.windDir] || [0, 0];
    return { head: head * hole.windMph, cross: cross * hole.windMph };
}

// ── Canvas ──────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let CSS_W = 0, CSS_H = 0;

function resize() {
    const wrap = canvas.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    CSS_W = wrap ? wrap.clientWidth : window.innerWidth;
    CSS_H = wrap ? wrap.clientHeight : window.innerHeight;
    if (!CSS_W || !CSS_H) return;
    canvas.style.width = CSS_W + 'px';
    canvas.style.height = CSS_H + 'px';
    canvas.width = Math.floor(CSS_W * dpr);
    canvas.height = Math.floor(CSS_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener('resize', draw);

const yScale = () => Math.min(CSS_W / C.viewYards, CSS_H / 60);

// ── Game state ──────────────────────────────────────────
let G = {};

function newHoleState(idx) {
    const hole = HOLES[idx];
    return {
        hole,
        strokes: 0,
        ball: { x: 0, y: cy(hole, 0) },
        aimDeg: 0,                 // offset from line to pin
        spin: 0,
        club: hole.par === 3 ? 'iron' : 'driver',
        charging: false,
        power: 0,
        powerDir: 1,
        flying: null,              // {from,to,dur,t}
        holeDone: false,
        holeScore: 0,
        prevDist: hole.len,
    };
}

function init() {
    G = {
        holeIdx: 0,
        score: 0,
        holeResults: [],
        phase: 'aim',              // aim | charge | fly | holeDone | gameOver
        hs: null,
        camX: 0,
    };
    G.hs = newHoleState(0);
    updateUI();
    updateClubButtons();
    updateSpinUI();
    updateAimUI();
    updateWindUI();
}

// ── Distances ───────────────────────────────────────────
function distToPin(hs, b) {
    const pin = pinPos(hs.hole);
    return Math.hypot(b.x - pin.x, b.y - pin.y);
}

// ── Shooting ────────────────────────────────────────────
function doShot() {
    const hs = G.hs;
    const hole = hs.hole;
    const club = CLUBS[hs.club];
    const pin = pinPos(hole);

    hs.strokes++;
    const lie = lieAt(hole, hs.ball.x, hs.ball.y);
    const lieFactor = { tee: 1, fairway: 1, green: 1, rough: 0.85, sand: 0.6 }[lie] ?? 1;

    // Direction to pin, rotated by aim offset.
    const baseAng = Math.atan2(pin.y - hs.ball.y, pin.x - hs.ball.x);
    const ang = baseAng + hs.aimDeg * Math.PI / 180;

    let carry = club.dist * (hs.power / 100) * lieFactor;

    // Wind: head/tail alters carry, crosswind adds lateral drift.
    const w = windComponents(hole);
    carry *= 1 - (w.head * 0.006);

    // Putter: mostly roll, low carry; only sensible close to hole.
    const isPutter = hs.club === 'putter';

    // Roll: terrain-modified, spin-scaled.
    let roll = isPutter ? club.dist * (hs.power / 100) * 1.6 : carry * club.roll;
    roll *= 1 + 0.45 * hs.spin;
    if (lie === 'green') roll *= 1.35;
    const land = {
        x: hs.ball.x + Math.cos(ang) * carry,
        y: hs.ball.y + Math.sin(ang) * carry + (w.cross * carry * 0.006),
    };
    // Landing terrain modifies roll.
    const landLie = lieAt(hole, land.x, land.y);
    if (landLie === 'sand') roll *= 0.2;
    if (landLie === 'rough') roll *= 0.6;

    const rollAng = Math.atan2(land.y - hs.ball.y, land.x - hs.ball.x);
    const dest = {
        x: land.x + Math.cos(rollAng) * roll,
        y: land.y + Math.sin(rollAng) * roll,
    };

    const from = { x: hs.ball.x, y: hs.ball.y };
    G.phase = 'fly';
    hs.flying = { from, land, dest, t: 0, dur: 700 + carry * 3 };
    hs.prevDist = distToPin(hs, from);
}

function landBall() {
    const hs = G.hs;
    const hole = hs.hole;
    const dest = hs.flying.dest;
    hs.flying = null;

    const d = distToPin(hs, dest);
    const lie = lieAt(hole, dest.x, dest.y);

    if (lie === 'water') {
        // Penalty: +1 stroke, ball back to where it was struck.
        hs.strokes++;
        hs.prevDist = distToPin(hs, hs.ball);
        G.phase = 'aim';
        updateUI();
        if (hs.strokes >= hole.par + C.maxExtraStrokes) return endHole(true);
        return;
    }

    hs.ball = dest;

    // Proximity points: % of the hole covered by this shot.
    const gained = Math.max(0, hs.prevDist - d);
    const pts = Math.round((gained / hole.len) * 100);
    G.score += pts;
    hs.holeScore += pts;

    if (d <= 1.8) {
        return endHole(false);
    }
    if (hs.strokes >= hole.par + C.maxExtraStrokes) {
        return endHole(true);
    }

    // Auto-switch to putter when close.
    if (d <= 26) { hs.club = 'putter'; updateClubButtons(); }
    else if (hs.club === 'putter') { hs.club = 'wedge'; updateClubButtons(); }

    G.phase = 'aim';
    updateUI();
}

function endHole(maxedOut) {
    const hs = G.hs;
    const hole = hs.hole;
    G.phase = 'holeDone';
    hs.holeDone = true;

    let bonus, label;
    if (maxedOut) {
        bonus = 500;
        label = `MAX STROKES (par ${hole.par})`;
    } else {
        const diff = hs.strokes - hole.par;
        // Hole-in-one on par4/5 counts as albatross-level.
        let entry;
        if (hs.strokes === 1) {
            entry = hole.par >= 4 ? BONUS[0] : BONUS[1];
        } else {
            entry = BONUS.find(b => diff <= b.diff) || BONUS[BONUS.length - 1];
        }
        bonus = entry.pts;
        label = `${entry.label}  (${hs.strokes} on par ${hole.par})`;
    }
    G.score += bonus;
    hs.holeScore += bonus;
    G.holeResults.push({ label, score: hs.holeScore, strokes: hs.strokes, par: hole.par });
    updateUI();

    if (G.holeIdx >= C.holes - 1) {
        G.phase = 'gameOver';
        document.getElementById('finalScore').textContent = G.score;
        document.getElementById('finalBreakdown').innerHTML = G.holeResults
            .map((r, i) => `Hole ${i + 1} (par ${r.par}): ${r.strokes} — ${r.score}`)
            .join('<br>');
        document.getElementById('gameOver').style.display = 'block';
        try { window.parent.postMessage({ type: 'pro-golf-gameover', score: G.score }, '*'); } catch (e) {}
    } else {
        document.getElementById('holeTitle').textContent = `HOLE ${G.holeIdx + 1} DONE`;
        document.getElementById('holeResult').textContent = label;
        document.getElementById('holeScore').textContent = hs.holeScore;
        document.getElementById('totalScore').textContent = G.score;
        document.getElementById('holeOver').style.display = 'block';
    }
}

// ── Input: aim / spin / club / power ────────────────────
const aimLeft = document.getElementById('aimLeft');
const aimRight = document.getElementById('aimRight');
const aimLabel = document.getElementById('aimLabel');
const spinLabel = document.getElementById('spinLabel');

function setAim(deg) {
    G.hs.aimDeg = Math.max(-35, Math.min(35, deg));
    updateAimUI();
    draw();
}
aimLeft.addEventListener('click', () => setAim(G.hs.aimDeg - 1.5));
aimRight.addEventListener('click', () => setAim(G.hs.aimDeg + 1.5));

function updateAimUI() { aimLabel.textContent = `AIM ${Math.round(G.hs.aimDeg)}°`; }

document.getElementById('spinUp').addEventListener('click', () => {
    G.hs.spin = Math.min(3, G.hs.spin + 1); updateSpinUI();
});
document.getElementById('spinDown').addEventListener('click', () => {
    G.hs.spin = Math.max(-3, G.hs.spin - 1); updateSpinUI();
});
function updateSpinUI() {
    const s = G.hs.spin;
    spinLabel.textContent = `SPIN ${s > 0 ? '+' : ''}${s}`;
    spinLabel.style.color = s > 0 ? '#fbbf24' : s < 0 ? '#60a5fa' : '#fff';
}

document.querySelectorAll('.club-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (G.phase !== 'aim') return;
        G.hs.club = btn.dataset.club;
        updateClubButtons();
        draw();
    });
});
function updateClubButtons() {
    document.querySelectorAll('.club-btn').forEach(b => b.classList.toggle('active', b.dataset.club === G.hs.club));
}

// Drag horizontally on canvas to aim.
let dragging = false, dragX = 0;
canvas.addEventListener('pointerdown', (e) => { if (G.phase === 'aim') { dragging = true; dragX = e.clientX; } });
canvas.addEventListener('pointermove', (e) => {
    if (!dragging || G.phase !== 'aim') return;
    const dx = e.clientX - dragX;
    dragX = e.clientX;
    setAim(G.hs.aimDeg + dx * 0.25);
});
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointercancel', () => { dragging = false; });

// Hold-to-charge power.
const shootBtn = document.getElementById('shootBtn');
let chargeRaf = null;

function startCharge(e) {
    if (G.phase !== 'aim') return;
    e.preventDefault();
    G.phase = 'charge';
    G.hs.charging = true;
    G.hs.power = 0;
    G.hs.powerDir = 1;
    shootBtn.classList.add('charging');
    let last = performance.now();
    const tick = (now) => {
        if (G.phase !== 'charge') return;
        const dt = now - last; last = now;
        G.hs.power += G.hs.powerDir * dt * 0.075; // ~1.3s to max
        if (G.hs.power >= 100) { G.hs.power = 100; G.hs.powerDir = -1; }
        if (G.hs.power <= 0) { G.hs.power = 0; G.hs.powerDir = 1; }
        draw();
        chargeRaf = requestAnimationFrame(tick);
    };
    chargeRaf = requestAnimationFrame(tick);
}
function releaseShot(e) {
    if (G.phase !== 'charge') return;
    e.preventDefault();
    cancelAnimationFrame(chargeRaf);
    G.hs.charging = false;
    shootBtn.classList.remove('charging');
    doShot();
}
shootBtn.addEventListener('pointerdown', startCharge);
shootBtn.addEventListener('pointerup', releaseShot);
shootBtn.addEventListener('pointerleave', (e) => { if (G.phase === 'charge') releaseShot(e); });
shootBtn.addEventListener('contextmenu', e => e.preventDefault());

// ── Animation loop ──────────────────────────────────────
let lastFrame = performance.now();
function loop(now) {
    const dt = Math.min(50, now - lastFrame);
    lastFrame = now;

    if (G.phase === 'fly' && G.hs.flying) {
        const f = G.hs.flying;
        f.t += dt;
        const p = Math.min(1, f.t / f.dur);
        // Two segments: carry (70%) then roll (30%), eased.
        if (p < 0.7) {
            const q = p / 0.7;
            const e = 1 - Math.pow(1 - q, 2);
            G.hs.ball = {
                x: f.from.x + (f.land.x - f.from.x) * e,
                y: f.from.y + (f.land.y - f.from.y) * e,
            };
        } else {
            const q = (p - 0.7) / 0.3;
            const e = 1 - Math.pow(1 - q, 3);
            G.hs.ball = {
                x: f.land.x + (f.dest.x - f.land.x) * e,
                y: f.land.y + (f.dest.y - f.land.y) * e,
            };
        }
        if (p >= 1) landBall();
    }

    draw();
    requestAnimationFrame(loop);
}

// ── Rendering ───────────────────────────────────────────
function w2s(x, y) {
    const s = yScale();
    return { x: (x - G.camX) * s, y: CSS_H / 2 + y * s };
}

function draw() {
    if (!CSS_W) return;
    const s = yScale();
    const hs = G.hs;
    const hole = hs.hole;
    const pin = pinPos(hole);

    // Camera follows ball.
    G.camX = Math.max(-10, Math.min(hole.len - C.viewYards + 30, hs.ball.x - C.viewYards * 0.35));

    // Background rough.
    const bg = ctx.createLinearGradient(0, 0, 0, CSS_H);
    bg.addColorStop(0, '#14532d');
    bg.addColorStop(1, '#0d3a1f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CSS_W, CSS_H);

    // Fairway ribbon.
    ctx.beginPath();
    let first = true;
    for (let x = Math.max(0, G.camX - 10); x <= Math.min(hole.len, G.camX + C.viewYards + 10); x += 2) {
        const p = w2s(x, cy(hole, x) - C.fairwayHalfW);
        if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y);
    }
    for (let x = Math.min(hole.len, G.camX + C.viewYards + 10); x >= Math.max(0, G.camX - 10); x -= 2) {
        const p = w2s(x, cy(hole, x) + C.fairwayHalfW);
        ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = '#1e7d3a';
    ctx.fill();

    // Water.
    for (const w of hole.waters) {
        const p = w2s(w.x, w.y);
        ctx.fillStyle = '#1d6fb8';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, w.rx * s, w.ry * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.stroke();
    }

    // Bunkers.
    for (const b of hole.bunkers) {
        const p = w2s(b.x, b.y);
        ctx.fillStyle = '#d4c48a';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, b.rx * s, b.ry * s, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Green + pin.
    const gp = w2s(pin.x, pin.y);
    ctx.fillStyle = '#2fae52';
    ctx.beginPath();
    ctx.arc(gp.x, gp.y, C.greenR * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.stroke();

    // Flag + hole.
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath(); ctx.arc(gp.x, gp.y, Math.max(3, 1.1 * s), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(gp.x, gp.y); ctx.lineTo(gp.x, gp.y - 20); ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.moveTo(gp.x, gp.y - 20); ctx.lineTo(gp.x + 12, gp.y - 16); ctx.lineTo(gp.x, gp.y - 12); ctx.closePath(); ctx.fill();

    // Tee box.
    const tp = w2s(0, cy(hole, 0));
    ctx.fillStyle = '#166534';
    ctx.fillRect(tp.x - 8 * s, tp.y - 5 * s, 8 * s, 10 * s);

    // Aim line + predicted carry marker (aim phase).
    if (G.phase === 'aim' || G.phase === 'charge') {
        const club = CLUBS[hs.club];
        const lie = lieAt(hole, hs.ball.x, hs.ball.y);
        const lieFactor = { fairway: 1, green: 1, rough: 0.85, sand: 0.6 }[lie] ?? 1;
        const baseAng = Math.atan2(pin.y - hs.ball.y, pin.x - hs.ball.x);
        const ang = baseAng + hs.aimDeg * Math.PI / 180;
        const estCarry = club.dist * 0.75 * lieFactor;
        const bp = w2s(hs.ball.x, hs.ball.y);
        const tp2 = { x: bp.x + Math.cos(ang) * estCarry * s, y: bp.y + Math.sin(ang) * estCarry * s };
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.moveTo(bp.x, bp.y); ctx.lineTo(tp2.x, tp2.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(tp2.x, tp2.y, 6, 0, Math.PI * 2); ctx.stroke();
    }

    // Ball.
    const bp = w2s(hs.ball.x, hs.ball.y);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(bp.x, bp.y, Math.max(4, 1.2 * s), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.stroke();

    // Lie label.
    if (G.phase === 'aim' || G.phase === 'charge') {
        const lie = lieAt(hole, hs.ball.x, hs.ball.y);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = `bold ${Math.round(11 + s)}px 'Courier New', monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(lie.toUpperCase(), bp.x, bp.y - 14);
    }

    // Power bar while charging.
    if (G.phase === 'charge') {
        const bw = CSS_W * 0.5, bh = 14;
        const bx = (CSS_W - bw) / 2, by = CSS_H - 26;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
        const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
        grad.addColorStop(0, '#4ade80'); grad.addColorStop(0.7, '#fbbf24'); grad.addColorStop(1, '#ef4444');
        ctx.fillStyle = grad;
        ctx.fillRect(bx, by, bw * (G.hs.power / 100), bh);
        ctx.fillStyle = '#fff';
        ctx.font = `bold 11px 'Courier New', monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(G.hs.power)}%`, CSS_W / 2, by - 6);
    }

    // Distance flag when ball near pin.
    const d = distToPin(hs, hs.ball);
    if (d <= 30 && d > 1.8 && (G.phase === 'aim' || G.phase === 'charge')) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `bold 12px 'Courier New', monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(`${d.toFixed(1)}y`, gp.x, gp.y + C.greenR * s + 16);
    }
}

// ── UI ──────────────────────────────────────────────────
function updateUI() {
    const hs = G.hs;
    document.getElementById('score').textContent = G.score;
    document.getElementById('holeNum').textContent = `${G.holeIdx + 1}/${C.holes}`;
    document.getElementById('strokes').textContent = hs.strokes;
    document.getElementById('distLeft').textContent = `${Math.round(distToPin(hs, hs.ball))}y`;
}
function updateWindUI() {
    const h = G.hs.hole;
    document.getElementById('windInfo').textContent = `${h.windDir} ${h.windMph}mph`;
}

// ── Buttons ─────────────────────────────────────────────
document.getElementById('startBtn').addEventListener('click', () => {
    document.getElementById('startOverlay').style.display = 'none';
    G.phase = 'aim';
    draw();
});
document.getElementById('nextHoleBtn').addEventListener('click', () => {
    document.getElementById('holeOver').style.display = 'none';
    G.holeIdx++;
    G.hs = newHoleState(G.holeIdx);
    G.phase = 'aim';
    updateUI(); updateClubButtons(); updateSpinUI(); updateAimUI(); updateWindUI();
    draw();
});
document.getElementById('restartBtn').addEventListener('click', () => {
    document.getElementById('gameOver').style.display = 'none';
    init();
    G.phase = 'aim';
    draw();
});

// ── Boot ────────────────────────────────────────────────
init();
requestAnimationFrame(loop);
