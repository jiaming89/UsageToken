export const PACKAGE_NAME = "usagetoken";
export const PACKAGE_VERSION = "0.1.9";

const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

export async function checkForUpdate(fetcher: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const response = await fetcher(REGISTRY_URL, { signal: AbortSignal.timeout(2500) });
    const payload = await response.json() as { version?: unknown };
    return typeof payload.version === "string" && isNewerVersion(payload.version, PACKAGE_VERSION) ? payload.version : undefined;
  } catch {
    return undefined;
  }
}

function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== installed[index]) return (next[index] as number) > (installed[index] as number);
  }
  return false;
}

function parseVersion(value: string): number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  return match ? match.slice(1).map(Number) : undefined;
}
