import { useCallback, useInsertionEffect, useRef } from "react";

/**
 * Returns a function that always returns the latest implementation of `fn` without causing React re-renders,
 * making it safe to use inside event handlers and effects.
 *
 * This avoids unnecessary effect triggers or dependency updates, preventing stale closures without causing re-subscription.
 *
 * @template T The type of the callback function.
 * @param fn The function whose latest version should always be invoked.
 * @returns The stable callback function, always calling the latest provided `fn`.
 */
export const useNonReactiveCallback = <
  T extends (...args: Parameters<T>) => ReturnType<T>,
>(
  fn: T,
): T => {
  const fnReference = useRef(fn);
  useInsertionEffect(() => {
    fnReference.current = fn;
  }, [fn]);
  return useCallback(
    (...args: Parameters<T>) => {
      const latestFn = fnReference.current;
      return latestFn(...args);
    },
    [fnReference],
  ) as unknown as T;
};
