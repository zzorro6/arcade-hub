// Pro Golf — 3-hole seeded match golf for the Arcade Hub.
// Behind-the-ball pseudo-3D view (Golf Battle style): drag to turn, pull
// back on the ball for power, spin -3..+3. Each hole (Par 3/4/5) is
// generated from ?seed=<matchId> so both players get the identical
// course, hazards, trees and wind — every match is a fresh layout.

// ── Config ──────────────────────────────────────────────
const C = {
    holes: 3,
    fairwayHalfW: 15,
    greenR: 9,
    maxExtraStrokes: 5,
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
    for (let i = pars.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [pars[i], pars[j]] = [pars[j], pars[i]];
    }
    return pars.map(p => {
        const len = Math.round(p.lenMin + rng() * (p.lenMax - p.lenMin));
        const curveAmp = p.par === 3 ? rng() * 6 : 4 + rng() * 14;
        const curveFreq = (0.6 + rng() * 0.9) * Math.PI / len;
        const curvePhase = rng() * Math.PI * 2;

        const bunkers = [];
        const nB = p.par === 3 ? 1 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 3);
        for (let i = 0; i < nB; i++) {
            bunkers.push({ x: len * (0.35 + rng() * 0.55), y: (rng() - 0.5) * 26, rx: 5 + rng() * 7, ry: 4 + rng() * 5 });
        }
        if (rng() < 0.7) bunkers.push({ x: len - 6 - rng() * 10, y: (rng() - 0.5) * 22, rx: 4 + rng() * 4, ry: 3 + rng() * 3 });

        const waters = [];
        if (p.par >= 4 && rng() < 0.6) {
            waters.push({ x: len * (0.45 + rng() * 0.3), y: (rng() - 0.5) * 30, rx: 10 + rng() * 12, ry: 7 + rng() * 8 });
        }

        // Decorative trees along the hole edges.
        const trees = [];
        const nT = 10 + Math.floor(rng() * 8);
        for (let i = 0; i < nT; i++) {
            const side = rng() < 0.5 ? -1 : 1;
            trees.push({
                x: rng() * len,
                y: side * (24 + rng() * 26),
                s: 0.7 + rng() * 0.8,
            });
        }
        const clouds = [];
        for (let i = 0; i < 4; i++) clouds.push({ x: rng(), y: 0.04 + rng() * 0.16, s: 0.5 + rng() });

        const windDirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const windDir = windDirs[Math.floor(rng() * 8)];
        const windMph = Math.round((2 + rng() * 12) * 10) / 10;

        return { par: p.par, len, curveAmp, curveFreq, curvePhase, bunkers, waters, trees, clouds, windDir, windMph };
    });
}
const HOLES = genHoles();

function cy(hole, x) { return hole.curveAmp * Math.sin(hole.curvePhase + x * hole.curveFreq); }
function pinPos(hole) { return { x: hole.len, y: cy(hole, hole.len) }; }
function inEllipse(x, y, e) { const dx = (x - e.x) / e.rx, dy = (y - e.y) / e.ry; return dx * dx + dy * dy <= 1; }

function lieAt(hole, x, y) {
    const pin = pinPos(hole);
    const dPin = Math.hypot(x - pin.x, y - pin.y);
    for (const w of hole.waters) if (inEllipse(x, y, w)) return 'water';
    if (dPin <= C.greenR) return 'green';
    for (const b of hole.bunkers) if (inEllipse(x, y, b)) return 'sand';
    if (Math.abs(y - cy(hole, x)) <= C.fairwayHalfW) return 'fairway';
    return 'rough';
}

function windComponents(hole) {
    const map = { E: [1, 0], NE: [0.7, -0.7], N: [0, -1], NW: [-0.7, -0.7], W: [-1, 0], SW: [-0.7, 0.7], S: [0, 0.7], SE: [0.7, 0.7] };
    const [head, cross] = map[hole.windDir] || [0, 0];
    return { head: head * hole.windMph, cross: cross * hole.windMph };
}
const WIND_ANG = { E: 0, SE: Math.PI / 4, S: Math.PI / 2, SW: 3 * Math.PI / 4, W: Math.PI, NW: -3 * Math.PI / 4, N: -Math.PI / 2, NE: -Math.PI / 4 };

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

// ── State ───────────────────────────────────────────────
let G = {};

