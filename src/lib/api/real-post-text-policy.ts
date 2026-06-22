type BlockedMarker = {
  label: string;
  pattern: RegExp;
};

const blockedDebugMarkers: BlockedMarker[] = [
  { label: "PostFoundry", pattern: /post\s*foundry/i },
  { label: "smoke", pattern: /\bsmoke\b/i },
  { label: "test", pattern: /\btest(?:ing)?\b/i },
  { label: "debug", pattern: /\bdebug(?:ging)?\b/i },
  { label: "dry-run", pattern: /\bdry[\s-]*run\b/i },
  { label: "task id", pattern: /\btask\s*(?:id|no\.?|number|#)?\s*[:#-]?\s*\d{1,8}\b/i },
  { label: "task id", pattern: /(?:^|[^\w])(?:20\d{6}[A-Z](?:\.\d{3})?|\.\d{3})(?:$|[^\w])/ },
  { label: "测试", pattern: /测试|调试|验收|验证|烟雾测试|干跑|任务\s*(?:编号|ID|#)?\s*[:#-]?\s*\d+/ }
];

export function findRealDebugPostTextViolation(text: string): string | undefined {
  const normalized = text.trim();
  if (!normalized) {
    return "--post-text is required for real posting";
  }

  const marker = blockedDebugMarkers.find((candidate) => candidate.pattern.test(normalized));
  if (!marker) {
    return undefined;
  }

  return `real debug post text must not contain obvious test/debug marker: ${marker.label}`;
}
