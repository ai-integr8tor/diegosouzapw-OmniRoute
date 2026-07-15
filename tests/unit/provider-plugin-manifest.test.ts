import assert from "node:assert/strict";
import test from "node:test";

import {
  generateProviderPluginManifestFromRegistry,
  getProviderPluginManifestEntryFromRegistry,
} from "../../open-sse/config/providerPluginManifest.ts";
import type { RegistryEntry } from "../../open-sse/config/providers/shared.ts";

const registryFixture: Record<string, RegistryEntry> = {
  openai: {
    id: "openai",
    alias: "openai",
    format: "openai",
    executor: "default",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    authType: "apikey",
    authHeader: "bearer",
    defaultContextLength: 128000,
    models: [
      { id: "gpt-4.1", name: "GPT-4.1", contextLength: 1047576 },
      {
        id: "o3",
        name: "O3",
        contextLength: 200000,
        unsupportedParams: ["temperature", "top_p"],
      },
    ],
  },
  anthropic: {
    id: "anthropic",
    alias: "anthropic",
    format: "claude",
    executor: "default",
    baseUrl: "https://api.anthropic.com/v1/messages",
    authType: "apikey",
    authHeader: "x-api-key",
    headers: {
      "Anthropic-Version": "2023-06-01",
    },
    models: [{ id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" }],
  },
  "claude-web": {
    id: "claude-web",
    alias: "cw",
    format: "openai",
    executor: "claude-web",
    baseUrl: "https://claude.ai/api/organizations",
    authType: "apikey",
    authHeader: "cookie",
    models: [{ id: "claude-sonnet-4.6", name: "Claude 4.6 Sonnet (web)" }],
  },
  claude: {
    id: "claude",
    alias: "claude",
    format: "claude",
    executor: "default",
    baseUrl: "https://api.anthropic.com/v1/messages",
    authType: "oauth",
    authHeader: "x-api-key",
    oauth: {
      clientIdDefault: "public-client",
      clientSecretDefault: "secret-that-must-not-export",
      tokenUrl: "https://console.anthropic.com/oauth/token",
    },
    models: [{ id: "claude-opus-4.7", name: "Claude Opus 4.7" }],
  },
};

test("provider plugin manifest is JSON-safe and stable enough for sidecars", () => {
  const manifest = generateProviderPluginManifestFromRegistry(registryFixture);
  const roundTripped = JSON.parse(JSON.stringify(manifest));

  assert.equal(roundTripped.schemaVersion, 1);
  assert.equal(roundTripped.generatedFrom, "open-sse/config/providers");
  assert.equal(roundTripped.providers.length, 6);
  assert.deepEqual(
    roundTripped.providers.map((provider: { id: string }) => provider.id),
    [...roundTripped.providers.map((provider: { id: string }) => provider.id)].sort(),
  );
});

test("manifest exposes API-key default-executor providers as sidecar candidates", () => {
  const openai = getProviderPluginManifestEntryFromRegistry(registryFixture, "openai");

  assert.ok(openai);
  assert.equal(openai.sidecar.eligible, true);
  assert.deepEqual(openai.sidecar.reasons, []);
  assert.ok(openai.capabilities.includes("apikey"));
  assert.ok(openai.capabilities.includes("sidecar-candidate"));
  assert.equal(openai.endpoints.baseUrl, "https://api.openai.com/v1/chat/completions");
  assert.ok(openai.models.some((model) => model.id === "gpt-4.1"));
});

test("manifest keeps custom web executors on the TypeScript fallback path", () => {
  const claudeWeb = getProviderPluginManifestEntryFromRegistry(registryFixture, "cw");

  assert.ok(claudeWeb);
  assert.equal(claudeWeb.id, "claude-web");
  assert.equal(claudeWeb.sidecar.eligible, false);
  assert.ok(claudeWeb.capabilities.includes("custom-executor"));
  assert.ok(claudeWeb.sidecar.reasons.some((reason) => reason.includes("claude-web")));
});

test("manifest does not export OAuth client secrets or dynamic functions", () => {
  const manifest = generateProviderPluginManifestFromRegistry(registryFixture);
  const serialized = JSON.stringify(manifest);

  assert.equal(serialized.includes("clientSecret"), false);
  assert.equal(serialized.includes("clientSecretDefault"), false);
  assert.equal(serialized.includes("clientSecretEnv"), false);

  const parsed = JSON.parse(serialized);
  for (const provider of parsed.providers) {
    assert.notEqual(typeof provider.endpoints?.urlBuilder, "function");
    assert.equal("oauth" in provider, false);
    assert.equal("headers" in provider, false);
    assert.equal("extraHeaders" in provider, false);
    assert.equal("requestDefaults" in provider, false);
  }
});

test("manifest exposes service backends as plugin-style entries", () => {
  const manifest = generateProviderPluginManifestFromRegistry(registryFixture);
  const nineRouter = manifest.providers.find((provider) => provider.id === "9router");
  const cliproxyapi = manifest.providers.find((provider) => provider.id === "cliproxyapi");

  assert.ok(nineRouter);
  assert.equal(nineRouter.executor, "9router");
  assert.ok(nineRouter.capabilities.includes("custom-executor"));
  assert.equal(nineRouter.sidecar.eligible, false);
  assert.ok(nineRouter.sidecar.reasons.some((reason) => reason.includes("nine-router")));

  assert.ok(cliproxyapi);
  assert.equal(cliproxyapi.executor, "cliproxyapi");
  assert.ok(cliproxyapi.capabilities.includes("custom-executor"));
  assert.equal(cliproxyapi.sidecar.eligible, false);
  assert.ok(cliproxyapi.sidecar.reasons.some((reason) => reason.includes("CLIProxyAPI")));
});

test("service plugin manifests follow local service host/port environment overrides", () => {
  const previousEnv = {
    NINEROUTER_HOST: process.env.NINEROUTER_HOST,
    NINEROUTER_PORT: process.env.NINEROUTER_PORT,
    CLIPROXYAPI_HOST: process.env.CLIPROXYAPI_HOST,
    CLIPROXYAPI_PORT: process.env.CLIPROXYAPI_PORT,
  };

  process.env.NINEROUTER_HOST = "10.10.10.10";
  process.env.NINEROUTER_PORT = "54321";
  process.env.CLIPROXYAPI_HOST = "10.10.10.20";
  process.env.CLIPROXYAPI_PORT = "65432";

  try {
    const manifest = generateProviderPluginManifestFromRegistry(registryFixture);
    const nineRouter = manifest.providers.find((provider) => provider.id === "9router");
    const cliproxyapi = manifest.providers.find((provider) => provider.id === "cliproxyapi");

    assert.ok(nineRouter);
    assert.ok(cliproxyapi);
    assert.equal(nineRouter.endpoints.baseUrl, "http://10.10.10.10:54321/v1/chat/completions");
    assert.equal(
      nineRouter.endpoints.modelsUrl,
      "http://10.10.10.10:54321/v1/models"
    );
    assert.equal(
      cliproxyapi.endpoints.baseUrl,
      "http://10.10.10.20:65432/v1/chat/completions"
    );
    assert.equal(
      cliproxyapi.endpoints.modelsUrl,
      "http://10.10.10.20:65432/v1/models"
    );
  } finally {
    if (previousEnv.NINEROUTER_HOST === undefined) {
      delete process.env.NINEROUTER_HOST;
    } else {
      process.env.NINEROUTER_HOST = previousEnv.NINEROUTER_HOST;
    }
    if (previousEnv.NINEROUTER_PORT === undefined) {
      delete process.env.NINEROUTER_PORT;
    } else {
      process.env.NINEROUTER_PORT = previousEnv.NINEROUTER_PORT;
    }
    if (previousEnv.CLIPROXYAPI_HOST === undefined) {
      delete process.env.CLIPROXYAPI_HOST;
    } else {
      process.env.CLIPROXYAPI_HOST = previousEnv.CLIPROXYAPI_HOST;
    }
    if (previousEnv.CLIPROXYAPI_PORT === undefined) {
      delete process.env.CLIPROXYAPI_PORT;
    } else {
      process.env.CLIPROXYAPI_PORT = previousEnv.CLIPROXYAPI_PORT;
    }
  }
});
