import type { CostMode, UsageRecord } from "../types.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface Pricing {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
  inputAbove200k?: number;
  outputAbove200k?: number;
  cacheCreateAbove200k?: number;
  cacheReadAbove200k?: number;
  longContextThreshold?: number;
  fastMultiplier?: number;
}

const DEFAULT_LONG_CONTEXT_THRESHOLD = 200_000;
const CACHE_CREATE_1H_INPUT_MULTIPLIER = 2;

const BUILTIN_PRICING: Record<string, Pricing> = {
  "claude-sonnet-4": { input: 3e-6, output: 15e-6, cacheCreate: 3.75e-6, cacheRead: 0.3e-6, fastMultiplier: 1 },
  "claude-opus-4": { input: 15e-6, output: 75e-6, cacheCreate: 18.75e-6, cacheRead: 1.5e-6, fastMultiplier: 1 },
  "gpt-5": { input: 1.25e-6, output: 10e-6, cacheCreate: 1.25e-6, cacheRead: 0.125e-6 },
  "gpt-5.1": { input: 1.25e-6, output: 10e-6, cacheCreate: 1.25e-6, cacheRead: 0.125e-6 },
  "gpt-5.1-codex": { input: 1.25e-6, output: 10e-6, cacheCreate: 1.25e-6, cacheRead: 0.125e-6 },
  "gpt-5.2": { input: 1.75e-6, output: 14e-6, cacheCreate: 1.75e-6, cacheRead: 0.175e-6 },
  "gpt-5.2-codex": { input: 1.75e-6, output: 14e-6, cacheCreate: 1.75e-6, cacheRead: 0.175e-6 },
  "gpt-5.3-codex": { input: 1.75e-6, output: 14e-6, cacheCreate: 1.75e-6, cacheRead: 0.175e-6, fastMultiplier: 2 },
  "gpt-5.4": { input: 2.5e-6, output: 15e-6, cacheCreate: 2.5e-6, cacheRead: 0.25e-6, inputAbove200k: 5e-6, outputAbove200k: 22.5e-6, cacheCreateAbove200k: 5e-6, cacheReadAbove200k: 0.5e-6, longContextThreshold: 272_000, fastMultiplier: 2 },
  "gpt-5.4-mini": { input: 0.75e-6, output: 4.5e-6, cacheCreate: 0.75e-6, cacheRead: 0.075e-6 },
  "gpt-5.4-nano": { input: 0.2e-6, output: 1.25e-6, cacheCreate: 0.2e-6, cacheRead: 0.02e-6 },
  "gpt-5.5": { input: 5e-6, output: 30e-6, cacheCreate: 5e-6, cacheRead: 0.5e-6, inputAbove200k: 10e-6, outputAbove200k: 45e-6, cacheCreateAbove200k: 10e-6, cacheReadAbove200k: 1e-6, longContextThreshold: 272_000, fastMultiplier: 2.5 },
  "gemini": { input: 1.25e-6, output: 5e-6, cacheCreate: 0, cacheRead: 0.3125e-6 },
  "qwen": { input: 0.4e-6, output: 1.6e-6, cacheCreate: 0, cacheRead: 0 },
  "kimi": { input: 0.6e-6, output: 2.5e-6, cacheCreate: 0, cacheRead: 0 },
  "moonshot/kimi-k2.5": { input: 0.6e-6, output: 3e-6, cacheCreate: 0.75e-6, cacheRead: 0.1e-6 },
  "moonshot/kimi-k2.6": { input: 0.95e-6, output: 4e-6, cacheCreate: 1.1875e-6, cacheRead: 0.16e-6 },
  "glm-4.5": { input: 0.6e-6, output: 2.2e-6, cacheCreate: 0, cacheRead: 0.11e-6 },
  "zai/glm-4.5": { input: 0.6e-6, output: 2.2e-6, cacheCreate: 0, cacheRead: 0.11e-6 },
  "glm-4.5-air": { input: 0.2e-6, output: 1.1e-6, cacheCreate: 0, cacheRead: 0.03e-6 },
  "glm-4.5-flash": { input: 0.6e-6, output: 2.2e-6, cacheCreate: 0, cacheRead: 0.11e-6 },
  "zai/glm-4.5-x": { input: 2.2e-6, output: 8.9e-6, cacheCreate: 0, cacheRead: 0.45e-6 },
  "zai/glm-4.5-air": { input: 0.2e-6, output: 1.1e-6, cacheCreate: 0, cacheRead: 0.03e-6 },
  "zai/glm-4.5-airx": { input: 1.1e-6, output: 4.5e-6, cacheCreate: 0, cacheRead: 0.22e-6 },
  "zai/glm-4.5v": { input: 0.6e-6, output: 1.8e-6, cacheCreate: 0, cacheRead: 0.11e-6 },
  "zai/glm-4.5-flash": { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
  "glm-4.6": { input: 0.6e-6, output: 2.2e-6, cacheCreate: 0, cacheRead: 0.11e-6 },
  "glm-4.7": { input: 0.6e-6, output: 2.2e-6, cacheCreate: 0, cacheRead: 0.11e-6 },
  "glm-5": { input: 1e-6, output: 3.2e-6, cacheCreate: 0, cacheRead: 0.2e-6 },
  "glm-5-turbo": { input: 1.2e-6, output: 4e-6, cacheCreate: 0, cacheRead: 0.24e-6 },
  "glm-5.1": { input: 1.4e-6, output: 4.4e-6, cacheCreate: 0, cacheRead: 0.26e-6 }
};

const PRICING: Record<string, Pricing> = { ...loadModelsDevPricing(), ...BUILTIN_PRICING };
const FAST_OVERRIDES = loadFastOverrides();

export function calculateRecordCost(record: UsageRecord, mode: CostMode): { cost: number; missingPricing: boolean } {
  if (mode === "display") {
    if (!displayModeCalculates(record)) {
      return { cost: record.costUSD ?? 0, missingPricing: false };
    }
    const pricing = findPricing(record.model);
    return { cost: pricing ? calculateFromPricing(record, pricing) : 0, missingPricing: false };
  }
  if (mode === "auto" && record.costUSD != null) {
    return { cost: record.costUSD, missingPricing: false };
  }
  const pricing = findPricing(record.model);
  if (!pricing) {
    const hasTokens = totalTokens(record) > 0;
    return { cost: 0, missingPricing: hasTokens && record.model != null };
  }
  return { cost: calculateFromPricing(record, pricing), missingPricing: false };
}

function displayModeCalculates(record: UsageRecord): boolean {
  return record.source === "codex" || record.source === "hermes";
}

export function totalTokens(record: UsageRecord): number {
  return record.inputTokens + record.outputTokens + record.cacheCreationTokens + record.cacheReadTokens + (record.extraTotalTokens ?? 0);
}

function findPricing(model?: string): Pricing | undefined {
  if (!model) {
    return undefined;
  }
  if (PRICING[model]) {
    return withFastOverride(model, PRICING[model]);
  }
  const found = Object.entries(PRICING).find(([candidate]) => pricingKeyMatchesModel(candidate, model));
  return found ? withFastOverride(model, found[1]) : undefined;
}

function pricingKeyMatchesModel(candidate: string, normalizedModel: string): boolean {
  const key = candidate;
  return containsPricingKey(normalizedModel, key)
    || containsPricingKey(key, normalizedModel)
    || containsPricingKey(normalizedPricingKey(normalizedModel), normalizedPricingKey(key))
    || containsPricingKey(normalizedPricingKey(key), normalizedPricingKey(normalizedModel));
}

function calculateFromPricing(record: UsageRecord, pricing: Pricing): number {
  const cacheCreate1h = Number(record.metadata?.cacheCreation1hTokens ?? 0);
  const cacheCreate5m = Math.max(0, record.cacheCreationTokens - cacheCreate1h);
  const outputBillableTokens = record.outputTokens + (record.extraTotalTokens ?? 0);
  const cacheCreate1hBase = pricing.input * CACHE_CREATE_1H_INPUT_MULTIPLIER;
  const cacheCreate1hAbove = pricing.inputAbove200k == null ? undefined : pricing.inputAbove200k * CACHE_CREATE_1H_INPUT_MULTIPLIER;

  let cost: number;
  if (pricing.longContextThreshold != null) {
    const longContext = record.inputTokens > pricing.longContextThreshold;
    const rate = (base: number, above?: number) => longContext ? (above ?? base) : base;
    cost = record.inputTokens * rate(pricing.input, pricing.inputAbove200k)
      + outputBillableTokens * rate(pricing.output, pricing.outputAbove200k)
      + cacheCreate5m * rate(pricing.cacheCreate, pricing.cacheCreateAbove200k)
      + cacheCreate1h * rate(cacheCreate1hBase, cacheCreate1hAbove)
      + record.cacheReadTokens * rate(pricing.cacheRead, pricing.cacheReadAbove200k);
  } else {
    cost = tieredCost(record.inputTokens, pricing.input, pricing.inputAbove200k)
      + tieredCost(outputBillableTokens, pricing.output, pricing.outputAbove200k)
      + tieredCost(cacheCreate5m, pricing.cacheCreate, pricing.cacheCreateAbove200k)
      + tieredCost(cacheCreate1h, cacheCreate1hBase, cacheCreate1hAbove)
      + tieredCost(record.cacheReadTokens, pricing.cacheRead, pricing.cacheReadAbove200k);
  }
  return cost * (isFastRecord(record) ? (pricing.fastMultiplier ?? 1) : 1);
}

function isFastRecord(record: UsageRecord): boolean {
  return record.metadata?.speed === "fast" || record.model?.endsWith("-fast") === true;
}

function containsPricingKey(value: string, key: string): boolean {
  let index = value.indexOf(key);
  while (index >= 0) {
    const before = index > 0 ? value.charCodeAt(index - 1) : undefined;
    const suffix = value.slice(index + key.length);
    if ((before == null || isPricingBoundary(before)) && suffixAllowsPricingKeyMatch(key, suffix)) {
      return true;
    }
    index = value.indexOf(key, index + 1);
  }
  return false;
}

function suffixAllowsPricingKeyMatch(key: string, suffix: string): boolean {
  if (suffix.length === 0) return true;
  const separator = suffix.charCodeAt(0);
  if (!isPricingBoundary(separator)) return false;
  if (!/\d$/u.test(key) || !["-", "."].includes(suffix[0] ?? "")) return true;
  const match = /^[-.](\d+)(.*)$/u.exec(suffix);
  if (!match) return true;
  const digits = match[1] ?? "";
  const rest = match[2] ?? "";
  return digits.length === 8 && (rest.length === 0 || isPricingBoundary(rest.charCodeAt(0)));
}

function isPricingBoundary(code: number): boolean {
  return !((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122));
}

function normalizedPricingKey(value: string): string {
  return value.replace(/[.@]/gu, "-");
}

function tieredCost(tokens: number, base: number, above?: number): number {
  if (tokens <= 0) {
    return 0;
  }
  if (above != null && tokens > DEFAULT_LONG_CONTEXT_THRESHOLD) {
    return DEFAULT_LONG_CONTEXT_THRESHOLD * base + (tokens - DEFAULT_LONG_CONTEXT_THRESHOLD) * above;
  }
  return tokens * base;
}

function loadModelsDevPricing(): Record<string, Pricing> {
  const raw = readAssetJson("models-dev-pricing.json");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, Pricing> = {};
  for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
    const cost = objectValue(objectValue(value).cost);
    const pricing = pricingFromCost(cost);
    if (pricing) {
      out[model] = pricing;
    }
  }
  return out;
}

