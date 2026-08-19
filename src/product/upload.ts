import { request } from "node:http";
import { request as requestTls } from "node:https";
import type { UploadBatch } from "../types.js";

export async function postDailyBatch(endpoint: string, batch: UploadBatch, apiKey?: string): Promise<{ accepted: boolean; duplicate: boolean }> {
  const url = new URL(endpoint);
  const body = JSON.stringify(batch);
  const transport = url.protocol === "https:" ? requestTls : request;
  return await new Promise((resolve, reject) => {
    const req = transport(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(text || `Upload failed with ${res.statusCode}`));
            return;
          }
          resolve(JSON.parse(text) as { accepted: boolean; duplicate: boolean });
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
