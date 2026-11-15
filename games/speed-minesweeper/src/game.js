// Speed Minesweeper — timed 9x9 minesweeper for the Arcade Hub.
// Seeded by ?seed=<matchId> so both players in a 1v1 cash wager face the
// exact same mine layout; every match gets a brand-new board so layouts
// can't be memorized. Faster reveals = more points; one mine ends the run.

// ── Config ──────────────────────────────────────────────
const C = {
    cols: 9,
    rows: 9,
    mines: 12,
    baseRevealPts: 10,
    maxSpeedBonus: 15,
    speedBonusWindowMs: 1500,
    clearBonusBase: 300,
    clearTimeBonusMax: 600,
    clearTimeBonusPerSec: 5,
};

// ── Seeded RNG (fair 1v1 boards) ────────────────────────
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

// ── Canvas ──────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let CSS_W = 0, CSS_H = 0;
let cell = 0, gridX = 0, gridY = 0;

function resize() {
    const wrap = canvas.parentElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    CSS_W = wrap ? wrap.clientWidth : window.innerWidth;
    CSS_H = wrap ? wrap.clientHeight : window.innerHeight;
    if (CSS_W === 0 || CSS_H === 0) return;

    canvas.style.width = CSS_W + 'px';
    canvas.style.height = CSS_H + 'px';
    canvas.width = Math.floor(CSS_W * dpr);
    canvas.height = Math.floor(CSS_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    cell = Math.floor(Math.min(CSS_W, CSS_H) / C.cols);
    gridX = Math.floor((CSS_W - cell * C.cols) / 2);
    gridY = Math.floor((CSS_H - cell * C.rows) / 2);
}
resize();
window.addEventListener('resize', () => { resize(); draw(); });

// ── Board state ─────────────────────────────────────────
let G = {};
let bestScore = parseInt(localStorage.getItem('sm_best') || '0', 10);
let attempt = parseInt(localStorage.getItem('sm_attempts') || '0', 10);

const NUM_COLORS = ['', '#60a5fa', '#4ade80', '#f87171', '#a78bfa', '#fbbf24', '#22d3ee', '#f472b6', '#e5e7eb'];

function newBoard() {
    const total = C.cols * C.rows;
    const board = {
        mine: new Array(total).fill(false),
        revealed: new Array(total).fill(false),
        flagged: new Array(total).fill(false),
        count: new Array(total).fill(0),
        flash: new Array(total).fill(0),
    };

    // Deterministic mine placement from the match seed.
    const positions = [];
    for (let i = 0; i < total; i++) positions.push(i);
    for (let i = positions.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    for (let i = 0; i < C.mines; i++) board.mine[positions[i]] = true;

    computeCounts(board);
    return board;
}

function computeCounts(board) {
    for (let y = 0; y < C.rows; y++) {
        for (let x = 0; x < C.cols; x++) {
            let n = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < C.cols && ny >= 0 && ny < C.rows && board.mine[ny * C.cols + nx]) n++;
                }
            }
            board.count[y * C.cols + x] = n;
        }
    }
}

// Auto-open a safe starting zone so the player always begins with numbers
// already revealed instead of guessing. The zone's location is seeded, so
// both players in a match get the identical opening — and it's never
// scored, keeping runs fair.
function openStartingZone(board) {
    const total = C.cols * C.rows;
    let idx = Math.floor(rng() * total);
    // Scan forward for the first non-mine cell.
    for (let i = 0; i < total; i++) {
        const c = (idx + i) % total;
        if (!board.mine[c]) { idx = c; break; }
    }
    const x = idx % C.cols;
    const y = Math.floor(idx / C.cols);
    const stack = [[x, y]];
    const seen = new Set();
    while (stack.length) {
        const [cx, cy] = stack.pop();
        const key = cy * C.cols + cx;
        if (cx < 0 || cx >= C.cols || cy < 0 || cy >= C.rows || seen.has(key)) continue;
        seen.add(key);
        if (board.revealed[key] || board.mine[key]) continue;
        board.revealed[key] = true;
        if (board.count[key] === 0) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    stack.push([cx + dx, cy + dy]);
                }
            }
        }
    }
}

