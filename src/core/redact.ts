const SECRET_KEYS = /token|secret|password|authorization|api[-_]?key/i;
const PII_KEYS = /ssn|social.?security|account.?number|routing.?number/i;
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const CURRENCY_PATTERN = /\p{Sc}\s?\d[\d,]*(?:\.\d{2})?/gu;

export function sensitiveUrlValues(rawUrl: string): string[] {
  try {
    const url = new URL(rawUrl);
    return [url.username, url.password, ...url.searchParams.values(), url.hash.slice(1)].filter(Boolean);
  } catch { return []; }
}

export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (!url.username && !url.password && !url.search && !url.hash) return rawUrl;
    if (url.username) url.username = "[REDACTED]";
    if (url.password) url.password = "[REDACTED]";
    for (const key of url.searchParams.keys()) url.searchParams.set(key, "[REDACTED]");
    if (url.hash) url.hash = "#[REDACTED]";
    return url.toString().replaceAll("%5BREDACTED%5D", "[REDACTED]");
  } catch { return rawUrl.split("?", 1)[0].split("#", 1)[0]; }
}

export function redactText(value: string, sensitiveValues: readonly string[] = []): string {
  let result = value;
  const variants = [...new Set(sensitiveValues.filter(Boolean).flatMap(item => [item, encodeURIComponent(item)]))].sort((a, b) => b.length - a.length);
  for (const sensitive of variants) result = result.replaceAll(sensitive, "[REDACTED]");
  result = result.replace(URL_PATTERN, candidate => redactUrl(candidate));
  result = result.replace(EMAIL_PATTERN, "[REDACTED:EMAIL]");
  result = result.replace(SSN_PATTERN, "[REDACTED:SSN]");
  result = result.replace(CURRENCY_PATTERN, "[REDACTED:CURRENCY]");
  return result;
}

export function redact(value: unknown, key = "", sensitiveValues: readonly string[] = []): unknown {
  if (SECRET_KEYS.test(key) || PII_KEYS.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactText(value, sensitiveValues);
  if (Array.isArray(value)) return value.map((item) => redact(item, "", sensitiveValues));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k, sensitiveValues)]));
  }
  return value;
}
