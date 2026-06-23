import { z } from "zod";
import { ApiError } from "../api/errors";
import type { PublicXDataProvider, PublicXPostSnapshot } from "../providers/public-x";
import type { RecordApiCallAuditInput, RuntimeRepository } from "../storage/repositories";
import type { SourceEngagementMetrics, SourceMaterialInput } from "./source-ingestion";

export type SourceAdapterApiAudit = Omit<RecordApiCallAuditInput, "id">;

export type SourceAdapterResult = {
  materials: SourceMaterialInput[];
  apiAudit: SourceAdapterApiAudit;
};

export type CollectTwitterApiIoSearchMaterialsInput = {
  accountUuid: string;
  provider: PublicXDataProvider;
  query: string;
  limit: number;
  topicTags?: string[];
  collectedAt: string;
  repo?: RuntimeRepository;
  apiAuditId?: string;
  startedAt?: string;
  finishedAt?: string;
};

export type ManualNoteFixture = {
  id: string;
  title?: string;
  note: string;
  capturedAt?: string;
  topicTags?: string[];
};

export type CollectManualNoteMaterialsInput = {
  accountUuid: string;
  notes: ManualNoteFixture[];
  collectedAt: string;
  topicTags?: string[];
};

export type WebNewsFixture = {
  id: string;
  url: string;
  title: string;
  summary?: string;
  text?: string;
  capturedAt?: string;
  topicTags?: string[];
};

export type CollectWebNewsFixtureMaterialsInput = {
  accountUuid: string;
  pages: WebNewsFixture[];
  collectedAt: string;
  topicTags?: string[];
};

type OptionalApiAuditPair =
  | {
      repo?: undefined;
      apiAuditId?: undefined;
    }
  | {
      repo: RuntimeRepository;
      apiAuditId: string;
    };

const nonEmptyStringSchema = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime();
const accountUuidSchema = z.string().uuid();
const topicTagsSchema = z.array(nonEmptyStringSchema).default([]);

const twitterSearchInputSchema = z
  .object({
    accountUuid: accountUuidSchema,
    query: nonEmptyStringSchema,
    limit: z.number().int().min(1).max(10),
    topicTags: topicTagsSchema,
    collectedAt: isoDateTimeSchema,
    startedAt: isoDateTimeSchema.optional(),
    finishedAt: isoDateTimeSchema.optional()
  })
  .strict();

const manualNoteFixtureSchema = z
  .object({
    id: nonEmptyStringSchema,
    title: nonEmptyStringSchema.optional(),
    note: nonEmptyStringSchema,
    capturedAt: isoDateTimeSchema.optional(),
    topicTags: topicTagsSchema
  })
  .strict();

const webNewsFixtureSchema = z
  .object({
    id: nonEmptyStringSchema,
    url: z.string().url(),
    title: nonEmptyStringSchema,
    summary: nonEmptyStringSchema.optional(),
    text: nonEmptyStringSchema.optional(),
    capturedAt: isoDateTimeSchema.optional(),
    topicTags: topicTagsSchema
  })
  .strict()
  .superRefine((page, context) => {
    if (!page.summary && !page.text) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "web/news fixture must include summary or text"
      });
    }
  });

const adapterApiAuditSchema = z
  .object({
    accountUuid: accountUuidSchema,
    provider: nonEmptyStringSchema,
    operation: nonEmptyStringSchema,
    status: z.enum(["succeeded", "failed", "skipped"]),
    requestUnits: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative().optional(),
    startedAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema.optional(),
    metadata: z.record(z.unknown()).default({})
  })
  .strict();

