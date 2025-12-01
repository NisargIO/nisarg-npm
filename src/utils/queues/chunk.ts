/**
 * Splits an array into consecutive chunks of the provided size, omitting any
 * falsy values (e.g. `undefined`, `null`, `0`, `''`, `false`) encountered in the
 * original sequence.
 *
 * @param array Array of values to partition.
 * @param size Target number of items per chunk. Must be greater than `0`.
 * @returns A new array composed of chunked subarrays.
 *
 * @example
 * const values = [1, 2, 3, 4, 5];
 * const result = chunk(values, 2);
 * // result === [[1, 2], [3, 4], [5]]
 *
 * @example
 * const sparse = [1, undefined, 3, null, 5];
 * const result = chunk(sparse, 2);
 * // result === [[1, 3], [5]]
 */
export const chunk = <T>(array: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i++) {
    const item = array[i];
    if (!item) continue;
    const chunkIndex = Math.floor(i / size);
    if (!result[chunkIndex]) {
      result[chunkIndex] = [];
    }
    result[chunkIndex].push(item);
  }
  return result;
};