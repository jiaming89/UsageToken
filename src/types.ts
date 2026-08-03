export type ReportKind = "daily" | "weekly" | "monthly" | "session" | "blocks";
export type ProductCommand = "sync" | "dashboard" | "upload-daily" | "serve" | "cc" | "utoken";
export type CliCommand = ReportKind | ProductCommand;

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
  command: CliCommand;
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
  htmlFile?: string;
  html?: boolean;
  port?: number;
  host?: string;
  storeDir?: string;
  serverMode?: "local" | "team" | "org";
  endpoint?: string;
}

export interface UserIdentity {
  userId: string;
  displayName: string;
  teamId?: string;
  teamName?: string;
  orgId?: string;
  orgName?: string;
  role: "individual" | "lead" | "executive";
}

export interface UploadSettings {
  enabled: boolean;
  endpoint?: string;
  apiKey?: string;
  schedule: "daily";
}

export interface ProductConfig {
  identity: UserIdentity;
  upload: UploadSettings;
}

export interface SessionSummaryRecord {
  source: string;
  sessionId: string;
  period: string;
  projectPath?: string;
  firstActivity?: string;
  lastActivity?: string;
  agents: string[];
  modelsUsed: string[];
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  extraTotalTokens: number;
  totalCost: number;
  messageCount: number;
  credits: number;
}

export interface DailyUserSummary {
  date: string;
  identity: UserIdentity;
  agents: string[];
  modelsUsed: string[];
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  extraTotalTokens: number;
  totalTokens: number;
  totalCost: number;
  credits: number;
  messageCount: number;
  sourceBreakdown: Array<{
    source: string;
    totalTokens: number;
    totalCost: number;
    messageCount: number;
  }>;
  modelBreakdown: Array<{
    model: string;
    totalTokens: number;
    totalCost: number;
    messageCount: number;
  }>;
  projectBreakdown: Array<{
    projectPath: string;
    totalTokens: number;
    totalCost: number;
    messageCount: number;
  }>;
}

export interface UploadBatch {
  batchId: string;
  uploadedAt: string;
  identity: UserIdentity;
  summaries: DailyUserSummary[];
}

export interface TeamDailySummary {
  date: string;
  teamId: string;
  teamName: string;
  users: Array<{
    userId: string;
    displayName: string;
    totalTokens: number;
    totalCost: number;
    messageCount: number;
  }>;
  totalTokens: number;
  totalCost: number;
  messageCount: number;
}

export interface OrgDailySummary {
  date: string;
  orgId: string;
  orgName: string;
  teams: Array<{
    teamId: string;
    teamName: string;
    totalTokens: number;
    totalCost: number;
    messageCount: number;
  }>;
  totalTokens: number;
  totalCost: number;
  messageCount: number;
}

export interface LocalWarehouse {
  schemaVersion: 1;
  generatedAt: string;
  config: ProductConfig;
  usageRecords: UsageRecord[];
  sessionSummaries: SessionSummaryRecord[];
  dailyUserSummaries: DailyUserSummary[];
}
