import { mkdir, copyFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

await runTypeScript();
await copyAssets();

async function runTypeScript() {
  const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsc, "-p", "tsconfig.json"], {
      cwd: root,
      stdio: "inherit",
      shell: false
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`tsc exited with ${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
}

async function copyAssets() {
  const assets = ["models-dev-pricing.json", "fast-multiplier-overrides.json"];
  for (const name of assets) {
    const from = join(root, "src", "core", "assets", name);
    const to = join(root, "dist", "src", "core", "assets", name);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }
}
