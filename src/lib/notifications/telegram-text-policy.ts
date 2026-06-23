const blockedNotificationPatterns = [/postfoundry/i, /smoke\s+test/i, /\bdebug\b/i, /\btask\s+\d{8}[a-z](?:\.\d{3})?\b/i];

export function findTelegramNotificationTextViolation(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return "Telegram notification text is required";
  }
  if (trimmed.length > 4096) {
    return "Telegram notification text must be at most 4096 characters";
  }

  const blocked = blockedNotificationPatterns.find((pattern) => pattern.test(trimmed));
  if (blocked) {
    return "Telegram notification text must not look like a smoke/debug/task test message";
  }

  return undefined;
}
