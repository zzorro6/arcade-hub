import { describe, expect, test } from 'vitest';
import { scoreHole, seedForHole, finishBonus, firstGreenBonus } from './round';

 describe('Arcade golf rounds', () => {
  test('both players receive the same versioned hole seeds', () => {
    expect(seedForHole('match-123', 0)).toBe(seedForHole('match-123', 0));
    expect(seedForHole('match-123', 0)).not.toBe(seedForHole('match-123', 1));
    expect(seedForHole('match-123', 0)).not.toBe(seedForHole('match-456', 0));
  });

  test.each([[7, 1100], [6, 2100], [5, 3100], [4, 4100], [3, 5100], [2, 6100], [1, 7100]])(
    'par 4 in %i strokes scores %i points', (strokes, points) => {
      expect(scoreHole(4, strokes, 0, 400, true)).toBe(points);
    },
  );

  test.each([[3, 1000], [4, 700], [5, 400], [6, 0]])('finish bonus at +%i is %i', (over, points) => {
    expect(finishBonus(4, 4 + over, true)).toBe(points);
    expect(finishBonus(4, 4 + over, false)).toBe(0);
  });

  test.each([[0, 400], [6, 400], [6.01, 300], [10, 300], [10.01, 200], [15, 200], [15.01, 100]])('green bonus at %i yards is %i', (yards, points) => {
    expect(firstGreenBonus(yards)).toBe(points);
  });

  test('unfinished holes score proximity only, without repeat-shot farming', () => {
    expect(scoreHole(4, 9, 240, 400, false)).toBe(40);
    expect(scoreHole(4, 9, 500, 400, false)).toBe(0);
    expect(scoreHole(4, 9, 0, 400, false)).toBe(100);
  });
});
