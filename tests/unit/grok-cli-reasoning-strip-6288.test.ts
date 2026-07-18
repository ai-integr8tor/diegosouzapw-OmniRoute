import test from "node:test";
import assert from "node:assert/strict";

const { GrokCliExecutor } = await import("@omniroute/open-sse/executors/grok-cli");

// #6288 originally protected the legacy Chat Completions bridge from reasoning
// fields. Grok Build 0.2.93 now advertises Responses for both live models:
// grok-4.5 supports nested reasoning, while Composer does not.

test("grok-4.5 preserves Responses reasoning", () => {
  const executor = new GrokCliExecutor();
  const body = {
    model: "grok-4.5",
    input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
    reasoning: { effort: "high", summary: "auto" },
  };

  const out = executor.transformRequest("grok-4.5", body, true, {} as never) as Record<
    string,
    unknown
  >;

  assert.deepEqual(out.reasoning, { effort: "high", summary: "auto" });
});

test("grok composer strips unsupported Responses reasoning", () => {
  const executor = new GrokCliExecutor();
  const body = {
    model: "grok-composer-2.5-fast",
    input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
    reasoning: { effort: "high" },
  };

  const out = executor.transformRequest(
    "grok-composer-2.5-fast",
    body,
    false,
    {} as never
  ) as Record<string, unknown>;

  assert.equal("reasoning" in out, false);
});

test("grok-cli strips legacy top-level reasoning_effort after translation", () => {
  const executor = new GrokCliExecutor();
  const body = {
    model: "grok-4.5",
    input: [],
    reasoning_effort: "high",
  };

  const out = executor.transformRequest("grok-4.5", body, false, {} as never) as Record<
    string,
    unknown
  >;

  assert.equal("reasoning_effort" in out, false);
});