export async function collectTwitterApiIoSearchMaterials(input: CollectTwitterApiIoSearchMaterialsInput): Promise<SourceAdapterResult> {
  const parsed = parseWithSchema(
    twitterSearchInputSchema,
    {
      accountUuid: input.accountUuid,
      query: input.query,
      limit: input.limit,
      topicTags: input.topicTags ?? [],
      collectedAt: input.collectedAt,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt
    },
    "twitterapi.io source adapter input is invalid"
  );
  assertOptionalApiAuditPair(input);
  const startedAt = parsed.startedAt ?? parsed.collectedAt;
  const finishedAt = parsed.finishedAt ?? parsed.collectedAt;

  let output: Awaited<ReturnType<PublicXDataProvider["searchPosts"]>>;
  let materials: SourceMaterialInput[];
  try {
    output = await input.provider.searchPosts({
      query: parsed.query,
      limit: parsed.limit
    });
    materials = output.posts.map((post) =>
      mapPublicXPostToSourceMaterial({
        accountUuid: parsed.accountUuid,
        post,
        topicTags: parsed.topicTags ?? [],
        capturedAt: parsed.collectedAt
      })
    );
  } catch (error) {
    const failedAudit: SourceAdapterApiAudit = {
      accountUuid: parsed.accountUuid,
      provider: "twitterapi.io",
      operation: "public_x_search",
      status: "failed",
      requestUnits: 1,
      startedAt,
      finishedAt,
      metadata: {
        query: parsed.query,
        limit: parsed.limit,
        error: describeError(error)
      }
    };
    tryRecordOptionalApiAudit(input.repo, input.apiAuditId, failedAudit);
    throw error;
  }

  const result: SourceAdapterResult = {
    materials,
    apiAudit: {
      accountUuid: parsed.accountUuid,
      provider: "twitterapi.io",
      operation: "public_x_search",
      status: "succeeded",
      requestUnits: 1,
      startedAt,
      finishedAt,
      metadata: {
        query: parsed.query,
        limit: parsed.limit,
        raw_count: output.rawCount,
        material_count: materials.length
      }
    }
  };
  recordOptionalApiAudit(input.repo, input.apiAuditId, result.apiAudit);
  return result;
}

export function collectManualNoteMaterials(input: CollectManualNoteMaterialsInput): SourceAdapterResult {
  const accountUuid = parseAccountUuid(input.accountUuid);
  const collectedAt = parseIsoDateTime(input.collectedAt, "collectedAt");
  const defaultTopicTags = parseTopicTags(input.topicTags ?? []);
  const notes = parseWithSchema(z.array(manualNoteFixtureSchema).min(1), input.notes, "manual note fixtures are invalid");
  assertUnique(notes.map((note) => note.id), "manual note id");

  const materials = notes.map((note) => ({
    id: `manual-note:${note.id}`,
    accountUuid,
    sourceType: "manual_note" as const,
    provider: "manual_fixture",
    sourceRef: `manual:${note.id}`,
    title: note.title,
    summary: note.note,
    capturedAt: note.capturedAt ?? collectedAt,
    topicTags: uniqueStrings([...(note.topicTags ?? []), ...defaultTopicTags])
  }));

  return {
    materials,
    apiAudit: {
      accountUuid,
      provider: "manual",
      operation: "manual_notes_fixture",
      status: "skipped",
      requestUnits: 0,
      startedAt: collectedAt,
      finishedAt: collectedAt,
      metadata: {
        note_count: notes.length,
        material_count: materials.length
      }
    }
  };
}

export function collectWebNewsFixtureMaterials(input: CollectWebNewsFixtureMaterialsInput): SourceAdapterResult {
  const accountUuid = parseAccountUuid(input.accountUuid);
  const collectedAt = parseIsoDateTime(input.collectedAt, "collectedAt");
  const defaultTopicTags = parseTopicTags(input.topicTags ?? []);
  const pages = parseWithSchema(z.array(webNewsFixtureSchema).min(1), input.pages, "web/news fixtures are invalid");
  assertUnique(pages.map((page) => page.id), "web/news fixture id");

  const materials = pages.map((page) => ({
    id: `web-news:${page.id}`,
    accountUuid,
    sourceType: "web_page" as const,
    provider: "web_news_fixture",
    sourceRef: `web:${page.url}`,
    sourceUrl: page.url,
    title: page.title,
    summary: page.summary ?? page.text ?? "",
    capturedAt: page.capturedAt ?? collectedAt,
    topicTags: uniqueStrings([...(page.topicTags ?? []), ...defaultTopicTags])
  }));

  return {
    materials,
    apiAudit: {
      accountUuid,
      provider: "web_news_fixture",
      operation: "web_news_fixture",
      status: "skipped",
      requestUnits: 0,
      startedAt: collectedAt,
      finishedAt: collectedAt,
      metadata: {
        page_count: pages.length,
        material_count: materials.length
      }
    }
  };
}

