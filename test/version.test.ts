import assert from "node:assert/strict";
import test from "node:test";
import { checkForUpdate } from "../src/version.js";

function response(version: unknown): Response {
  return { json: async () => ({ version }) } as Response;
}

test("update check returns only newer stable npm versions", async () => {
  assert.equal(await checkForUpdate(async () => response("0.4.1")), "0.4.1");
  assert.equal(await checkForUpdate(async () => response("0.4.0")), undefined);
  assert.equal(await checkForUpdate(async () => response("0.5.0-beta.1")), undefined);
});

test("update check ignores registry failures", async () => {
  assert.equal(await checkForUpdate(async () => { throw new Error("offline"); }), undefined);
});
