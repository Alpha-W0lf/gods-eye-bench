/**
 * A frozen clock for the replay process (ADR 0002): `Date.now()`, `new Date()`
 * and `Date()` all report one instant. Dates built from arguments are
 * unchanged, and timers keep running.
 */

/** Freeze `Date` at `ms`. Returns a function that restores the real `Date`. */
export function freezeClock(ms: number): () => void {
  if (!Number.isFinite(ms)) throw new TypeError('freezeClock needs a time');
  const RealDate = globalThis.Date;
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) =>
      Reflect.construct(target, args.length ? args : [ms], newTarget),
    apply: () => new RealDate(ms).toString(),
    get: (target, property, receiver) =>
      property === 'now' ? () => ms : Reflect.get(target, property, receiver),
  });
  return () => {
    globalThis.Date = RealDate;
  };
}