function pricingFromCost(cost: Record<string, unknown>): Pricing | undefined {
  const input = numberValue(cost.input);
  const output = numberValue(cost.output);
  if (input == null || output == null) {
    return undefined;
  }
  return {
    input: input / 1_000_000,
    output: output / 1_000_000,
    cacheCreate: (numberValue(cost.cache_write) ?? numberValue(cost.cache_creation) ?? input) / 1_000_000,
    cacheRead: (numberValue(cost.cache_read) ?? 0) / 1_000_000
  };
}

function loadFastOverrides(): { exact: Record<string, number>; normalizedPrefix: Record<string, number> } {
  const raw = readAssetJson("fast-multiplier-overrides.json");
  const value = objectValue(raw);
  return {
    exact: numberRecord(objectValue(value.exact)),
    normalizedPrefix: numberRecord(objectValue(value.normalized_prefix))
  };
}

function withFastOverride(model: string, pricing: Pricing): Pricing {
  const exact = FAST_OVERRIDES.exact[model];
  if (exact != null) return { ...pricing, fastMultiplier: exact };
  const normalized = modelWithoutDateSuffix(model.toLowerCase());
  for (const [prefix, multiplier] of Object.entries(FAST_OVERRIDES.normalizedPrefix)) {
    if (normalized.startsWith(prefix)) return { ...pricing, fastMultiplier: multiplier };
  }
  return pricing;
}

function modelWithoutDateSuffix(model: string): string {
  return model.replace(/-\d{8}$/u, "");
}

function readAssetJson(name: string): unknown {
  const dir = dirname(fileURLToPath(import.meta.url));
  for (const path of [join(dir, "assets", name), join(dir, "..", "..", "src", "core", "assets", name)]) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      // Try the next build/source location.
    }
  }
  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberRecord(value: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const number = numberValue(raw);
    if (number != null) out[key] = number;
  }
  return out;
}