function init() {
    const board = newBoard();
    openStartingZone(board);
    G = {
        board,
        playing: false,
        started: false,
        dead: false,
        won: false,
        score: 0,
        revealedCount: 0,
        startTime: 0,
        elapsed: 0,
        lastRevealAt: 0,
        combo: 0,
        flagMode: false,
        timerId: null,
    };
    updateUI();
}

// ── Scoring ─────────────────────────────────────────────
function awardReveal(cellsOpened) {
    const now = performance.now();
    if (!G.lastRevealAt) G.lastRevealAt = now;
    for (let i = 0; i < cellsOpened; i++) {
        const dt = now - G.lastRevealAt;
        const bonus = Math.round(C.maxSpeedBonus * Math.max(0, 1 - dt / C.speedBonusWindowMs));
        G.score += C.baseRevealPts + bonus;
        G.lastRevealAt = now;
    }
    updateUI();
}

// ── Reveal logic ────────────────────────────────────────
function revealAt(x, y) {
    if (!G.playing || G.dead || G.won) return;
    const idx = y * C.cols + x;
    const b = G.board;
    if (x < 0 || x >= C.cols || y < 0 || y >= C.rows) return;
    if (b.flagged[idx]) return;

    if (!G.startTime) {
        G.startTime = performance.now();
        startTimer();
    }

    if (b.revealed[idx]) {
        chordAt(x, y);
        return;
    }

    if (b.mine[idx]) {
        b.revealed[idx] = true;
        die();
        return;
    }

    const opened = floodReveal(x, y);
    if (opened > 0) {
        awardReveal(opened);
        checkWin();
    }
}

function floodReveal(x, y) {
    const b = G.board;
    let opened = 0;
    const stack = [[x, y]];
    const seen = new Set();

    while (stack.length) {
        const [cx, cy] = stack.pop();
        const key = cy * C.cols + cx;
        if (cx < 0 || cx >= C.cols || cy < 0 || cy >= C.rows || seen.has(key)) continue;
        seen.add(key);
        if (b.revealed[key] || b.flagged[key] || b.mine[key]) continue;

        b.revealed[key] = true;
        b.flash[key] = 1;
        opened++;

        if (b.count[key] === 0) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    stack.push([cx + dx, cy + dy]);
                }
            }
        }
    }
    return opened;
}

// Chord: tap a revealed number whose surrounding flags equal the number.
function chordAt(x, y) {
    const b = G.board;
    const idx = y * C.cols + x;
    const needed = b.count[idx];
    if (needed === 0) return;

    let flags = 0;
    const hidden = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= C.cols || ny < 0 || ny >= C.rows) continue;
            const ni = ny * C.cols + nx;
            if (b.flagged[ni]) flags++;
            else if (!b.revealed[ni]) hidden.push([nx, ny]);
        }
    }
    if (flags !== needed || hidden.length === 0) return;

    let opened = 0;
    for (const [hx, hy] of hidden) {
        const hi = hy * C.cols + hx;
        if (b.mine[hi]) {
            b.revealed[hi] = true;
            die();
            return;
        }
        opened += floodReveal(hx, hy);
    }
    if (opened > 0) {
        awardReveal(opened);
        checkWin();
    }
}

function toggleFlag(x, y) {
    if (!G.playing || G.dead || G.won) return;
    if (x < 0 || x >= C.cols || y < 0 || y >= C.rows) return;
    const idx = y * C.cols + x;
    if (G.board.revealed[idx]) return;
    G.board.flagged[idx] = !G.board.flagged[idx];
    sfx('flag');
    draw();
}

// ── Timer ───────────────────────────────────────────────
function startTimer() {
    if (G.timerId) return;
    G.timerId = setInterval(() => {
        if (G.dead || G.won) return;
        G.elapsed = (performance.now() - G.startTime) / 1000;
        const el = document.getElementById('timer');
        if (el) el.textContent = G.elapsed.toFixed(1);
    }, 100);
}

// ── End states ──────────────────────────────────────────
function checkWin() {
    const safe = C.cols * C.rows - C.mines;
    if (G.board.revealed.filter(v => v).length < safe) return;
    G.won = true;
    clearInterval(G.timerId);
    G.elapsed = (performance.now() - G.startTime) / 1000;

    const timeBonus = Math.max(0, Math.round(C.clearTimeBonusMax - G.elapsed * C.clearTimeBonusPerSec));
    G.score += C.clearBonusBase + timeBonus;
    finishRun(true);
}

