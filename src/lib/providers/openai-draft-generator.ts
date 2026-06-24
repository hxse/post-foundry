import { z } from "zod";
import { ApiError, mapHttpStatus } from "../api/errors";
import { defaultFetch, readJson, type FetchLike } from "../api/http";
import type { ProductionDraftGenerationInput, ProductionDraftGenerationResult } from "../llm/production-draft-generator";

export type OpenAiResponsesDraftGeneratorOptions = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetcher?: FetchLike;
};

const responseSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    output: z.array(
      z
        .object({
          type: z.string().min(1),
          content: z
            .array(
              z
                .object({
                  type: z.string().min(1),
                  text: z.string().optional()
                })
                .passthrough()
            )
            .optional()
        })
        .passthrough()
    ),
    usage: z
      .object({
        input_tokens: z.number().int().nonnegative().optional(),
        output_tokens: z.number().int().nonnegative().optional()
      })
      .passthrough()
      .optional(),
    error: z.unknown().optional()
  })
  .passthrough();

export class OpenAiResponsesDraftGenerator {
  readonly providerName = "openai";
  readonly model: string;

  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;

  constructor(options: OpenAiResponsesDraftGeneratorOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gpt-5.4";
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.fetcher = options.fetcher ?? defaultFetch();
  }

  async generateDraft(input: ProductionDraftGenerationInput): Promise<ProductionDraftGenerationResult> {
    if (!this.apiKey) {
      throw new ApiError({
        code: "missing_credentials",
        provider: "openai",
        stage: "responses_create",
        message: "OpenAI API key is missing"
      });
    }

    const url = new URL("/v1/responses", this.baseUrl.endsWith("/v1") ? this.baseUrl.slice(0, -3) : this.baseUrl);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetcher(url.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildRequestBody(this.model, input))
      });
    } catch (error) {
      throw new ApiError({
        code: "network_error",
        provider: "openai",
        stage: "responses_create",
        message: "OpenAI Responses API request failed",
        details: error
      });
    }

    const body = await readJson(response);
    if (!response.ok) {
      throw mapHttpStatus({
        provider: "openai",
        stage: "responses_create",
        status: response.status,
        details: body
      });
    }

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError({
        code: "provider_schema_drift",
        provider: "openai",
        stage: "responses_parse",
        message: "OpenAI Responses API response schema drift",
        details: parsed.error.flatten()
      });
    }
    if (parsed.data.status !== "completed") {
      throw new ApiError({
        code: "provider_error",
        provider: "openai",
        stage: "responses_status",
        message: `OpenAI response did not complete: ${parsed.data.status}`,
        details: parsed.data.error
      });
    }

    const text = extractOutputText(parsed.data.output);
    let output: unknown;
    try {
      output = JSON.parse(text) as unknown;
    } catch (error) {
      throw new ApiError({
        code: "provider_schema_drift",
        provider: "openai",
        stage: "responses_output_parse",
        message: "OpenAI draft output is not valid JSON",
        details: error
      });
    }

    return {
      output,
      providerResponseId: parsed.data.id,
      usage: {
        inputTokens: parsed.data.usage?.input_tokens,
        outputTokens: parsed.data.usage?.output_tokens
      }
    };
  }
}

function buildRequestBody(model: string, input: ProductionDraftGenerationInput): Record<string, unknown> {
  return {
    model,
    store: false,
    instructions: [
      "You draft one natural X post for a single owned account.",
      "Use the account prompt and evidence. Do not invent facts beyond the supplied materials.",
      "The external post_text must read like a normal person, not a report, checklist, or test message.",
      "Prefer short no-link posts when the evidence supports them. Include links only when truly necessary, because links route to human review downstream.",
      "Return only JSON matching the schema."
    ].join("\n"),
    input: JSON.stringify(
      {
        requested_at: input.requestedAt,
        account: input.inputPackage.account,
        initial_prompt: input.prompt.prompt,
        topic: input.inputPackage.topic,
        materials: input.inputPackage.materials,
        recent_posts: input.inputPackage.recentPosts,
        memory: input.memory
          ? {
              captured_at: input.memory.capturedAt,
              outcome_counts: input.memory.outcomeCounts,
              lifetime_stats: input.memory.lifetimeStats,
              topic_memory: input.memory.topicMemory.slice(0, 5),
              recent_trace_hints: input.memory.traceSummaries.slice(0, 5),
              next_run_hints: input.memory.nextRunHints.slice(0, 10)
            }
          : undefined,
        guardrails: input.inputPackage.guardrails
      },
      null,
      2
    ),
    text: {
      format: {
        type: "json_schema",
        name: "ai_posting_draft_output_v1",
        strict: true,
        schema: draftOutputJsonSchema()
      }
    }
  };
}

function draftOutputJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["draft_id", "post_text", "urls", "topic_tags", "evidence_ids", "internal_notes"],
    properties: {
      draft_id: { type: "string", minLength: 1 },
      post_text: { type: "string", minLength: 1, maxLength: 25000 },
      urls: { type: "array", items: { type: "string" } },
      topic_tags: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
      evidence_ids: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
      internal_notes: { type: "string" }
    }
  };
}

function extractOutputText(output: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>): string {
  const texts = output.flatMap((item) => (item.content ?? []).filter((content) => content.type === "output_text" && content.text).map((content) => content.text ?? ""));
  const text = texts.join("\n").trim();
  if (!text) {
    throw new ApiError({
      code: "provider_schema_drift",
      provider: "openai",
      stage: "responses_output_text",
      message: "OpenAI response did not include output_text"
    });
  }
  return text;
}
