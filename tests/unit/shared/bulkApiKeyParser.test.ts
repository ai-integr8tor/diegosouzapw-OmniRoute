import test from "node:test";
import assert from "node:assert/strict";
import { parseBulkApiKeys } from "@/shared/utils/bulkApiKeyParser";

test("parseBulkApiKeys accepts bare keys and name|apiKey rows", () => {
  const result = parseBulkApiKeys("sk-one\nname-two|sk-two");

  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map((entry) => entry.name), ["Key 1", "name-two"]);
  assert.deepEqual(result.entries.map((entry) => entry.apiKey), ["sk-one", "sk-two"]);
  assert.deepEqual(result.warnings, []);
});

test("parseBulkApiKeys trims whitespace and skips blank lines", () => {
  const result = parseBulkApiKeys("  sk-one  \r\n\n  name-two |  sk-two  \r\n");

  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map((entry) => entry.name), ["Key 1", "name-two"]);
  assert.deepEqual(result.entries.map((entry) => entry.apiKey), ["sk-one", "sk-two"]);
});

test("parseBulkApiKeys preserves line order across multiple rows", () => {
  const result = parseBulkApiKeys("sk-1\nsk-2\nsk-3");

  assert.equal(result.entries.length, 3);
  assert.deepEqual(result.entries.map((entry) => entry.lineNumber), [1, 2, 3]);
});
