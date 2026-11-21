import { normalizePage } from './pagePatterns';

// What the app reports about its use: which pages were opened (as fixed patterns, never addresses, ids or
// amounts) and an id that groups one visit. Pure logic here; sending lives in components/ActivityTracker.tsx.

export const MAX_BATCH = 50;
export const MAX_BUFFERED = 200;

export interface PageHit {
  path: string;
  at: string;
}

/** A random id for one visit. Grouping only, not security, so no crypto module is needed. */
export const newSessionId = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });

let sessionId = newSessionId();
export const getSessionId = (): string => sessionId;
/** A new visit: called at sign-in, sign-up and sign-out. */
export const resetSessionId = (): string => (sessionId = newSessionId());

/**
 * Pages waiting to be sent. Takes the real path, keeps only its pattern, skips a repeat of the page just
 * opened, and never holds more than MAX_BUFFERED (the oldest go first).
 */
export class ActivityBuffer {
  private hits: PageHit[] = [];
  private lastPage: string | null = null;

  add(path: string, now: Date = new Date()): boolean {
    const page = normalizePage(path);
    if (!page || page === this.lastPage) return false;
    this.lastPage = page;
    this.hits.push({ path: page, at: now.toISOString() });
    if (this.hits.length > MAX_BUFFERED) this.hits.splice(0, this.hits.length - MAX_BUFFERED);
    return true;
  }

  get size(): number {
    return this.hits.length;
  }

  /** Takes up to MAX_BATCH pages out. Put them back with restore() if sending fails. */
  drain(): PageHit[] {
    return this.hits.splice(0, MAX_BATCH);
  }

  restore(batch: PageHit[]): void {
    this.hits.unshift(...batch);
    if (this.hits.length > MAX_BUFFERED) this.hits.splice(0, this.hits.length - MAX_BUFFERED);
  }

  /** Forget everything, e.g. when someone signs out: pages must not carry over to the next person. */
  clear(): void {
    this.hits = [];
    this.lastPage = null;
  }
}
