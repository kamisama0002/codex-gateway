export type LeaseRelease = () => void;

interface PendingLease {
  resolve: (release: LeaseRelease) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
}

interface LeaseState {
  active: number;
  pending: PendingLease[];
}

/** Bounds resources whose lifetime continues after their asynchronous open call returns. */
export class KeyedLeaseLimiter {
  private readonly states = new Map<string, LeaseState>();

  constructor(private readonly concurrency: number) {
    if (!Number.isInteger(concurrency) || concurrency <= 0) {
      throw new Error("Lease concurrency must be a positive integer");
    }
  }

  acquire(key: string, options: { signal?: AbortSignal } = {}): Promise<LeaseRelease> {
    if (options.signal?.aborted === true) return Promise.reject(abortError(options.signal));
    const state = this.stateFor(key);
    if (state.active < this.concurrency) {
      state.active += 1;
      return Promise.resolve(this.releaseFor(key, state));
    }

    return new Promise<LeaseRelease>((resolve, reject) => {
      const pending: PendingLease = { resolve, reject, signal: options.signal };
      if (options.signal !== undefined) {
        pending.abort = () => {
          const index = state.pending.indexOf(pending);
          if (index < 0) return;
          state.pending.splice(index, 1);
          reject(abortError(options.signal!));
          this.removeAbortListener(pending);
          this.deleteIdleState(key, state);
        };
        options.signal.addEventListener("abort", pending.abort, { once: true });
      }
      state.pending.push(pending);
    });
  }

  reset(key: string, error = new Error("Leased resource pool was reset")) {
    const state = this.states.get(key);
    if (state === undefined) return;
    this.states.delete(key);
    for (const pending of state.pending.splice(0)) {
      this.removeAbortListener(pending);
      pending.reject(error);
    }
  }

  private stateFor(key: string) {
    const existing = this.states.get(key);
    if (existing !== undefined) return existing;
    const state: LeaseState = { active: 0, pending: [] };
    this.states.set(key, state);
    return state;
  }

  private releaseFor(key: string, state: LeaseState): LeaseRelease {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      state.active = Math.max(0, state.active - 1);
      this.admitPending(key, state);
    };
  }

  private admitPending(key: string, state: LeaseState) {
    if (this.states.get(key) !== state) return;
    while (state.active < this.concurrency && state.pending.length > 0) {
      const pending = state.pending.shift()!;
      this.removeAbortListener(pending);
      if (pending.signal?.aborted === true) {
        pending.reject(abortError(pending.signal));
        continue;
      }
      state.active += 1;
      pending.resolve(this.releaseFor(key, state));
    }
    this.deleteIdleState(key, state);
  }

  private removeAbortListener(pending: PendingLease) {
    if (pending.signal !== undefined && pending.abort !== undefined) {
      pending.signal.removeEventListener("abort", pending.abort);
    }
  }

  private deleteIdleState(key: string, state: LeaseState) {
    if (state.active === 0 && state.pending.length === 0 && this.states.get(key) === state) {
      this.states.delete(key);
    }
  }
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Lease request was aborted", { cause: signal.reason });
}
