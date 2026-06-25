import type { AccountInitialPrompt } from "../accounts/account-prompt";

export type PublicXSourceQueryInput = AccountInitialPrompt | string;

export type PublicXSourceQueryOptions = {
  maxQueries?: number;
};

const defaultMaxQueries = 10;
const directionLinePattern = /(?:账号方向|账号定位|关注方向|内容方向|选题方向|主题方向|领域)\s*[：:]\s*(.+)/;
const hashtagPattern = /#[\p{L}\p{N}_-]+/gu;
const quotedTermPattern = /[“"]([^”"]{2,48})[”"]/g;
const asciiTokenPattern = /\b[A-Za-z][A-Za-z0-9+.#-]{1,31}\b/g;
const genericAsciiTokens = new Set([
  "postfoundry",
  "debug",
  "smoke",
  "test",
  "testing",
  "account",
  "prompt",
  "twitter",
  "tweet"
]);
const genericChineseFragments = [
  "账号",
  "方向",
  "定位",
  "运营",
  "助手",
  "发帖",
  "原则",
  "自然表达",
  "调试",
  "痕迹",
  "机器人",
  "语义重复"
];

export function derivePublicXSearchQueriesFromPrompt(
  input: PublicXSourceQueryInput,
  options: PublicXSourceQueryOptions = {}
): string[] {
  const prompt = typeof input === "string" ? input : input.prompt;
  const accountKey = typeof input === "string" ? undefined : input.accountKey;
  const maxQueries = options.maxQueries ?? defaultMaxQueries;
  const candidates: string[] = [];

  for (const line of prompt.split(/\r?\n/)) {
    const match = directionLinePattern.exec(line);
    if (match) {
      candidates.push(...splitTopicText(match[1]));
    }
  }

  candidates.push(...(prompt.match(hashtagPattern) ?? []).map((tag) => tag.slice(1)));

  for (const match of prompt.matchAll(quotedTermPattern)) {
    candidates.push(match[1]);
  }

  candidates.push(...(prompt.match(asciiTokenPattern) ?? []));

  return uniqueStrings(
    candidates
      .map((query) => normalizeQuery(query))
      .filter((query) => isUsefulQuery(query, accountKey))
  ).slice(0, maxQueries);
}

function splitTopicText(value: string): string[] {
  return value
    .replace(/[。.!！?？].*$/, "")
    .split(/[、，,；;]/)
    .flatMap((part) => part.split(/(?:和|与)/))
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeQuery(value: string): string {
  return value
    .replace(/^[-*\d.、\s]+/, "")
    .replace(/[。.!！?？；;，,、：:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulQuery(value: string, accountKey?: string): boolean {
  if (value.length < 2 || value.length > 48) {
    return false;
  }
  const lower = value.toLowerCase();
  if (accountKey && lower === accountKey.toLowerCase()) {
    return false;
  }
  if (genericAsciiTokens.has(lower)) {
    return false;
  }
  if (genericChineseFragments.some((fragment) => value === fragment || value.includes(fragment) && value.length <= fragment.length + 2)) {
    return false;
  }
  return true;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}
