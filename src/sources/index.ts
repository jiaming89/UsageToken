import { join } from "node:path";
import type { UsageSource } from "../types.js";
import { ClaudeSource } from "./claude.js";
import { CodexSource } from "./codex.js";
import { CopilotSource } from "./copilot.js";
import { defaultSourcePath, GenericJsonUsageSource } from "./generic.js";
import { parseAmp, parseCodebuff, parseDroid, parseGeminiLike, parseKimi, parseOpenClaw } from "./parsers.js";
import { AntigravitySource, GooseSource, HermesSource, KiloSource, OpenCodeSource } from "./sqliteSources.js";

export const sources: UsageSource[] = [
  new ClaudeSource(),
  new CodexSource(),
  new OpenCodeSource(),
  generic("amp", "AMP_DATA_DIR", (home) => defaultSourcePath(home, ".local", "share", "amp"), { parser: parseAmp, extensions: [".json"] }),
  generic("droid", "DROID_SESSIONS_DIR", (home) => defaultSourcePath(home, ".factory", "sessions"), {
    parser: parseDroid,
    extensions: [".json"],
    fileFilter: (path) => path.endsWith(".settings.json")
  }),
  generic("codebuff", "CODEBUFF_DATA_DIR", codebuffRoots, {
    parser: parseCodebuff,
    extensions: [".json"],
    fileFilter: (path) => path.endsWith("chat-messages.json")
  }),
  new HermesSource(),
  generic("pi", "PI_AGENT_DIR", (home) => defaultSourcePath(home, ".pi", "agent", "sessions")),
  new GooseSource(),
  generic("openclaw", "OPENCLAW_DIR", (home) => [
    join(home, ".openclaw"),
    join(home, ".clawdbot"),
    join(home, ".moltbot"),
    join(home, ".moldbot")
  ], {
    parser: parseOpenClaw,
    fileFilter: (path) => /\.jsonl($|\.deleted\.|\.reset\.)/u.test(path)
  }),
  new KiloSource(),
  new CopilotSource(),
  generic("gemini", "GEMINI_DATA_DIR", (home) => defaultSourcePath(home, ".gemini", "tmp"), { parser: parseGeminiLike }),
  generic("kimi", "KIMI_DATA_DIR", (home) => [join(home, ".kimi"), join(home, ".kimi-code")], {
    parser: parseKimi,
    extensions: [".jsonl"],
    fileFilter: (path) => path.endsWith("wire.jsonl")
  }),
  generic("qwen", "QWEN_DATA_DIR", (home) => defaultSourcePath(home, ".qwen"), {
    parser: parseGeminiLike,
    extensions: [".jsonl"],
    fileFilter: (path) => /[\\/]projects[\\/][^\\/]+[\\/]chats[\\/][^\\/]+\.jsonl$/u.test(path)
  }),
  new AntigravitySource()
];

function generic(name: string, envVar: string, defaultPaths: (home: string) => string[], extra: Partial<ConstructorParameters<typeof GenericJsonUsageSource>[0]> = {}): UsageSource {
  return new GenericJsonUsageSource({ name, envVar, defaultPaths, ...extra });
}

function codebuffRoots(home: string): string[] {
  return ["manicode", "manicode-dev", "manicode-staging"].map((channel) => join(home, ".config", channel, "projects"));
}
