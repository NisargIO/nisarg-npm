/**
 * Resolves with the first non-nullish value produced by any promise in the provided list.
 *
 * This helper is useful when orchestrating tiered data sources where only one needs to
 * succeed. For example, you might check an in-memory cache with a very low TTL alongside
 * a slower, long-lived cache: the fast cache often wins, but when its entry has expired,
 * the slower cache prevents an unnecessary miss without delaying the fast-path success.
 *
 * @typeParam T - The value type each promise resolves to.
 * @param promises - A collection of promises that may resolve to nullable values.
 * @returns A promise that resolves with the first value that is neither `undefined` nor `null`.
 *
 * @example
 * ```ts
 * const value = await raceToNonNullish([
 *   readFromFastCache(key), // resolves quickly but may return undefined if the TTL expired
 *   readFromSlowCache(key), // slower, but more likely to have the data
 * ]);
 * ```
 */
export const raceToNonNullish = <T>(promises: Promise<T>[]): Promise<T> => {
  return new Promise((resolve) => {
    let resolved = false;
    for (const promise of promises) {
      promise.then((value) => {
        if (value !== undefined && value !== null && !resolved) {
          resolved = true;
          resolve(value);
        }
        return value;
      });
    }
  });
};
