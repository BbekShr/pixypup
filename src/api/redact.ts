// Terminal text is sent to Muse Spark: strip anything that looks like a credential first.
const PATTERNS: RegExp[] = [
  /\bBearer\s+[\w.~+/=-]+/gi,
  /\b(?:sk|pk|rk)-[\w-]{8,}|\bgh[pousr]_\w{8,}|\bxox[bpas]-[\w-]{8,}|\bAKIA[0-9A-Z]{12,}/g,
  /\b(?:api[_-]?key|token|secret|password|passwd)\s*[=:]\s*\S+/gi,
  /(?<=:\/\/)[^\s/@:]+:[^\s/@]+@/g,
  /\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}\b/g,
];

export const redactSecrets = (text: string): string => PATTERNS.reduce((t, re) => t.replace(re, '[redacted]'), text);
