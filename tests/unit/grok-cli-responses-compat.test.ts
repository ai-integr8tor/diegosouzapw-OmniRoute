import test from "node:test";
import assert from "node:assert/strict";

import { grok_cliProvider } from "../../open-sse/config/providers/registry/grok-cli/index.ts";
import { getModelTargetFormat } from "../../open-sse/config/providerModels.ts";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.ts";

test("grok-cli exposes the authenticated 0.2.93 model catalog", () => {
  assert.deepEqual(
    grok_cliProvider.models.map(({ id, name, contextLength, targetFormat }) => ({
      id,
      name,
      contextLength,
      targetFormat,
    })),
    [
      {
        id: "grok-4.5",
        name: "Grok 4.5",
        contextLength: 500000,
        targetFormat: "openai-responses",
      },
      {
        id: "grok-composer-2.5-fast",
        name: "Composer 2.5(Grok)",
        contextLength: 200000,
        targetFormat: "openai-responses",
      },
    ]
  );
  assert.equal(getModelTargetFormat("gc", "grok-4.5"), "openai-responses");
  assert.equal(getModelTargetFormat("gc", "grok-composer-2.5-fast"), "openai-responses");
});

test("grok-cli routes both models to the Responses endpoint", () => {
  const executor = new GrokCliExecutor();
  assert.equal(executor.buildUrl("grok-4.5", true), "https://cli-chat-proxy.grok.com/v1/responses");
  assert.equal(
    executor.buildUrl("grok-composer-2.5-fast", false),
    "https://cli-chat-proxy.grok.com/v1/responses"
  );
});

test("grok-cli sends the verified 0.2.93 fingerprint", () => {
  const executor = new GrokCliExecutor();
  const streaming = executor.buildHeaders({ accessToken: "token" }, true, null, "grok-4.5");
  assert.equal(streaming.Authorization, "Bearer token");
  assert.equal(streaming.Accept, "text/event-stream");
  assert.equal(streaming["x-grok-client-version"], "0.2.93");
  assert.equal(streaming["x-grok-client-identifier"], "grok-shell");
  assert.equal(streaming["User-Agent"], "grok-shell/0.2.93 (macos; aarch64)");
  assert.equal(streaming["x-grok-model-override"], "grok-4.5");

  const json = executor.buildHeaders({ apiKey: "token" }, false, null, "grok-composer-2.5-fast");
  assert.equal(json.Authorization, "Bearer token");
  assert.equal(json.Accept, "application/json");
  assert.equal(json["x-grok-model-override"], "grok-composer-2.5-fast");
});
