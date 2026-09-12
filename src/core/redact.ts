const SECRET_KEYS = /token|secret|password|authorization|api[-_]?key/i;
const PII_KEYS = /ssn|social.?security|account.?number|routing.?number/i;

export function redact(value: unknown, key = ""): unknown {
  if (SECRET_KEYS.test(key) || PII_KEYS.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  }
  return value;
}
