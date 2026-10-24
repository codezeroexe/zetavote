import { useCallback, useState } from "react";
import { toMessage } from "../services/api";

/**
 * The submit lifecycle every form page in the app was repeating by hand:
 * a loading flag, a result slot, an error string, and the same try/catch/finally
 * around the request. Six copies of that, so it lives here once.
 */
export function useSubmit<T>() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Resets the result and error, leaving form fields alone. */
  const clear = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  /**
   * `fn` receives nothing; the caller closes over whatever it needs. Errors are
   * mapped through toMessage so pages get a readable string rather than a
   * rejected promise, falling back to `fallbackMessage`. `onSuccess` runs before
   * the result is stored, which is where pages clear sensitive fields like
   * passphrases.
   */
  const run = useCallback(
    async (
      fn: () => Promise<T>,
      options: { onSuccess?: (value: T) => void; fallbackMessage?: string } = {}
    ): Promise<T | null> => {
      setLoading(true);
      setResult(null);
      setError(null);
      try {
        const value = await fn();
        options.onSuccess?.(value);
        setResult(value);
        return value;
      } catch (err: unknown) {
        setError(toMessage(err, options.fallbackMessage ?? "Request failed"));
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return { loading, result, error, run, clear, setError };
}
