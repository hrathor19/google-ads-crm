/**
 * In-memory login rate limiter — 5 failed attempts per email locks the
 * account out for 15 minutes. State lives in module scope, so it resets on
 * server restart and is per-instance; that's an acceptable trade-off for a
 * single-instance deployment (no extra table or Redis needed).
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // failures older than this are forgotten
const LOCKOUT_MS = 15 * 60 * 1000;

interface Entry {
  count: number;
  firstFailureAt: number;
  lockedUntil: number | null;
}

const attempts = new Map<string, Entry>();

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** Seconds until the lockout lifts, or null if not locked out. */
export function getLockoutRemaining(email: string): number | null {
  const entry = attempts.get(normalize(email));
  if (!entry?.lockedUntil) return null;
  const remainingMs = entry.lockedUntil - Date.now();
  if (remainingMs <= 0) {
    attempts.delete(normalize(email));
    return null;
  }
  return Math.ceil(remainingMs / 1000);
}

export function recordFailedLogin(email: string): void {
  const key = normalize(email);
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now - entry.firstFailureAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstFailureAt: now, lockedUntil: null });
    return;
  }

  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_MS;
  }

  // Opportunistic cleanup so the map can't grow unbounded under a
  // credential-stuffing run against many different emails.
  if (attempts.size > 1000) {
    attempts.forEach((e, k) => {
      const expired = now - e.firstFailureAt > WINDOW_MS && (!e.lockedUntil || e.lockedUntil < now);
      if (expired) attempts.delete(k);
    });
  }
}

export function clearFailedLogins(email: string): void {
  attempts.delete(normalize(email));
}
