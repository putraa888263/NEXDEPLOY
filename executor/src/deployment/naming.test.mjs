import assert from "node:assert/strict";
import test from "node:test";

import { safeSlug, containerName, networkName, imageName, label } from "./naming.mjs";

test("safeSlug: lowercases and hyphenates a normal project name", () => {
  assert.equal(safeSlug("NEXA AI Control Center"), "nexa-ai-control-center");
});

test("safeSlug: collapses repeated separators and trims edges", () => {
  assert.equal(safeSlug("  My   App!! "), "my-app");
});

test("safeSlug: rejects path traversal", () => {
  assert.equal(safeSlug("../../etc/passwd"), null);
  assert.equal(safeSlug("foo/../bar"), null);
});

test("safeSlug: rejects path separators", () => {
  assert.equal(safeSlug("foo/bar"), null);
  assert.equal(safeSlug("foo\\bar"), null);
});

test("safeSlug: rejects control characters and newlines", () => {
  assert.equal(safeSlug("foo\nbar"), null);
  assert.equal(safeSlug("foo\0bar"), null);
});

test("safeSlug: rejects empty or whitespace-only input", () => {
  assert.equal(safeSlug(""), null);
  assert.equal(safeSlug("   "), null);
  assert.equal(safeSlug("---"), null);
});

test("safeSlug: rejects non-string input", () => {
  assert.equal(safeSlug(null), null);
  assert.equal(safeSlug(undefined), null);
  assert.equal(safeSlug(42), null);
});

test("safeSlug: enforces a maximum length", () => {
  const slug = safeSlug("a".repeat(200));
  assert.ok(slug.length <= 40);
});

test("safeSlug: shell metacharacters are stripped, not passed through", () => {
  const slug = safeSlug("app; rm -rf / #");
  assert.ok(slug === null || /^[a-z0-9-]+$/.test(slug));
});

test("Docker resource naming is deterministic and namespaced", () => {
  assert.equal(containerName("my-app"), "nexdeploy-my-app-app");
  assert.equal(networkName("my-app"), "nexdeploy-my-app-network");
  assert.equal(imageName("my-app", "abc123"), "nexdeploy/my-app:abc123");
});

test("imageName falls back to a safe default tag", () => {
  assert.equal(imageName("my-app", undefined), "nexdeploy/my-app:release");
  assert.equal(imageName("my-app", "../escape"), "nexdeploy/my-app:release");
});

test("label produces a plain string usable directly by docker.mjs", () => {
  assert.equal(label("project", "my-app"), "nexdeploy.project=my-app");
});
