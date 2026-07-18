import assert from "node:assert/strict";
import test from "node:test";

import {
  PROVIDER_PLUGIN_MANIFEST_ENV,
  PROVIDER_PLUGIN_MANIFEST_HEADER,
  resolveProviderPluginManifestUrl,
  getProviderPluginManifestHeader,
} from "../../open-sse/config/providerPluginManifestUrl.ts";
import { resolveProviderPluginManifestUrl as resolveManifestClientUrl } from "../../open-sse/config/providerPluginManifestClient.ts";

test("provider manifest URL uses explicit env override", () => {
  const previous = process.env[PROVIDER_PLUGIN_MANIFEST_ENV];
  process.env[PROVIDER_PLUGIN_MANIFEST_ENV] = "http://sidecar.local/manifest.json";
  try {
    assert.equal(
      resolveProviderPluginManifestUrl("http://127.0.0.1:20128"),
      "http://sidecar.local/manifest.json"
    );
  } finally {
    if (previous === undefined) {
      delete process.env[PROVIDER_PLUGIN_MANIFEST_ENV];
    } else {
      process.env[PROVIDER_PLUGIN_MANIFEST_ENV] = previous;
    }
  }
});

test("provider manifest producer and client resolve the same base URL", () => {
  const origin = "http://127.0.0.1:20128/";
  assert.equal(
    resolveManifestClientUrl({ baseUrl: origin }),
    resolveProviderPluginManifestUrl(origin)
  );
});

test("provider manifest URL derives from request origin", () => {
  assert.equal(
    resolveProviderPluginManifestUrl("http://127.0.0.1:20128/"),
    "http://127.0.0.1:20128/api/v1/provider-plugin-manifest"
  );
});

test("provider manifest header exposes stable header name", () => {
  assert.deepEqual(getProviderPluginManifestHeader("http://localhost:20128"), {
    [PROVIDER_PLUGIN_MANIFEST_HEADER]: "http://localhost:20128/api/v1/provider-plugin-manifest",
  });
});