function die() {
    G.dead = true;
    clearInterval(G.timerId);
    if (G.startTime) G.elapsed = (performance.now() - G.startTime) / 1000;
    for (let i = 0; i < G.board.mine.length; i++) {
        if (G.board.mine[i]) G.board.revealed[i] = true;
    }
    finishRun(false);
}

function finishRun(won) {
    G.playing = false;
    attempt++;
    localStorage.setItem('sm_attempts', attempt.toString());
    if (G.score > bestScore) {
        bestScore = G.score;
        localStorage.setItem('sm_best', bestScore.toString());
    }

    sfx(won ? 'win' : 'death');
    draw();

    document.getElementById('gameOverTitle').textContent = won ? 'CLEARED!' : 'BOOM!';
    document.getElementById('gameOverTitle').className = won ? 'overlay-title win' : 'overlay-title dead';
    document.getElementById('finalScore').textContent = G.score;
    document.getElementById('finalTime').textContent = G.elapsed.toFixed(1) + 's';
    document.getElementById('finalCells').textContent = G.board.revealed.filter((v, i) => v && !G.board.mine[i]).length + '/' + (C.cols * C.rows - C.mines);
    document.getElementById('attemptNum').textContent = attempt;
    document.getElementById('gameOver').style.display = 'block';
    document.getElementById('restartBtn').style.display = 'inline-block';
    document.getElementById('startBtn').style.display = 'none';
    updateUI();

    try {
        window.parent.postMessage({ type: 'speed-minesweeper-gameover', score: G.score }, '*');
    } catch (e) { /* not embedded, ignore */ }
}

// ── Input ───────────────────────────────────────────────
function cellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX ?? (e.touches && e.touches[0].clientX) ?? 0) - rect.left;
    const py = (e.clientY ?? (e.touches && e.touches[0].clientY) ?? 0) - rect.top;
    const x = Math.floor((px - gridX) / cell);
    const y = Math.floor((py - gridY) / cell);
    return { x, y };
}

let pressTimer = null;
let pressHandled = false;
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

canvas.addEventListener('click', (e) => {
    if (pressHandled) { pressHandled = false; return; }
    if (!G.playing) return;
    const { x, y } = cellFromEvent(e);
    if (G.flagMode) toggleFlag(x, y);
    else revealAt(x, y);
    draw();
});

canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!G.playing) return;
    const { x, y } = cellFromEvent(e);
    toggleFlag(x, y);
    draw();
});

canvas.addEventListener('touchstart', (e) => {
    if (!G.playing) return;
    pressHandled = false;
    const t = e.touches[0];
    const { x, y } = cellFromEvent({ clientX: t.clientX, clientY: t.clientY });
    pressTimer = setTimeout(() => {
        pressHandled = true;
        toggleFlag(x, y);
        draw();
    }, 480);
}, { passive: true });

canvas.addEventListener('touchmove', () => {
    clearTimeout(pressTimer);
});

canvas.addEventListener('touchend', (e) => {
    clearTimeout(pressTimer);
    e.preventDefault();
    if (pressHandled) { pressHandled = false; return; }
    if (!G.playing) return;
    const t = e.changedTouches[0];
    const { x, y } = cellFromEvent({ clientX: t.clientX, clientY: t.clientY });
    if (G.flagMode) toggleFlag(x, y);
    else revealAt(x, y);
    draw();
}, { passive: false });

// Buttons
document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('restartBtn').addEventListener('click', startGame);

const flagBtn = document.getElementById('flagBtn');
flagBtn.addEventListener('click', () => {
    G.flagMode = !G.flagMode;
    flagBtn.classList.toggle('active', G.flagMode);
    flagBtn.textContent = G.flagMode ? 'FLAG: ON' : 'FLAG: OFF';
});

let soundOn = localStorage.getItem('sm_sound') !== 'off';
const soundBtn = document.getElementById('soundBtn');
soundBtn.classList.toggle('active', soundOn);
soundBtn.textContent = soundOn ? 'SOUND ON' : 'SOUND OFF';
soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    localStorage.setItem('sm_sound', soundOn ? 'on' : 'off');
    soundBtn.classList.toggle('active', soundOn);
    soundBtn.textContent = soundOn ? 'SOUND ON' : 'SOUND OFF';
    if (soundOn) initAudio();
});

