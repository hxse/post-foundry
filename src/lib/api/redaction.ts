const secretPatterns = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/g,
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["'][^"']+["']/gi
];

export function tokenFingerprint(token: string | undefined): string {
  if (!token) {
    return "not_configured";
  }

  if (token.length <= 8) {
    return "***";
  }

  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function redactSecrets(input: string): string {
  return secretPatterns.reduce((output, pattern) => output.replace(pattern, "[redacted]"), input);
}
