export function sanitizeLogMessage(value) {
  const message =
    value === undefined ||
    value === null
      ? ""
      : String(value);

  return message
    .replace(
      /([A-Za-z][A-Za-z0-9+.-]*:\/\/[^:\s/@]+):([^@\s]+)@/g,
      "$1:[REDACTED]@",
    )
    .replace(
      /\b(authorization)\s*:\s*bearer\s+[^\s,;]+/gi,
      "$1: Bearer [REDACTED]",
    )
    .replace(
      /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
      "Bearer [REDACTED]",
    )
    .replace(
      /\b([A-Z0-9_]*(?:APP_KEY|API_KEY|PASSWORD|PASSWD|TOKEN|SECRET|PRIVATE_KEY|CREDENTIAL|DATABASE_URL|MYSQL_PWD|PGPASSWORD)[A-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /("?(?:password|token|secret|api[_-]?key|app[_-]?key|db[_-]?password)"?\s*:\s*)("[^"]*"|'[^']*'|[^,\s}]+)/gi,
      '$1"[REDACTED]"',
    );
}
