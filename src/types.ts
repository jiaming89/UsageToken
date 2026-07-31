export type ReportKind = "daily" | "weekly" | "monthly" | "session" | "blocks";

export type CostMode = "auto" | "display" | "calculate";

export interface RuntimeContext {
  env: NodeJS.ProcessEnv;
  cwd: string;
  homeDir: string;
}

export interface LoadContext extends RuntimeContext {
  since?: string;
  until?: string;
  timezone?: string;
  mode: CostMode;
  offline: boolean;
}

export interface DetectionResult {
  detected: boolean;
  paths: string[];
}

export interface UsageSource {
  name: string;
  detect(ctx: RuntimeContext): Promise<DetectionResult>;
  load(ctx: LoadContext): Promise<UsageRecord[]>;
}

export interface UsageRecord {
  source: string;
  timestamp: string;
  messageId?: string;
  requestId?: string;
  sessionId?: string;
  projectPath?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  extraTotalTokens?: number;
  costUSD?: number;
  credits?: number;
  messageCount?: number;
  missingPricingModel?: string;
  versions?: string[];
  sourceMetadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ModelBreakdown {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  extraTotalTokens: number;
  cost: number;
  credits: number;
  messageCount: number;
  missingPricing?: boolean;
}

export interface UsageSummary {
  period: string;
  agents: string[];
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  extraTotalTokens: number;
  totalCost: number;
  credits: number;
  messageCount: number;
  modelsUsed: string[];
  modelBreakdowns: ModelBreakdown[];
  sourceBreakdowns?: UsageSummary[];
  source?: string;
  sessionId?: string;
  projectPath?: string;
  firstActivity?: string;
  lastActivity?: string;
  reasoningOutputTokens?: number;
}

export interface CliOptions {
  command: ReportKind;
  json: boolean;
  since?: string;
  until?: string;
  timezone?: string;
  mode: CostMode;
  offline: boolean;
  noCost: boolean;
  uploadFile?: string;
  source?: string;
  bySource?: boolean;
}
