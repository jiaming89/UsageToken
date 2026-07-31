import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DetectionResult, LoadContext, RuntimeContext, UsageRecord, UsageSource } from "../types.js";
import { collectFiles, envPaths, existsDir, projectFromClaudePath, sessionFromPath } from "./fs.js";
import { parseGenericUsage } from "./generic.js";

export class ClaudeSource implements UsageSource {
  readonly name = "claude";

  async detect(ctx: RuntimeContext): Promise<DetectionResult> {
    const paths = await this.paths(ctx);
    return { detected: paths.length > 0, paths };
  }

  async load(ctx: LoadContext): Promise<UsageRecord[]> {
    const roots = await this.paths(ctx);
    const records: UsageRecord[] = [];
    for (const root of roots) {
      const projectsRoot = root.endsWith("/projects") ? root : join(root, "projects");
      for (const file of await collectFiles(projectsRoot, [".jsonl"])) {
        const session = sessionFromPath(projectsRoot, file);
        session.projectPath = session.projectPath ?? projectFromClaudePath(file);
        for (const raw of await readClaudeJsonRecords(file)) {
          const record = parseGenericUsage(this.name, raw, session);
          if (record) {
            records.push(record);
          }
        }
      }
    }
    return dedupeClaude(records);
  }

  private async paths(ctx: RuntimeContext): Promise<string[]> {
    const candidates = envPaths(ctx.env.CLAUDE_CONFIG_DIR);
    if (candidates.length === 0) {
      candidates.push(join(ctx.homeDir, ".config", "claude"), join(ctx.homeDir, ".claude"));
    }
    const found: string[] = [];
    for (const raw of candidates) {
      const path = raw.endsWith("/projects") ? raw.slice(0, -"/projects".length) : raw;
      if (await existsDir(join(path, "projects"))) {
        found.push(path);
      }
    }
    return [...new Set(found)];
  }
}

async function readClaudeJsonRecords(file: string): Promise<unknown[]> {
  const content = await readFile(file, "utf8").catch(() => "");
  if (!content) return [];
  return content.split(/\r?\n/u).flatMap((line) => {
    if (!line.includes("\"usage\":{") || hasUnsupportedNullField(line)) {
      return [];
    }
    try {
      return [JSON.parse(line) as unknown];
    } catch {
      return [];
    }
  });
}

function hasUnsupportedNullField(line: string): boolean {
  return [
    "id",
    "cwd",
    "model",
    "speed",
    "costUSD",
    "version",
    "sessionId",
    "requestId",
    "isApiErrorMessage",
    "cache_read_input_tokens",
    "cache_creation_input_tokens"
  ].some((field) => line.includes(`"${field}":null`));
}

function dedupeClaude(records: UsageRecord[]): UsageRecord[] {
  const out: UsageRecord[] = [];
  const exactIndexes = new Map<string, number>();
  const messageIndexes = new Map<string, number[]>();
  for (const record of records) {
    const messageId = record.messageId;
    if (!messageId) {
      out.push(record);
      continue;
    }
    const exactKey = claudeDedupeKey(messageId, record.requestId);
    const exactIndex = exactIndexes.get(exactKey);
    const sidechainIndex = exactIndex == null ? sidechainDuplicateIndex(out, messageIndexes.get(messageId), record) : undefined;
    const existingIndex = exactIndex ?? sidechainIndex;
    if (existingIndex != null) {
      if (shouldReplace(record, out[existingIndex] as UsageRecord)) {
        out[existingIndex] = record;
      }
      exactIndexes.set(exactKey, existingIndex);
      addMessageIndex(messageIndexes, messageId, existingIndex);
      continue;
    }
    const index = out.length;
    out.push(record);
    exactIndexes.set(exactKey, index);
    addMessageIndex(messageIndexes, messageId, index);
  }
  return out;
}

function claudeDedupeKey(messageId: string, requestId: string | undefined): string {
  return `${messageId}\0${requestId ?? ""}`;
}

function sidechainDuplicateIndex(records: UsageRecord[], indexes: number[] | undefined, candidate: UsageRecord): number | undefined {
  if (!indexes) return undefined;
  const candidateIsSidechain = candidate.sourceMetadata?.isSidechain === true;
  return indexes.find((index) => {
    const existing = records[index];
    return existing?.messageId === candidate.messageId && (candidateIsSidechain || existing.sourceMetadata?.isSidechain === true);
  });
}

function shouldReplace(candidate: UsageRecord, existing: UsageRecord): boolean {
  const candidateIsSidechain = candidate.sourceMetadata?.isSidechain === true;
  const existingIsSidechain = existing.sourceMetadata?.isSidechain === true;
  if (candidateIsSidechain !== existingIsSidechain) {
    return existingIsSidechain;
  }
  const candidateTotal = usageTokenTotal(candidate);
  const existingTotal = usageTokenTotal(existing);
  if (candidateTotal !== existingTotal) {
    return candidateTotal > existingTotal;
  }
  return Boolean(candidate.metadata?.speed) && !existing.metadata?.speed;
}

function usageTokenTotal(record: UsageRecord): number {
  return record.inputTokens + record.outputTokens + record.cacheCreationTokens + record.cacheReadTokens;
}

function addMessageIndex(map: Map<string, number[]>, messageId: string, index: number): void {
  const indexes = map.get(messageId);
  if (!indexes) {
    map.set(messageId, [index]);
  } else if (!indexes.includes(index)) {
    indexes.push(index);
  }
}
