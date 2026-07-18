import test from "node:test";
import assert from "node:assert/strict";

// #7044: Native Claude requests carry effort in `output_config.effort` (not
// reasoning_effort / reasoning.effort). The provider-aware effort sanitizer only
// inspected the two OpenAI-style carriers, so `output_config.effort: "xhigh"`
// bypassed it entirely and reached Anthropic unchanged → 400 "This model does not
// support effort level 'xhigh'." for models that opt out of xhigh (Sonnet 4.6).
const { sanitizeReasoningEffortForProvider } = await import("../../open-sse/executors/base.ts");

type EffortBody = {
  model?: string;
  reasoning_effort?: string;
  reasoning?: Record<string, unknown>;
  output_config?: Record<string, unknown>;
  messages?: unknown;
};

function asBody(value: unknown): EffortBody {
  return value as EffortBody;
}

function makeLog() {
  const messages: Array<[string, string]> = [];
  return {
    info: (tag: string, msg: string) => messages.push([tag, msg]),
    messages,
  };
}

test("#7044: claude output_config.effort=xhigh downgrades to high for Sonnet 4.6", () => {
  const log = makeLog();
  const body = {
    model: "claude-sonnet-4-6",
    output_config: { effort: "xhigh" },
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "claude", "claude-sonnet-4-6", log);
  assert.notEqual(result, body, "must return a new object when mutating");
  assert.equal(
    asBody(result).output_config?.effort,
    "high",
    "xhigh must be downgraded on Claude's native output_config carrier"
  );
  assert.ok(
    log.messages.some(([tag, m]) => tag === "REASONING_SANITIZE" && /xhigh → high/.test(m)),
    "logs the downgrade"
  );
});

test("#7044: claude output_config.effort=max is preserved for Sonnet 4.6 (supports max)", () => {
  const body = {
    model: "claude-sonnet-4-6",
    output_config: { effort: "max" },
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "claude", "claude-sonnet-4-6", null);
  assert.equal(result, body, "max is a supported Claude level — passes through unchanged");
  assert.equal(asBody(result).output_config?.effort, "max");
});

test("#7044: output_config.effort preserves sibling fields when rewritten", () => {
  const body = {
    model: "claude-opus-4-6",
    output_config: { effort: "xhigh", format: "text" },
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "claude", "claude-opus-4-6", null);
  assert.equal(asBody(result).output_config?.effort, "high");
  assert.equal(
    asBody(result).output_config?.format,
    "text",
    "other output_config fields must be preserved"
  );
});

test("#7044: reasoning_effort still wins when both carriers present (no regression)", () => {
  // reasoning_effort / reasoning.effort remain the primary carriers; output_config
  // is only the fallback. A supported xhigh model passes through untouched.
  const body = {
    model: "mimo-v2.5-pro",
    reasoning_effort: "xhigh",
    output_config: { effort: "xhigh" },
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "xiaomi-mimo", "mimo-v2.5-pro", null);
  assert.equal(result, body, "supported xhigh passes through unchanged");
  assert.equal(asBody(result).reasoning_effort, "xhigh");
  assert.equal(asBody(result).output_config?.effort, "xhigh");
});

test("#7044: no output_config.effort key → unchanged", () => {
  const body = {
    model: "claude-sonnet-4-6",
    output_config: { format: "text" },
    messages: [{ role: "user", content: "hi" }],
  };
  const result = sanitizeReasoningEffortForProvider(body, "claude", "claude-sonnet-4-6", null);
  assert.equal(result, body, "no effort carrier present → returns original body unchanged");
});
