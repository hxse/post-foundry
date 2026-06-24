import type { AccountInitialPrompt } from "../accounts/account-prompt";
import type { AccountMemorySnapshot } from "../memory/account-memory";
import type { DraftRunInputPackage } from "../drafts/ai-posting-pipeline";

export type ProductionDraftGenerationInput = {
  inputPackage: DraftRunInputPackage;
  prompt: AccountInitialPrompt;
  memory?: AccountMemorySnapshot;
  requestedAt: string;
};

export type ProductionDraftGenerationUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type ProductionDraftGenerationResult = {
  output: unknown;
  usage?: ProductionDraftGenerationUsage;
  providerResponseId?: string;
};

export type ProductionDraftGenerator = {
  providerName: string;
  model: string;
  generateDraft(input: ProductionDraftGenerationInput): Promise<ProductionDraftGenerationResult>;
};