function newHoleState(idx) {
    const hole = HOLES[idx];
    return {
        hole,
        strokes: 0,
        ball: { x: 0, y: cy(hole, 0) },
        aimDeg: 0,
        spin: 0,
        club: hole.par === 3 ? 'iron' : 'driver',
        pulling: false,
        pullY: 0,
        power: 0,
        flying: null,
        holeDone: false,
        holeScore: 0,
        prevDist: hole.len,
    };
}

function init() {
    G = { holeIdx: 0, score: 0, holeResults: [], phase: 'aim', hs: null };
    G.hs = newHoleState(0);
    updateClubButtons();
    updateSpinUI();
}

function distToPin(hs, b) {
    const pin = pinPos(hs.hole);
    return Math.hypot(b.x - pin.x, b.y - pin.y);
}

// ── Shooting ────────────────────────────────────────────
function viewAng(hs) {
    const pin = pinPos(hs.hole);
    return Math.atan2(pin.y - hs.ball.y, pin.x - hs.ball.x) + hs.aimDeg * Math.PI / 180;
}

function doShot() {
    const hs = G.hs;
    const hole = hs.hole;
    const club = CLUBS[hs.club];
    const pin = pinPos(hole);

    hs.strokes++;
    const lie = lieAt(hole, hs.ball.x, hs.ball.y);
    const lieFactor = { tee: 1, fairway: 1, green: 1, rough: 0.85, sand: 0.6 }[lie] ?? 1;

    const ang = viewAng(hs);
    const dNow = Math.hypot(pin.x - hs.ball.x, pin.y - hs.ball.y);
    // Putter auto-scales to the distance remaining so close putts stay
    // controllable — 100% ≈ just past the hole.
    const clubDist = hs.club === 'putter' ? Math.max(8, Math.min(45, dNow * 1.3)) : club.dist;
    let carry = clubDist * (hs.power / 100) * lieFactor;
    const w = windComponents(hole);
    carry *= 1 - (w.head * 0.006);

    const isPutter = hs.club === 'putter';
    let roll = isPutter ? clubDist * (hs.power / 100) * 1.6 : carry * club.roll;
    roll *= 1 + 0.45 * hs.spin;
    if (lie === 'green') roll *= 1.35;

    const land = {
        x: hs.ball.x + Math.cos(ang) * carry,
        y: hs.ball.y + Math.sin(ang) * carry + (w.cross * carry * 0.006),
    };
    const landLie = lieAt(hole, land.x, land.y);
    if (landLie === 'sand') roll *= 0.2;
    if (landLie === 'rough') roll *= 0.6;

    const rollAng = Math.atan2(land.y - hs.ball.y, land.x - hs.ball.x);
    const dest = { x: land.x + Math.cos(rollAng) * roll, y: land.y + Math.sin(rollAng) * roll };

    const from = { x: hs.ball.x, y: hs.ball.y };
    G.phase = 'fly';
    hs.flying = { from, land, dest, t: 0, dur: 750 + carry * 3 };
    hs.prevDist = distToPin(hs, from);
    hs.power = 0;
    hs.pullY = 0;
}

function landBall() {
    const hs = G.hs;
    const hole = hs.hole;
    const dest = hs.flying.dest;
    hs.flying = null;

    const d = distToPin(hs, dest);
    const lie = lieAt(hole, dest.x, dest.y);

    if (lie === 'water') {
        hs.strokes++;
        hs.prevDist = distToPin(hs, hs.ball);
        G.phase = 'aim';
        if (hs.strokes >= hole.par + C.maxExtraStrokes) return endHole(true);
        return;
    }

    hs.ball = dest;
    hs.aimDeg = 0;

    const gained = Math.max(0, hs.prevDist - d);
    const pts = Math.round((gained / hole.len) * 100);
    G.score += pts;
    hs.holeScore += pts;

    if (d <= 1.8) return endHole(false);
    if (hs.strokes >= hole.par + C.maxExtraStrokes) return endHole(true);

    if (d <= 26) { hs.club = 'putter'; updateClubButtons(); }
    else if (hs.club === 'putter') { hs.club = 'wedge'; updateClubButtons(); }

    G.phase = 'aim';
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
        let entry;
        if (hs.strokes === 1) entry = hole.par >= 4 ? BONUS[0] : BONUS[1];
        else entry = BONUS.find(b => diff <= b.diff) || BONUS[BONUS.length - 1];
        bonus = entry.pts;
        label = `${entry.label}  (${hs.strokes} on par ${hole.par})`;
    }
    G.score += bonus;
    hs.holeScore += bonus;
    G.holeResults.push({ label, score: hs.holeScore, strokes: hs.strokes, par: hole.par });

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

