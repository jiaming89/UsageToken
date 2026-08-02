import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProductConfig } from "../types.js";

const DEFAULT_CONFIG: ProductConfig = {
  identity: {
    userId: "local-user",
    displayName: "Local User",
    role: "individual"
  },
  upload: {
    enabled: false,
    schedule: "daily"
  }
};

export async function readProductConfig(storeDir: string): Promise<ProductConfig> {
  const path = configPath(storeDir);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as ProductConfig;
    return {
      identity: {
        ...DEFAULT_CONFIG.identity,
        ...parsed.identity
      },
      upload: {
        ...DEFAULT_CONFIG.upload,
        ...parsed.upload
      }
    };
  } catch {
    await writeProductConfig(storeDir, DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
}

export async function writeProductConfig(storeDir: string, config: ProductConfig): Promise<void> {
  const path = configPath(storeDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function configPath(storeDir: string): string {
  return join(storeDir, "config.json");
}
