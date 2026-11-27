export function seedForHole(roundSeed: string, index: number): number {
  let hash = 2166136261;
  for (const char of `${roundSeed}:golf-v1:${index}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function finishBonus(par: number, strokes: number, sunk: boolean): number {
  if (!sunk || strokes > par + 5) return 0;
  const over = strokes - par;
  return over <= 3 ? (4 - over) * 1000 : over === 4 ? 700 : 400;
}

export function firstGreenBonus(yards: number): number {
  return yards <= 6 ? 400 : yards <= 10 ? 300 : yards <= 15 ? 200 : 100;
}

export function scoreHole(par: number, strokes: number, remaining: number, length: number, sunk: boolean): number {
  const progress = sunk ? 100 : Math.round(100 * Math.max(0, Math.min(1, 1 - remaining / Math.max(1, length))));
  const bonus = finishBonus(par, strokes, sunk);
  return progress + bonus;
}
