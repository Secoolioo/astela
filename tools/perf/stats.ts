/**
 * Statistics for the performance harness. Timings on shared CI runners vary from run to
 * run, so a timing budget fails only when the difference is both larger than the budget
 * and statistically significant (docs/architecture/performance.md).
 */

/**
 * The median of a list of numbers; 0 for an empty list.
 * @param values - Samples.
 */
export function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

/**
 * The standard normal cumulative distribution function.
 * @param z - Standard score.
 */
export function normalCdf(z: number): number {
  // Abramowitz and Stegun 7.1.26 for erf, accurate to about 1.5e-7.
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * One-sided Mann-Whitney U test: the probability of seeing samples like `a` and `b` if
 * values from `a` were not larger than values from `b`. Uses the normal approximation with
 * tie and continuity correction, which is accurate for the sample sizes of the harness
 * (n = 10 to 20 per group).
 * @param a - Samples expected to be larger.
 * @param b - Samples to compare with.
 * @returns The p-value; 1 when either group is empty.
 */
export function mannWhitneyGreater(a: readonly number[], b: readonly number[]): number {
  const n1 = a.length;
  const n2 = b.length;
  if (n1 === 0 || n2 === 0) return 1;
  let u = 0;
  for (const x of a) {
    for (const y of b) {
      if (x > y) u += 1;
      else if (x === y) u += 0.5;
    }
  }
  const n = n1 + n2;
  const counts = new Map<number, number>();
  for (const value of [...a, ...b]) counts.set(value, (counts.get(value) ?? 0) + 1);
  const ties = [...counts.values()].reduce((sum, t) => sum + (t ** 3 - t), 0);
  const variance = ((n1 * n2) / 12) * (n + 1 - ties / (n * (n - 1)));
  if (variance <= 0) return u > (n1 * n2) / 2 ? 0 : 1;
  const z = (u - (n1 * n2) / 2 - 0.5) / Math.sqrt(variance);
  return 1 - normalCdf(z);
}

/**
 * The limit of the idle CPU of all processes together, in percent of one core: the ceiling and
 * the bare reference plus the allowed difference, whichever is lower. On macOS only the
 * relative part gates (ADR 0017), as the 3-core runners alone used up to 0.5 % of a core.
 * @param bare - Idle CPU of the bare reference in the same job.
 * @param ceiling - The absolute ceiling.
 * @param extraPoints - The percentage points that the browser may add to the reference.
 * @param platform - The system the job runs on.
 */
export function idleCpuLimit(
  bare: number,
  ceiling: number,
  extraPoints: number,
  platform: NodeJS.Platform,
): number {
  const relative = bare + extraPoints;
  return platform === 'darwin' ? relative : Math.min(ceiling, relative);
}

/** The idle CPU of the browser and of the bare reference in one round, and the browser's limit. */
export interface IdleCpuRound {
  readonly browser: number;
  readonly bare: number;
  readonly limit: number;
}

/**
 * The round of idle CPU windows that leaves the browser the most room below its limit. In each
 * round the browser and the reference run one after the other, under the same load of the
 * runner, so a round compares like with like; the quietest window of one variant would otherwise
 * meet the quietest of the other from a calmer moment of the runner.
 * @param browser - The browser's load in % of one core, one value per round.
 * @param bare - The reference's load in the same rounds.
 * @param ceiling - The absolute budget in % of one core.
 * @param extraPoints - How many percentage points the browser may add to the reference.
 * @param platform - The system, as {@link idleCpuLimit} takes it.
 */
export function idleCpuRound(
  browser: readonly number[],
  bare: readonly number[],
  ceiling: number,
  extraPoints: number,
  platform: NodeJS.Platform,
): IdleCpuRound {
  let best: IdleCpuRound | undefined;
  for (const [index, load] of browser.entries()) {
    const reference = bare[index];
    if (reference === undefined) continue;
    const limit = idleCpuLimit(reference, ceiling, extraPoints, platform);
    if (best === undefined || limit - load > best.limit - best.browser) {
      best = { browser: load, bare: reference, limit };
    }
  }
  if (best === undefined) throw new Error('No round measured both variants');
  return best;
}
