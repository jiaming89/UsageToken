import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ReportKind } from "./types.js";

export async function writeUploadFile(path: string, command: ReportKind, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({
      tool: "usagetoken",
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      command,
      payload
    }, null, 2)}\n`,
    "utf8"
  );
}
