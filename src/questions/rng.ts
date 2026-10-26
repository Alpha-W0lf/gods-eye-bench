/** Deterministic randomness for question selection. */

import { createHash } from 'node:crypto';

/** A seeded generator of floats in [0, 1) (mulberry32 over a hashed seed). */
export function seededRandom(seed: unknown): () => number {
  let state = createHash('sha256')
    .update(String(seed))
    .digest()
    .readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A copy of `items` in a seeded random order (Fisher–Yates). */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}
