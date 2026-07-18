/**
 * Antigravity Pro fallback behavior. The rejected `gemini-3.1-pro-high` discovery id is no
 * longer public and has no fallback chain; the callable High id is `gemini-pro-agent`.
 * Pro Low retains its bounded request-time fallback for older upstream versions.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  ANTIGRAVITY_PRO_FALLBACK_CHAINS,
  getAntigravityModelFallbacks,
} from "../../open-sse/config/antigravityModelAliases.ts";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.ts";
import { seedAntigravityIdeVersionCache } from "../../open-sse/services/antigravityVersion.ts";

type ChatCompletionPayload = {
  object?: string;
  choices: Array<{ message: { content: string }; finish_reason: string }>;
};

type ErrorPayload = {
  error: { code?: string; message: string };
};

// ---------------------------------------------------------------------------
// Pure helper: getAntigravityModelFallbacks
// ---------------------------------------------------------------------------

test("rejected pro-high discovery id has no fallback chain", () => {
  assert.deepEqual(getAntigravityModelFallbacks("gemini-3.1-pro-high"), []);
});

test("(#3786) getAntigravityModelFallbacks returns the ordered pro-low chain", () => {
  assert.deepEqual(getAntigravityModelFallbacks("gemini-3.1-pro-low"), [
    "gemini-3.1-pro-low",
    "gemini-3-pro-low",
  ]);
});

test("(#3786) getAntigravityModelFallbacks returns [] for unrelated models", () => {
  assert.deepEqual(getAntigravityModelFallbacks("gemini-2.5-flash"), []);
  assert.deepEqual(getAntigravityModelFallbacks("claude-sonnet-4-6"), []);
  assert.deepEqual(getAntigravityModelFallbacks("gemini-3-pro-preview"), []);
  assert.deepEqual(getAntigravityModelFallbacks(""), []);
});

test("(#3786) every chain starts with its own key (each candidate listed once)", () => {
  for (const [key, chain] of Object.entries(ANTIGRAVITY_PRO_FALLBACK_CHAINS)) {
    assert.equal(chain[0], key, `chain for ${key} must start with itself`);
    assert.equal(new Set(chain).size, chain.length, `chain for ${key} must have no duplicates`);
  }
});

// ---------------------------------------------------------------------------
// Behavioral: executor retries the next candidate on a 400
// ---------------------------------------------------------------------------

function makeSuccessSSE(): Response {
  return new Response(
    'data: {"response":{"candidates":[{"content":{"parts":[{"text":"OK"}]},"finishReason":"STOP"}]}}\n\n',
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );
}

function make400(modelId: string): Response {
  return new Response(
    JSON.stringify({ error: { code: 400, message: `Model not found: ${modelId}` } }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );
}

/** Extract the upstream model id from the serialized request envelope. */
function envelopeModel(init: RequestInit | undefined): string {
  try {
    return JSON.parse(String(init?.body)).model as string;
  } catch {
    return "";
  }
}

test("execute retries pro-low with the next candidate when the first id 400s", async () => {
  const executor = new AntigravityExecutor();
  const originalFetch = globalThis.fetch;
  seedAntigravityIdeVersionCache("2.1.1");
  const modelsTried: string[] = [];

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const m = envelopeModel(init);
    modelsTried.push(m);
    if (m === "gemini-3.1-pro-low") return make400(m);
    return makeSuccessSSE();
  }) as typeof fetch;

  try {
    const result = await executor.execute({
      model: "antigravity/gemini-3.1-pro-low",
      body: { request: { contents: [] } },
      stream: false,
      credentials: { accessToken: "token", projectId: "project-1" },
      log: { debug() {}, warn() {}, info() {} },
    });
    const payload = (await result.response.json()) as ChatCompletionPayload;

    assert.equal(result.response.status, 200, "second candidate should succeed");
    assert.equal(payload.choices[0].message.content, "OK");
    // Exactly two upstream calls: the 400 then the 200 on the next id.
    assert.deepEqual(modelsTried, ["gemini-3.1-pro-low", "gemini-3-pro-low"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("execute exhausts the pro-low chain on all-400 and surfaces a sanitized 400", async () => {
  const executor = new AntigravityExecutor();
  const originalFetch = globalThis.fetch;
  seedAntigravityIdeVersionCache("2.1.1");
  const modelsTried: string[] = [];

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const m = envelopeModel(init);
    modelsTried.push(m);
    return make400(m); // every candidate fails with 400
  }) as typeof fetch;

  try {
    const result = await executor.execute({
      model: "antigravity/gemini-3.1-pro-low",
      body: { request: { contents: [] } },
      stream: false,
      credentials: { accessToken: "token", projectId: "project-1" },
      log: { debug() {}, warn() {}, info() {} },
    });
    const payload = (await result.response.json()) as ErrorPayload;

    // Surfaces a real, sanitized 400 — not a masked empty chat.completion.
    assert.equal(result.response.status, 400);
    assert.ok(payload.error, "must carry an error object");
    assert.equal(typeof payload.error.message, "string");
    assert.ok(!payload.error.message.includes("at /"), "no raw stack trace (hard rule #12)");

    // Each candidate tried EXACTLY once (bounded — no infinite loop).
    assert.deepEqual(modelsTried, ["gemini-3.1-pro-low", "gemini-3-pro-low"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pro-low happy path makes exactly one upstream call", async () => {
  const executor = new AntigravityExecutor();
  const originalFetch = globalThis.fetch;
  seedAntigravityIdeVersionCache("2.1.1");
  const modelsTried: string[] = [];

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    modelsTried.push(envelopeModel(init));
    return makeSuccessSSE();
  }) as typeof fetch;

  try {
    const result = await executor.execute({
      model: "antigravity/gemini-3.1-pro-low",
      body: { request: { contents: [] } },
      stream: false,
      credentials: { accessToken: "token", projectId: "project-1" },
      log: { debug() {}, warn() {}, info() {} },
    });

    assert.equal(result.response.status, 200);
    assert.deepEqual(modelsTried, ["gemini-3.1-pro-low"], "exactly one call on the happy path");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("(#3786) a non-pro model that 400s does NOT trigger the fallback chain", async () => {
  const executor = new AntigravityExecutor();
  const originalFetch = globalThis.fetch;
  seedAntigravityIdeVersionCache("2.1.1");
  const modelsTried: string[] = [];

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    modelsTried.push(envelopeModel(init));
    return make400(envelopeModel(init));
  }) as typeof fetch;

  try {
    const result = await executor.execute({
      model: "antigravity/gemini-2.5-flash",
      body: { request: { contents: [] } },
      stream: false,
      credentials: { accessToken: "token", projectId: "project-1" },
      log: { debug() {}, warn() {}, info() {} },
    });

    // flash 400 surfaces directly — only the requested id is tried, no chain.
    assert.equal(result.response.status, 400);
    assert.deepEqual(modelsTried, ["gemini-2.5-flash"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
