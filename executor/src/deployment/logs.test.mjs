import test from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeLogMessage,
} from "./logs.mjs";

test("sanitizeLogMessage redacts Laravel and database secrets", () => {
  const output = sanitizeLogMessage(
    'APP_KEY=base64:secret DB_PASSWORD="super-secret" API_KEY=sk-test-12345678',
  );

  assert.equal(
    output.includes("base64:secret"),
    false,
  );

  assert.equal(
    output.includes("super-secret"),
    false,
  );

  assert.equal(
    output.includes("sk-test-12345678"),
    false,
  );

  assert.match(
    output,
    /APP_KEY=\[REDACTED\]/,
  );

  assert.match(
    output,
    /DB_PASSWORD=\[REDACTED\]/,
  );

  assert.match(
    output,
    /API_KEY=\[REDACTED\]/,
  );
});

test("sanitizeLogMessage redacts bearer authorization", () => {
  const output = sanitizeLogMessage(
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret.signature",
  );

  assert.equal(
    output,
    "Authorization: Bearer [REDACTED]",
  );
});

test("sanitizeLogMessage redacts JSON-like secrets", () => {
  const output = sanitizeLogMessage(
    '{"password":"very-secret","token":"abcdefgh12345678"}',
  );

  assert.equal(
    output.includes("very-secret"),
    false,
  );

  assert.equal(
    output.includes("abcdefgh12345678"),
    false,
  );
});

test("sanitizeLogMessage keeps normal deployment diagnostics", () => {
  const input =
    "Composer install gagal: package vendor/demo tidak ditemukan.";

  assert.equal(
    sanitizeLogMessage(input),
    input,
  );
});
