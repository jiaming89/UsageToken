import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";

export async function existsDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function collectFiles(root: string, extensions = [".jsonl", ".json"]): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && extensions.includes(extname(entry.name))) {
        out.push(path);
      }
    }
  }
  await visit(root);
  return out.sort();
}

export async function readJsonRecords(path: string): Promise<unknown[]> {
  const content = await readFile(path, "utf8").catch(() => "");
  if (!content.trim()) {
    return [];
  }
  if (extname(path) === ".jsonl") {
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as unknown];
        } catch {
          return [];
        }
      });
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

export function projectFromClaudePath(file: string): string | undefined {
  const parts = file.split(/[\\/]/);
  const index = parts.lastIndexOf("projects");
  return index >= 0 ? parts[index + 1] : undefined;
}

export function sessionFromPath(root: string, file: string): { sessionId?: string; projectPath?: string } {
  const rel = relative(root, file);
  const parts = rel.split(/[\\/]/).filter(Boolean);
  const fileName = basename(file).replace(/\.(jsonl|json)$/u, "");
  if (parts.length >= 2) {
    return { sessionId: fileName, projectPath: parts.slice(0, -1).join("/") };
  }
  return { sessionId: fileName, projectPath: undefined };
}

export function envPaths(value: string | undefined): string[] {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}