// ── Input: pull-back power + drag-to-turn ───────────────
let aimDrag = null;

canvas.addEventListener('pointerdown', (e) => {
    if (G.phase !== 'aim') return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const py = e.clientY - r.top;
    // Pull-back zone: bottom-center area around the ball.
    if (py > CSS_H * 0.62) {
        G.phase = 'charge';
        G.hs.pulling = true;
        G.hs.pullStart = py;
        G.hs.pullY = 0;
        G.hs.power = 0;
    } else {
        aimDrag = { x: e.clientX };
    }
});
canvas.addEventListener('pointermove', (e) => {
    if (G.phase === 'charge' && G.hs.pulling) {
        const r = canvas.getBoundingClientRect();
        const dy = (e.clientY - r.top) - G.hs.pullStart;
        G.hs.pullY = Math.max(0, Math.min(CSS_H * 0.34, dy));
        G.hs.power = Math.min(100, (G.hs.pullY / (CSS_H * 0.3)) * 100);
        draw();
    } else if (aimDrag && G.phase === 'aim') {
        const dx = e.clientX - aimDrag.x;
        aimDrag.x = e.clientX;
        G.hs.aimDeg = Math.max(-35, Math.min(35, G.hs.aimDeg + dx * 0.12));
        draw();
    }
});
function endPointer(e) {
    if (G.phase === 'charge' && G.hs.pulling) {
        e.preventDefault();
        G.hs.pulling = false;
        if (G.hs.power > 5) doShot();
        else { G.phase = 'aim'; G.hs.power = 0; }
        draw();
    }
    aimDrag = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', e => e.preventDefault());

// Clubs + spin
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
const spinLabel = document.getElementById('spinLabel');
document.getElementById('spinUp').addEventListener('click', () => { G.hs.spin = Math.min(3, G.hs.spin + 1); updateSpinUI(); });
document.getElementById('spinDown').addEventListener('click', () => { G.hs.spin = Math.max(-3, G.hs.spin - 1); updateSpinUI(); });
function updateSpinUI() {
    const s = G.hs.spin;
    spinLabel.textContent = `SPIN ${s > 0 ? '+' : ''}${s}`;
    spinLabel.style.color = s > 0 ? '#fbbf24' : s < 0 ? '#60a5fa' : '#fff';
}

// ── Pseudo-3D projection ────────────────────────────────
const HORIZON = 0.34;      // fraction of height
const CAM_H = 2.4;         // camera height in yards

function project(px, py) {
    const hs = G.hs;
    const ang = viewAng(hs);
    const fx = Math.cos(ang), fy = Math.sin(ang);
    const dx = px - hs.ball.x, dy = py - hs.ball.y;
    const fwd = dx * fx + dy * fy;
    const lat = dx * (-fy) + dy * fx;
    if (fwd < 0.9) return null;
    const gy = CSS_H * HORIZON + (CAM_H * CSS_H * 0.9) / fwd;
    const gx = CSS_W * 0.5 + (lat * CSS_W * 0.8) / fwd;
    return { x: gx, y: gy, s: 1 / fwd, fwd };
}

function drawBlob(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

function drawTree(p, s) {
    // p = projected base point; height like a ~5y tree at this depth.
    const h = Math.min(160, Math.max(10, s * 5 * CSS_H * 0.9 * p.s));
    const w = h * 0.55;
    ctx.fillStyle = '#3d2b12';
    ctx.fillRect(p.x - w * 0.08, p.y - h * 0.35, w * 0.16, h * 0.35);
    const g = ctx.createLinearGradient(p.x, p.y - h, p.x, p.y);
    g.addColorStop(0, '#1f7a34');
    g.addColorStop(1, '#0f4d1e');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - h);
    ctx.lineTo(p.x - w / 2, p.y - h * 0.28);
    ctx.lineTo(p.x + w / 2, p.y - h * 0.28);
    ctx.closePath();
    ctx.fill();
}

function drawGolfer() {
    // Stylized golfer at bottom-left, like the reference.
    const bx = CSS_W * 0.16, by = CSS_H * 0.94;
    const u = Math.min(CSS_W, CSS_H) / 90; // unit scale
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(u, u);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(4, 0, 12, 3.2, 0, 0, Math.PI * 2); ctx.fill();

    // legs
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(-1, -14); ctx.lineTo(-3.5, -2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, -14); ctx.lineTo(3.5, -2); ctx.stroke();
    // shoes
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath(); ctx.ellipse(-4, -1.5, 3, 1.8, -0.15, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(4, -1.5, 3, 1.8, 0.15, 0, Math.PI * 2); ctx.fill();
    // shorts
    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(-4.5, -20, 9, 7);
    // torso (white/red shirt)
    ctx.fillStyle = '#e5e7eb';
    ctx.beginPath();
    ctx.moveTo(-5, -21); ctx.lineTo(5, -21); ctx.lineTo(4, -33); ctx.lineTo(-3.5, -33); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(-5, -21, 10, 3);
    // arms holding club
    ctx.strokeStyle = '#d1a37e';
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(2.5, -31); ctx.lineTo(9, -22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2.5, -30.5); ctx.lineTo(8.2, -22.6); ctx.stroke();
    // head + cap
    ctx.fillStyle = '#d1a37e';
    ctx.beginPath(); ctx.arc(0.5, -36.5, 4.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2563eb';
    ctx.beginPath(); ctx.arc(0.5, -37.8, 4.4, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillRect(0.5, -38.4, 8.5, 2); // brim
    // club (angled toward ball bottom-right)
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(9, -22); ctx.lineTo(20, -1); ctx.stroke();
    ctx.fillStyle = '#111827';
    ctx.beginPath(); ctx.ellipse(21.5, -1, 3.4, 2, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}

function drawMinimap(hole, d) {
    const mw = Math.min(CSS_W * 0.34, 170);
    const mh = mw * 1.15;
    const mx = CSS_W - mw - 10, my = 10;

    ctx.fillStyle = 'rgba(10, 20, 40, 0.82)';
    ctx.beginPath();
    ctx.roundRect(mx, my, mw, mh, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.stroke();

    // distance label in its own top band so the course can't overlap it
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(mx + 4, my + 4, mw - 8, mw * 0.26);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(mw * 0.13)}px 'Courier New', monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(d)}`, mx + mw / 2, my + mw * 0.18);
    ctx.font = `${Math.round(mw * 0.07)}px 'Courier New', monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('YARDS TO PIN', mx + mw / 2, my + mw * 0.27);

    // course: x→vertical (pin top, tee bottom), y→horizontal
    const pad = mw * 0.14;
    const mapH = mh - pad * 2 - mw * 0.3;
    const top = my + pad + mw * 0.3;
    const sc = mapH / hole.len;
    const mapX = (wx, wy) => ({ x: mx + mw / 2 + wy * sc * 1.9, y: top + (hole.len - wx) * sc });

    // fairway
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = C.fairwayHalfW * 2 * sc * 1.9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = 0; x <= hole.len; x += 4) {
        const p = mapX(x, cy(hole, x));
        x === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    // water + bunkers
    for (const w of hole.waters) {
        const p = mapX(w.x, w.y);
        drawBlob(p.x, p.y, Math.max(2.5, w.rx * sc), '#38bdf8');
    }
    for (const b of hole.bunkers) {
        const p = mapX(b.x, b.y);
        drawBlob(p.x, p.y, Math.max(1.8, b.rx * sc), '#e7d39a');
    }
    // green + flag
    const pin = pinPos(hole);
    const pp = mapX(pin.x, pin.y);
    drawBlob(pp.x, pp.y, Math.max(3, C.greenR * sc), '#22c55e');
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(pp.x, pp.y - 6, 6, 4);
    // ball
    const bp = mapX(G.hs.ball.x, G.hs.ball.y);
    drawBlob(bp.x, bp.y, 2.6, '#fff');

    // wind badge under the map
    const wy = my + mh + 8;
    ctx.fillStyle = 'rgba(10, 20, 40, 0.82)';
    ctx.beginPath();
    ctx.roundRect(mx, wy, mw, 30, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.stroke();
    // arrow rotated to wind dir relative to view (wind blowing direction)
    const wa = WIND_ANG[hole.windDir] ?? 0;
    const cxw = mx + 22, cyw = wy + 15;
    ctx.save();
    ctx.translate(cxw, cyw);
    ctx.rotate(wa + Math.PI / 2); // arrow points where wind blows (relative rough)
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.font = `bold 12px 'Courier New', monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(`${hole.windMph.toFixed(1)} MPH`, mx + 42, cyw + 4);
}

// ── Main render ─────────────────────────────────────────
function draw() {
    if (!CSS_W || !G.hs) return;
    const hs = G.hs;
    const hole = hs.hole;
    const pin = pinPos(hole);
    const horizonY = CSS_H * HORIZON;

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, horizonY + 40);
    sky.addColorStop(0, '#7db9e8');
    sky.addColorStop(0.7, '#a8d4f0');
    sky.addColorStop(1, '#d8ecf8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CSS_W, horizonY + 60);

    // Sun glow
    const sg = ctx.createRadialGradient(CSS_W * 0.2, CSS_H * 0.05, 4, CSS_W * 0.2, CSS_H * 0.05, 90);
    sg.addColorStop(0, 'rgba(255,255,255,0.9)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, CSS_W, horizonY);

    // Clouds
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const c of hole.clouds) {
        const cxx = c.x * CSS_W, cyy = c.y * CSS_H, cr = 26 * c.s;
        ctx.beginPath();
        ctx.ellipse(cxx, cyy, cr * 1.9, cr * 0.62, 0, 0, Math.PI * 2);
        ctx.ellipse(cxx + cr, cyy - cr * 0.2, cr * 1.2, cr * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Distant ground (rough) below horizon
    const gr = ctx.createLinearGradient(0, horizonY, 0, CSS_H);
    gr.addColorStop(0, '#3d9950');
    gr.addColorStop(0.35, '#2b7a3d');
    gr.addColorStop(1, '#175226');
    ctx.fillStyle = gr;
    ctx.fillRect(0, horizonY, CSS_W, CSS_H - horizonY);

    // Horizon tree band
    ctx.fillStyle = '#14532d';
    ctx.fillRect(0, horizonY - 3, CSS_W, 8);

    // ── Fairway (projected ribbon, striped, always full hole so you can
    // turn back toward the pin after overshooting) ──
    const step = 4;
    const pts = [];
    for (let x = 0; x <= hole.len + 6; x += step) {
        const cyy = cy(hole, x);
        pts.push({
            x,
            l: project(x, cyy - C.fairwayHalfW),
            r: project(x, cyy + C.fairwayHalfW),
        });
    }
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (!a.l || !a.r || !b.l || !b.r) continue;
        ctx.beginPath();
        ctx.moveTo(a.l.x, a.l.y);
        ctx.lineTo(a.r.x, a.r.y);
        ctx.lineTo(b.r.x, b.r.y);
        ctx.lineTo(b.l.x, b.l.y);
        ctx.closePath();
        ctx.fillStyle = (Math.floor(a.x / 22) % 2 === 0) ? '#3cb154' : '#35a04b';
        ctx.fill();
    }

    // ── Water + bunkers + green (projected) ──
    for (const w of hole.waters) {
        const p = project(w.x, w.y);
        if (!p) continue;
        const k = CSS_W * 0.8 * p.s;
        ctx.fillStyle = '#2090d8';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, w.rx * k, w.ry * k * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.stroke();
    }
    for (const b of hole.bunkers) {
        const p = project(b.x, b.y);
        if (!p) continue;
        const k = CSS_W * 0.8 * p.s;
        ctx.fillStyle = '#e7d39a';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, b.rx * k, b.ry * k * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    const gp = project(pin.x, pin.y);
    if (gp) {
        const gr2 = C.greenR * CSS_W * 0.8 * gp.s;
        ctx.fillStyle = '#37c457';
        ctx.beginPath();
        ctx.ellipse(gp.x, gp.y, gr2, gr2 * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Flag pole + flag
        const poleH = Math.min(120, 22 * gp.s * CSS_H * 0.9);
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = Math.max(1.5, poleH * 0.03);
        ctx.beginPath();
        ctx.moveTo(gp.x, gp.y);
        ctx.lineTo(gp.x, gp.y - poleH);
        ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(gp.x, gp.y - poleH);
        ctx.lineTo(gp.x + poleH * 0.55, gp.y - poleH * 0.85);
        ctx.lineTo(gp.x, gp.y - poleH * 0.7);
        ctx.closePath();
        ctx.fill();
    }

    // ── Trees (far → near) ──
    const treeDraws = hole.trees
        .map(t => ({ t, p: project(t.x, t.y) }))
        .filter(o => o.p)
        .sort((a, b) => b.p.fwd - a.p.fwd);
    for (const { t, p } of treeDraws) drawTree(p, t.s);

    // ── Aim guide ghost (predicted carry) ──
    if (G.phase === 'aim' || G.phase === 'charge') {
        const club = CLUBS[hs.club];
        const lie = lieAt(hole, hs.ball.x, hs.ball.y);
        const lieFactor = { fairway: 1, green: 1, rough: 0.85, sand: 0.6 }[lie] ?? 1;
        const ang = viewAng(hs);
        const dNow = distToPin(hs, hs.ball);
        const clubDist = hs.club === 'putter' ? Math.max(8, Math.min(45, dNow * 1.3)) : club.dist;
        const ghostDist = clubDist * lieFactor * (hs.club === 'putter' ? 1 : 0.85);
        const gx2 = hs.ball.x + Math.cos(ang) * ghostDist;
        const gy2 = hs.ball.y + Math.sin(ang) * ghostDist;
        const gp2 = project(gx2, gy2);
        if (gp2) {
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(gp2.x, gp2.y, 10, 5, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            // club+dist label at the ghost
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.font = `bold 11px 'Courier New', monospace`;
            ctx.textAlign = 'center';
            ctx.fillText(`${club.name} ~${Math.round(ghostDist)}y`, gp2.x, gp2.y - 10);
        }
    }

    // Floating yardage at the pin when close
    const dPinNow = distToPin(hs, hs.ball);
    if (gp && dPinNow <= 60 && (G.phase === 'aim' || G.phase === 'charge')) {
        ctx.fillStyle = '#fff';
        ctx.font = `bold 13px 'Courier New', monospace`;
        ctx.textAlign = 'center';
        const poleH2 = Math.min(120, 22 * gp.s * CSS_H * 0.9);
        ctx.fillText(`${dPinNow.toFixed(1)}y`, gp.x, gp.y - poleH2 - 8);
    }

    // ── Ball + shadow (fixed bottom position) ──
    const ballX = CSS_W * 0.5, ballY = CSS_H * 0.78 + hs.pullY * 0.45;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(ballX, ballY + 8, 13, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    const bg2 = ctx.createRadialGradient(ballX - 3, ballY - 4, 1, ballX, ballY, 11);
    bg2.addColorStop(0, '#ffffff');
    bg2.addColorStop(1, '#c8d2dc');
    ctx.fillStyle = bg2;
    ctx.beginPath(); ctx.arc(ballX, ballY, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(150,170,190,0.5)';
    ctx.beginPath(); ctx.arc(ballX + 3, ballY + 2, 2, 0, Math.PI * 2); ctx.fill();

    drawGolfer();

    // ── HUD chips ──
    // Par/stroke chip top-left
    ctx.fillStyle = 'rgba(10, 20, 40, 0.8)';
    ctx.beginPath(); ctx.roundRect(10, 10, 110, 44, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold 13px 'Courier New', monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(`PAR ${hole.par}`, 20, 28);
    ctx.fillText(`STROKE ${hs.strokes + (G.phase === 'fly' ? 0 : 1)}`, 20, 46);

    // Score chip under it
    ctx.fillStyle = 'rgba(10, 20, 40, 0.8)';
    ctx.beginPath(); ctx.roundRect(10, 60, 110, 30, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.stroke();
    ctx.fillStyle = '#4ade80';
    ctx.fillText(`SCORE ${G.score}`, 20, 80);

    // Lie + big remaining-distance chips
    const lieNow = lieAt(hole, hs.ball.x, hs.ball.y);
    ctx.fillStyle = 'rgba(10, 20, 40, 0.8)';
    ctx.beginPath(); ctx.roundRect(10, 96, 110, 30, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.stroke();
    ctx.fillStyle = lieNow === 'sand' ? '#fbbf24' : lieNow === 'rough' ? '#a3e635' : '#e5e7eb';
    ctx.fillText(lieNow.toUpperCase(), 20, 116);

    ctx.fillStyle = 'rgba(10, 20, 40, 0.8)';
    ctx.beginPath(); ctx.roundRect(10, 132, 110, 40, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold 17px 'Courier New', monospace`;
    ctx.fillText(`${dPinNow.toFixed(dPinNow < 30 ? 1 : 0)}y`, 20, 157);
    ctx.font = `9px 'Courier New', monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('TO PIN', 20, 168);

    drawMinimap(hole, distToPin(hs, hs.ball));

    // ── Power meter (right edge, like reference) ──
    const mw2 = 14, mh2 = CSS_H * 0.4;
    const mx2 = CSS_W - mw2 - 18, my2 = CSS_H * 0.38;
    ctx.fillStyle = 'rgba(8, 16, 32, 0.8)';
    ctx.beginPath(); ctx.roundRect(mx2, my2, mw2, mh2, 8); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const fillH = mh2 * (hs.power / 100);
    if (fillH > 1) {
        const pg = ctx.createLinearGradient(0, my2 + mh2, 0, my2);
        pg.addColorStop(0, '#4ade80');
        pg.addColorStop(0.65, '#fbbf24');
        pg.addColorStop(1, '#ef4444');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.roundRect(mx2 + 2.5, my2 + mh2 - fillH + 2.5, mw2 - 5, Math.max(4, fillH - 5), 5);
        ctx.fill();
    }
    // tick marks at 25/50/75%
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    for (const f of [0.25, 0.5, 0.75]) {
        const sy = my2 + mh2 * (1 - f);
        ctx.beginPath(); ctx.moveTo(mx2 - 5, sy); ctx.lineTo(mx2, sy); ctx.stroke();
    }

    // ── Hint text ──
    if (G.phase === 'aim' && hs.strokes === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = `bold ${Math.round(CSS_W * 0.038)}px 'Courier New', monospace`;
        ctx.textAlign = 'center';
        ctx.fillText('DRAG TO TURN', CSS_W * 0.5, CSS_H * 0.52);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = `bold ${Math.round(CSS_W * 0.03)}px 'Courier New', monospace`;
        ctx.fillText('◀   ▶', CSS_W * 0.5, CSS_H * 0.52 - CSS_W * 0.05);
        ctx.fillText('PULL BACK TO BUILD POWER', CSS_W * 0.5, CSS_H * 0.86);
    }
    if (G.phase === 'charge') {
        ctx.fillStyle = '#fff';
        ctx.font = `bold 16px 'Courier New', monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(hs.power)}%`, CSS_W * 0.5, CSS_H * 0.72);
    }

    // Spin indicator on the meter
    if (hs.spin !== 0) {
        ctx.fillStyle = hs.spin > 0 ? '#fbbf24' : '#60a5fa';
        ctx.font = `bold 11px 'Courier New', monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(`SPIN ${hs.spin > 0 ? '+' : ''}${hs.spin}`, mx2 + mw2 / 2, my2 - 8);
    }
}

// ── Animation loop ──────────────────────────────────────
let lastFrame = performance.now();
function loop(now) {
    const dt = Math.min(50, now - lastFrame);
    lastFrame = now;

    if (G.phase === 'fly' && G.hs.flying) {
        const f = G.hs.flying;
        f.t += dt;
        const p = Math.min(1, f.t / f.dur);
        if (p < 0.72) {
            const q = p / 0.72;
            const e2 = 1 - Math.pow(1 - q, 2);
            // Camera follows the ball during flight.
            G.hs.ball = {
                x: f.from.x + (f.land.x - f.from.x) * e2,
                y: f.from.y + (f.land.y - f.from.y) * e2,
            };
        } else {
            const q = (p - 0.72) / 0.28;
            const e2 = 1 - Math.pow(1 - q, 3);
            G.hs.ball = {
                x: f.land.x + (f.dest.x - f.land.x) * e2,
                y: f.land.y + (f.dest.y - f.land.y) * e2,
            };
        }
        if (p >= 1) landBall();
    }
    draw();
    requestAnimationFrame(loop);
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
    updateClubButtons(); updateSpinUI();
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
