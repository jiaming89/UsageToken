import assert from "node:assert/strict";
import test from "node:test";
import { checkForUpdate } from "../src/version.js";

function response(version: unknown): Response {
  return { json: async () => ({ version }) } as Response;
}

test("update check returns only newer stable npm versions", async () => {
  assert.equal(await checkForUpdate(async () => response("0.1.10")), "0.1.10");
  assert.equal(await checkForUpdate(async () => response("0.1.9")), undefined);
  assert.equal(await checkForUpdate(async () => response("0.2.0-beta.1")), undefined);
});

test("update check ignores registry failures", async () => {
  assert.equal(await checkForUpdate(async () => { throw new Error("offline"); }), undefined);
});
