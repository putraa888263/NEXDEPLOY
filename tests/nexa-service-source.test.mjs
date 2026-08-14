import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("NEXA service API is typed, approval-bound, idempotent, dispatches executor and has no arbitrary command", async () => {
  const source = await readFile(new URL("../app/api/nexa/v1/route.ts", import.meta.url), "utf8");
  assert.match(source, /approved_typed_proposal_required/);
  assert.match(source, /idempotency_key_required/);
  assert.match(source, /arbitrary_command:\s*false/);
  assert.match(source, /processDeployment\(/);
  assert.match(source, /syncExecutorDeployment\(/);
  assert.match(source, /rollback_release_unavailable/);
  assert.match(source, /typed_executor_dispatched/);
  assert.doesNotMatch(source, /body\.command|spawn\(|exec\(/);
});
