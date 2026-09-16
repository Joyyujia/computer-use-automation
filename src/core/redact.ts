const SECRET_KEYS = /token|secret|password|authorization|api[-_]?key/i;
const PII_KEYS = /ssn|social.?security|account.?number|routing.?number/i;

export function redactText(value: string, sensitiveValues: readonly string[] = []): string {
  let result = value;
  const variants = [...new Set(sensitiveValues.filter(Boolean).flatMap(item => [item, encodeURIComponent(item)]))].sort((a, b) => b.length - a.length);
  for (const sensitive of variants) result = result.replaceAll(sensitive, "[REDACTED]");
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
