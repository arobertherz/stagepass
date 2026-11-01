import { isValidDomain } from './domain.js';

export const SESSION_KEY = 'stagepass_domain';
export const DEFAULT_SESSION_HOURS = 12;

export type SessionRecord = {
  domain: string;
  expires: number;
};

/**
 * Parse a localStorage session value (JSON object or legacy plain string).
 * Legacy/malformed/expired values return null.
 *
 * @param raw - Raw localStorage string
 * @param now - Current timestamp (ms)
 */
export function parseSession(
  raw: string | null,
  now: number = Date.now()
): SessionRecord | null {
  if (!raw) return null;

  // Legacy plain string domain
  if (!raw.startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SessionRecord>;
    if (
      typeof parsed.domain !== 'string' ||
      typeof parsed.expires !== 'number' ||
      !Number.isFinite(parsed.expires)
    ) {
      return null;
    }
    if (!isValidDomain(parsed.domain)) return null;
    if (parsed.expires <= now) return null;
    return { domain: parsed.domain, expires: parsed.expires };
  } catch {
    return null;
  }
}

/**
 * Serialize a session record for localStorage.
 *
 * @param domain - Valid domain or keyword
 * @param hours - Lifetime in hours
 * @param now - Current timestamp (ms)
 */
export function createSession(
  domain: string,
  hours: number = DEFAULT_SESSION_HOURS,
  now: number = Date.now()
): SessionRecord {
  const safeHours =
    Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SESSION_HOURS;
  return {
    domain,
    expires: now + safeHours * 60 * 60 * 1000,
  };
}

/**
 * @param record - Session to store
 */
export function serializeSession(record: SessionRecord): string {
  return JSON.stringify(record);
}

/**
 * Parse `data-stagepass-session-hours` attribute (positive number, else default).
 *
 * @param value - Attribute value
 */
export function parseSessionHours(value: string | null | undefined): number {
  if (value == null || value === '') return DEFAULT_SESSION_HOURS;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SESSION_HOURS;
  return n;
}
