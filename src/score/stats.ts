/** Summary statistics with honest uncertainty (ADR 0005). */

/** Arithmetic mean, or null for no values. */
export function mean(values: number[]): number | null {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

/** Median, or null for no values. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * A 95% Wilson score interval for `p`, the mean of `n` per-question scores,
 * each in [0, 1], treating the questions as the sample (a question's trials are
 * averaged first, since they are correlated). A [0, 1] score with mean p has
 * variance at most p(1 - p), so the spread of fractional scores is not
 * understated; the interval is monotone in p and never collapses to a point:
 * 55 of 55 gives 93.5% to 100%.
 */
export function wilsonInterval(
  p: number,
  n: number,
  z = 1.959964,
): [number, number] | null {
  if (!n) return null;
  const scale = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / scale;
  const half =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / scale;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/**
 * Round to `digits` decimals, keeping null. Four, so that a share shown as a
 * whole percent is not rounded twice (5 of 11 is 45%, not 0.455 then 46%).
 */
export function round(
  value: number | null | undefined,
  digits = 4,
): number | null {
  return value === null || value === undefined
    ? null
    : Number(value.toFixed(digits));
}
