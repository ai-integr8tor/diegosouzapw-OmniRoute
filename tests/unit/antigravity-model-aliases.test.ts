import test from "node:test";
import assert from "node:assert/strict";

import {
  ANTIGRAVITY_PUBLIC_MODELS,
  getClientVisibleAntigravityModelName,
  isUserCallableAntigravityModelId,
  resolveAntigravityModelId,
  toClientAntigravityModelId,
  toClientAntigravityQuotaModelId,
} from "../../open-sse/config/antigravityModelAliases.ts";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.ts";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.ts";

function getPublicModel(id: string) {
  return ANTIGRAVITY_PUBLIC_MODELS.find((model) => model.id === id) as any;
}

const EXPECTED_FLASH_TIERS = [
  ["gemini-3.5-flash-extra-low", "Gemini 3.5 Flash (Low)"],
  ["gemini-3.5-flash-low", "Gemini 3.5 Flash (Medium)"],
  ["gemini-3-flash-agent", "Gemini 3.5 Flash (High)"],
] as const;

const RETIRED_FLASH_IDS = [
  "gemini-3.5-flash-medium",
  "gemini-3.5-flash-high",
  "gemini-3.5-flash-preview",
] as const;

test("toClientAntigravityQuotaModelId preserves upstream Gemini 3.5 bucket IDs", () => {
  for (const [modelId] of EXPECTED_FLASH_TIERS) {
    assert.equal(toClientAntigravityQuotaModelId(modelId), modelId);
  }
  // Always-allowed bucket passes through unchanged.
  assert.equal(toClientAntigravityQuotaModelId("credits"), "credits");
  // Retired preview buckets are dropped (hidden from clients).
  assert.equal(toClientAntigravityQuotaModelId("gemini-3.5-flash-preview"), null);
  assert.equal(toClientAntigravityQuotaModelId("gemini-3-flash-preview"), null);
  assert.equal(toClientAntigravityQuotaModelId(""), null);
});

test("resolveAntigravityModelId maps the documented Antigravity aliases to upstream IDs", () => {
  assert.equal(resolveAntigravityModelId("gemini-3-pro-image-preview"), "gemini-3-pro-image");
  for (const [modelId] of EXPECTED_FLASH_TIERS) {
    assert.equal(resolveAntigravityModelId(modelId), modelId);
  }
  assert.equal(resolveAntigravityModelId("gemini-claude-sonnet-4-5"), "claude-sonnet-4-6");
  assert.equal(resolveAntigravityModelId("gemini-claude-sonnet-4-5-thinking"), "claude-sonnet-4-6");
  assert.equal(
    resolveAntigravityModelId("gemini-claude-opus-4-5-thinking"),
    "claude-opus-4-6-thinking"
  );
  assert.equal(resolveAntigravityModelId("unknown-model"), "unknown-model");
});

test("toClientAntigravityModelId preserves public upstream IDs", () => {
  for (const [modelId] of EXPECTED_FLASH_TIERS) {
    assert.equal(toClientAntigravityModelId(modelId), modelId);
  }
  assert.equal(toClientAntigravityModelId("gpt-oss-120b-medium"), "gpt-oss-120b-medium");
  assert.equal(toClientAntigravityModelId("claude-sonnet-4-6"), "claude-sonnet-4-6");
  assert.equal(toClientAntigravityModelId("claude-opus-4-6-thinking"), "claude-opus-4-6-thinking");
});

test("isUserCallableAntigravityModelId only allows public chat-capable model IDs", () => {
  // Retired ids and their former upstream targets are neither aliased nor callable.
  assert.equal(isUserCallableAntigravityModelId("gemini-3-pro-preview"), false);
  assert.equal(isUserCallableAntigravityModelId("gemini-3.1-pro"), false);
  for (const retiredId of RETIRED_FLASH_IDS) {
    assert.equal(isUserCallableAntigravityModelId(retiredId), false);
  }
  for (const [modelId] of EXPECTED_FLASH_TIERS) {
    assert.equal(isUserCallableAntigravityModelId(modelId), true);
  }
  assert.equal(isUserCallableAntigravityModelId("gemini-3.1-flash-lite"), true);
  assert.equal(isUserCallableAntigravityModelId("gemini-2.5-pro"), false);
  assert.equal(isUserCallableAntigravityModelId("gemini-2.5-flash"), true);
  assert.equal(isUserCallableAntigravityModelId("gemini-2.5-flash-lite"), true);
  assert.equal(isUserCallableAntigravityModelId("gemini-2.5-flash-thinking"), true);
  assert.equal(isUserCallableAntigravityModelId("gemini-pro-agent"), true);
  // #3184: Claude IS user-callable through the Antigravity OAuth provider (same backend as
  // `agy`, verified empirically). An earlier assumption that it was removed in Antigravity
  // 2.0 was wrong.
  assert.equal(isUserCallableAntigravityModelId("claude-opus-4-6-thinking"), true);
  assert.equal(isUserCallableAntigravityModelId("claude-sonnet-4-6"), true);
  assert.equal(isUserCallableAntigravityModelId("claude-sonnet-5"), false);
  // The advertised pro-high discovery slot rejects content requests; use pro-agent High.
  assert.equal(isUserCallableAntigravityModelId("gemini-3.1-pro-high"), false);
  assert.equal(isUserCallableAntigravityModelId("gemini-pro-agent"), true);
  assert.equal(isUserCallableAntigravityModelId("gemini-3.1-pro-low"), true);
  assert.equal(isUserCallableAntigravityModelId("tab_flash_lite_preview"), false);
  assert.equal(isUserCallableAntigravityModelId("unknown-model"), false);
});

