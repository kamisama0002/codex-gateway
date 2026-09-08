export function createRetryTimer(attempt: number, run: () => void) {
  return window.setTimeout(run, delayForRetry(attempt));
}

export function delayForRetry(attempt: number) {
  return Math.min(15_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

export function waitForRetry(attempt: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(cancellationError(signal));
      return;
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayForRetry(attempt));
    const abort = () => {
      globalThis.clearTimeout(timer);
      reject(cancellationError(signal));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function cancellationError(signal: AbortSignal | undefined) {
  return signal?.reason instanceof Error ? signal.reason : new Error("Submission cancelled");
}
