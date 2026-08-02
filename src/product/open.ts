import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export async function openInBrowser(targetPath: string): Promise<void> {
  if (process.env.USAGETOKEN_NO_OPEN === "1") {
    return;
  }
  const target = pathToFileURL(targetPath).href;
  const child = process.platform === "win32"
    ? spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" })
    : process.platform === "darwin"
      ? spawn("open", [target], { detached: true, stdio: "ignore" })
      : spawn("xdg-open", [target], { detached: true, stdio: "ignore" });
  child.unref();
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => resolve());
  });
}
