/** The Duel Ring: opt-in, level-matched 1v1 fights where nobody loses anything but rating. */
export const DUEL = {
  /** Challenger and challenged must be this close. */
  challengeRange: 12,
  /** Seconds a challenge waits for an answer. */
  inviteSeconds: 15,
  countdownSeconds: 3,
  fightSeconds: 90,
  /** The ring around the duel's centre; stepping out forfeits. */
  ringRadius: 6,
  /** Hits between duelists do this fraction of their normal damage, so fights last. */
  damageScale: 0.6,
  startRating: 1000,
  /** Elo K-factor. */
  k: 32,
} as const;

export type DuelResult = 'win' | 'loss' | 'draw';

/** New Elo ratings after a duel between `a` and `b`, from a's point of view. */
export function eloAfter(a: number, b: number, result: DuelResult): { a: number; b: number } {
  const expectedA = 1 / (1 + 10 ** ((b - a) / 400));
  const scoreA = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
  const delta = DUEL.k * (scoreA - expectedA);
  return { a: Math.round(a + delta), b: Math.round(b - delta) };
}