test("ANTIGRAVITY_PUBLIC_MODELS exposes captured Antigravity 2.0.1 names and capabilities", () => {
  // #3184: Claude is exposed in the antigravity catalog (same backend as `agy`, verified).
  assert.deepEqual(getPublicModel("claude-opus-4-6-thinking"), {
    id: "claude-opus-4-6-thinking",
    name: "Claude Opus 4.6 (Thinking)",
    contextLength: 200000,
    maxOutputTokens: 65536,
    supportsReasoning: true,
    supportsVision: true,
    toolCalling: true,
  });
  assert.equal(getPublicModel("claude-sonnet-4-6").name, "Claude Sonnet 4.6 (Thinking)");
  assert.equal(getPublicModel("claude-sonnet-5"), undefined);
  for (const [modelId, displayName] of EXPECTED_FLASH_TIERS) {
    assert.deepEqual(getPublicModel(modelId), {
      id: modelId,
      name: displayName,
      contextLength: 1048576,
      maxOutputTokens: 65536,
      supportsReasoning: true,
      supportsVision: true,
      toolCalling: true,
    });
    assert.equal(getClientVisibleAntigravityModelName(modelId), displayName);
  }
  for (const retiredId of RETIRED_FLASH_IDS) {
    assert.equal(getPublicModel(retiredId), undefined);
  }
  assert.equal(getClientVisibleAntigravityModelName("gemini-2.5-flash"), "Gemini 2.5 Flash");
  assert.equal(
    getClientVisibleAntigravityModelName("gemini-2.5-flash-lite"),
    "Gemini 2.5 Flash Lite"
  );
  assert.equal(
    getClientVisibleAntigravityModelName("gemini-2.5-flash-thinking"),
    "Gemini 2.5 Flash Thinking"
  );
  assert.deepEqual(getPublicModel("gpt-oss-120b-medium"), {
    id: "gpt-oss-120b-medium",
    name: "GPT-OSS 120B (Medium)",
    contextLength: 131072,
    maxOutputTokens: 32768,
    supportsReasoning: true,
    toolCalling: true,
  });
  assert.equal(getPublicModel("gemini-3-pro-image-preview"), undefined);
  assert.equal(getPublicModel("gemini-3.1-flash-image"), undefined);
  assert.equal(getPublicModel("gemini-2.5-computer-use-preview-10-2025"), undefined);
});

test("ANTIGRAVITY_PUBLIC_MODELS has no duplicate model IDs", () => {
  const ids = ANTIGRAVITY_PUBLIC_MODELS.map((model) => model.id);
  const seen = new Set<string>();
  const duplicates = ids.filter((id) => {
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  });
  assert.deepEqual(duplicates, [], `duplicate model IDs found: ${duplicates.join(", ")}`);
});

test("AntigravityExecutor.transformRequest preserves Gemini 3.5 upstream IDs", async () => {
  const executor = new AntigravityExecutor();
  for (const [modelId] of EXPECTED_FLASH_TIERS) {
    const result = await executor.transformRequest(
      `antigravity/${modelId}`,
      {
        request: {
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        },
      },
      true,
      { projectId: "project-1" }
    );

    if (result instanceof Response) throw new Error("Unexpected Response from transformRequest");
    assert.equal(result.model, modelId);
    assert.deepEqual(result.request.contents, [{ role: "user", parts: [{ text: "Hello" }] }]);
  }
});

test("AntigravityExecutor.transformRequest sends Claude through Gemini-compatible Cloud Code schema", async () => {
  const executor = new AntigravityExecutor();
  const bridged = openaiToAntigravityRequest(
    "claude-opus-4-6-thinking",
    {
      messages: [{ role: "user", content: "Hello" }],
      max_completion_tokens: 32_000,
      temperature: 0.5,
      reasoning_effort: "high",
    },
    true,
    { projectId: "project-1" } as any
  );

  const result = await executor.transformRequest(
    "antigravity/claude-opus-4-6-thinking",
    bridged,
    true,
    {
      projectId: "project-1",
    }
  );

  if (result instanceof Response) throw new Error("Unexpected Response from transformRequest");
  const request = result.request as any;
  assert.deepEqual(request.contents, [{ role: "user", parts: [{ text: "Hello" }] }]);
  // Capped to MAX_ANTIGRAVITY_OUTPUT_TOKENS (16384) by the executor (#4636) to avoid
  // the Antigravity Cloud Code 400 on maxOutputTokens > 16384, overriding the
  // thinkingBudget+1 bump (which would otherwise be 32769).
  assert.equal(request.generationConfig.maxOutputTokens, 16384);
  assert.equal(request.generationConfig.temperature, 0.5);
  assert.equal(request.generationConfig.topK, 40);
  assert.equal(request.generationConfig.topP, 1);
  assert.equal(request.messages, undefined);
  assert.equal(request.system, undefined);
  assert.equal(request.max_tokens, undefined);
  assert.equal(request.stream, undefined);
  assert.equal(request.temperature, undefined);
  assert.equal(request.thinking, undefined);
  assert.equal(request.generationConfig.thinkingConfig, undefined);
});
