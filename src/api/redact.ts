// Terminal text is sent to Muse Spark: strip anything that looks like a credential first.
const PATTERNS: RegExp[] = [
  /\bBearer\s+[\w.~+/=-]+|\bAuthorization:\s*Basic\s+\S+/gi,
  /\b(?:sk|pk|rk)[-_][\w-]{8,}|\bgh[pousr]_\w{8,}|\bxox[bpas]-[\w-]{8,}|\bAKIA[0-9A-Z]{12,}|\beyJ[\w-]+\.[\w-]+\.[\w-]*/g,
  // No leading \b: `_` is a word char, so AWS_SECRET_ACCESS_KEY, GITHUB_TOKEN and client_secret must match too.
  /[\w-]*(?:api[_-]?key|access[_-]?key|token|secret|password|passwd|cookie|session)[\w-]*\s*[=:]\s*(?:"[^"]*"|'[^']*'|\S+)/gi,
  /(?<=:\/\/)[^\s/@:]+:[^\s/@]+@/g,
  /\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/g,
];

export const redactSecrets = (text: string): string => PATTERNS.reduce((t, re) => t.replace(re, '[redacted]'), text);