export function recordSourceAdapterApiAudit(params: {
  repo: RuntimeRepository;
  id: string;
  apiAudit: SourceAdapterApiAudit;
}): void {
  const audit = parseWithSchema(adapterApiAuditSchema, params.apiAudit, "source adapter API audit is invalid");
  params.repo.recordApiCallAudit({
    id: parseNonEmpty(params.id, "id"),
    accountUuid: audit.accountUuid,
    provider: audit.provider,
    operation: audit.operation,
    status: audit.status,
    requestUnits: audit.requestUnits,
    costUsd: audit.costUsd,
    startedAt: audit.startedAt,
    finishedAt: audit.finishedAt,
    metadata: audit.metadata
  });
}

function mapPublicXPostToSourceMaterial(input: {
  accountUuid: string;
  post: PublicXPostSnapshot;
  topicTags: string[];
  capturedAt: string;
}): SourceMaterialInput {
  const engagement: SourceEngagementMetrics = {
    likeCount: input.post.likeCount,
    repostCount: input.post.repostCount,
    replyCount: input.post.replyCount,
    quoteCount: input.post.quoteCount,
    bookmarkCount: input.post.bookmarkCount,
    viewCount: input.post.viewCount
  };
  return {
    id: `public-x:${input.post.id}`,
    accountUuid: input.accountUuid,
    sourceType: "public_x_post",
    provider: "twitterapi.io",
    sourceRef: `tweet:${input.post.id}`,
    sourceUrl: input.post.url,
    title: input.post.authorHandle ? `X post by @${input.post.authorHandle}` : "X post",
    text: input.post.text,
    summary: input.post.text,
    capturedAt: input.capturedAt,
    topicTags: input.topicTags,
    authorHandle: input.post.authorHandle,
    engagement: removeUndefinedEngagement(engagement)
  };
}

function recordOptionalApiAudit(
  repo: RuntimeRepository | undefined,
  apiAuditId: string | undefined,
  apiAudit: SourceAdapterApiAudit
): void {
  const pair = { repo, apiAuditId };
  assertOptionalApiAuditPair(pair);
  if (!pair.repo) {
    return;
  }
  recordSourceAdapterApiAudit({ repo: pair.repo, id: pair.apiAuditId, apiAudit });
}

function assertOptionalApiAuditPair(input: {
  repo?: RuntimeRepository;
  apiAuditId?: string;
}): asserts input is OptionalApiAuditPair {
  if ((input.repo && !input.apiAuditId) || (!input.repo && input.apiAuditId)) {
    throw adapterError("repo and apiAuditId must be provided together");
  }
}

function tryRecordOptionalApiAudit(
  repo: RuntimeRepository | undefined,
  apiAuditId: string | undefined,
  apiAudit: SourceAdapterApiAudit
): void {
  try {
    recordOptionalApiAudit(repo, apiAuditId, apiAudit);
  } catch {
    // Preserve the original provider/mapping error. Audit-write failures are checked separately.
  }
}

function removeUndefinedEngagement(engagement: SourceEngagementMetrics): SourceEngagementMetrics | undefined {
  const entries = Object.entries(engagement).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries) as SourceEngagementMetrics;
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof ApiError) {
    return {
      name: error.name,
      code: error.code,
      provider: error.provider,
      stage: error.stage,
      status: error.status
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }
  return {
    value: String(error)
  };
}

function parseAccountUuid(value: string): string {
  const parsed = accountUuidSchema.safeParse(value);
  if (!parsed.success) {
    throw adapterError("accountUuid must be a UUID");
  }
  return parsed.data;
}

function parseIsoDateTime(value: string, field: string): string {
  const parsed = isoDateTimeSchema.safeParse(value);
  if (!parsed.success) {
    throw adapterError(`${field} must be an ISO datetime`);
  }
  return parsed.data;
}

function parseTopicTags(value: string[]): string[] {
  return parseWithSchema(topicTagsSchema, value, "topic tags are invalid") ?? [];
}

function parseNonEmpty(value: string, field: string): string {
  const parsed = nonEmptyStringSchema.safeParse(value);
  if (!parsed.success) {
    throw adapterError(`${field} must be non-empty`);
  }
  return parsed.data;
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw adapterError(`duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown, message: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw adapterError(message, parsed.error.flatten());
  }
  return parsed.data;
}

function adapterError(message: string, details?: unknown): ApiError {
  return new ApiError({
    code: "invalid_request",
    provider: "local",
    stage: "source_adapter",
    message,
    details
  });
}