// ── Audio ───────────────────────────────────────────────
let audioCtx = null;
function initAudio() {
    if (!audioCtx) {
        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { return; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function sfx(kind) {
    if (!soundOn || !audioCtx) return;
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    if (kind === 'flag') {
        o.frequency.value = 520; g.gain.setValueAtTime(0.05, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        o.start(t); o.stop(t + 0.08);
    } else if (kind === 'win') {
        [523, 659, 784, 1046].forEach((f, i) => {
            const oo = audioCtx.createOscillator();
            const gg = audioCtx.createGain();
            oo.connect(gg); gg.connect(audioCtx.destination);
            oo.frequency.value = f;
            gg.gain.setValueAtTime(0.06, t + i * 0.09);
            gg.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.18);
            oo.start(t + i * 0.09); oo.stop(t + i * 0.09 + 0.18);
        });
    } else if (kind === 'death') {
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(180, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        o.start(t); o.stop(t + 0.45);
    }
}

// ── Render ──────────────────────────────────────────────
function draw() {
    ctx.clearRect(0, 0, CSS_W, CSS_H);

    const g = ctx.createLinearGradient(0, 0, 0, CSS_H);
    g.addColorStop(0, '#0a0f1a');
    g.addColorStop(1, '#0f1420');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CSS_W, CSS_H);

    const b = G.board;
    for (let y = 0; y < C.rows; y++) {
        for (let x = 0; x < C.cols; x++) {
            const idx = y * C.cols + x;
            const px = gridX + x * cell;
            const py = gridY + y * cell;
            const revealed = b.revealed[idx];
            const flagged = b.flagged[idx];
            const flash = b.flash[idx];
            if (flash > 0) b.flash[idx] = Math.max(0, flash - 0.06);

            if (revealed) {
                ctx.fillStyle = b.mine[idx] ? '#7f1d1d' : (flash > 0 ? '#24344d' : '#1a2333');
                ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);

                if (b.mine[idx]) {
                    drawMine(px + cell / 2, py + cell / 2, cell * 0.28);
                } else if (b.count[idx] > 0) {
                    ctx.fillStyle = NUM_COLORS[b.count[idx]] || '#fff';
                    ctx.font = `bold ${Math.round(cell * 0.45)}px 'Courier New', monospace`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(String(b.count[idx]), px + cell / 2, py + cell / 2 + 1);
                }
            } else {
                const grad = ctx.createLinearGradient(px, py, px, py + cell);
                grad.addColorStop(0, '#2c3b55');
                grad.addColorStop(1, '#1d2a40');
                ctx.fillStyle = grad;
                ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
                ctx.strokeStyle = 'rgba(74,222,128,0.12)';
                ctx.strokeRect(px + 1.5, py + 1.5, cell - 3, cell - 3);

                if (flagged) drawFlag(px + cell / 2, py + cell / 2, cell * 0.3);
            }
        }
    }
}

function drawMine(cx, cy, r) {
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000';
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * r * 1.35, cy + Math.sin(a) * r * 1.35);
        ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
}

function drawFlag(cx, cy, r) {
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.4, cy + r);
    ctx.lineTo(cx - r * 0.4, cy - r);
    ctx.stroke();
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.4, cy - r);
    ctx.lineTo(cx + r * 0.9, cy - r * 0.4);
    ctx.lineTo(cx - r * 0.4, cy + r * 0.2);
    ctx.closePath();
    ctx.fill();
}

function updateUI() {
    const scoreEl = document.getElementById('score');
    const bestEl = document.getElementById('bestScore');
    if (scoreEl) scoreEl.textContent = G.score;
    if (bestEl) bestEl.textContent = bestScore;
}

// ── Start ───────────────────────────────────────────────
function startGame() {
    clearInterval(G.timerId);
    init();
    document.getElementById('gameOver').style.display = 'none';
    document.getElementById('restartBtn').style.display = 'none';
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('timer').textContent = '0.0';
    G.playing = true;
    draw();
}

// ── Boot ────────────────────────────────────────────────
init();
draw();
