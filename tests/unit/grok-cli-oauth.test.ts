import test from "node:test";
import assert from "node:assert/strict";

const { grokCli } = await import("../../src/lib/oauth/providers/grok-cli.ts");
const { resolvePublicCred } = await import("@omniroute/open-sse/utils/publicCreds");

const GROK_CLI_SCOPE = "openid profile email offline_access grok-cli:access api:access";

test("Grok Build OAuth Provider - config", () => {
  assert.ok(grokCli.config.clientId, "clientId should be defined");
  // The public client_id must come from the embedded default (Hard Rule #11),
  // not a string literal — assert it matches resolvePublicCred("grok_id").
  assert.equal(
    grokCli.config.clientId,
    resolvePublicCred("grok_id", "GROK_OAUTH_CLIENT_ID"),
    "clientId must resolve from the embedded grok_id default"
  );
  assert.equal(grokCli.config.tokenUrl, "https://auth.x.ai/oauth2/token");
});

test("publicCreds: grok_id embedded default is present and decodes", () => {
  const decoded = resolvePublicCred("grok_id");
  assert.ok(decoded.length > 0, "grok_id must decode to a non-empty client id");
});

test("Grok Build OAuth Provider - flowType is device_code", () => {
  assert.equal(grokCli.flowType, "device_code");
  assert.equal(grokCli.config.deviceCodeUrl, "https://auth.x.ai/oauth2/device/code");
  assert.equal(grokCli.config.scope, GROK_CLI_SCOPE);
});

test("Grok Build OAuth Provider - requests and normalizes a device code", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(
      JSON.stringify({
        device_code: "opaque-device-code",
        user_code: "ABCD-EFGH",
        verification_uri: "https://accounts.x.ai/oauth2/device",
        verification_uri_complete: "https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH",
        expires_in: 1800,
        interval: 5,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  const result = await grokCli.requestDeviceCode(grokCli.config);
  const body = new URLSearchParams(String(requestInit?.body));

  assert.equal(requestUrl, grokCli.config.deviceCodeUrl);
  assert.equal(requestInit?.method, "POST");
  assert.equal(body.get("client_id"), grokCli.config.clientId);
  assert.equal(body.get("scope"), GROK_CLI_SCOPE);
  assert.equal(result.device_code, "opaque-device-code");
  assert.equal(result.user_code, "ABCD-EFGH");
  assert.equal(result.expires_in, 1800);
  assert.equal(result.interval, 5);
});

test("Grok Build OAuth Provider - polls with the standard device grant", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestInit = init;
    return new Response(
      JSON.stringify({
        error: "authorization_pending",
        error_description: "User has not yet authorized",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  const result = await grokCli.pollToken(grokCli.config, "opaque-device-code");
  const body = new URLSearchParams(String(requestInit?.body));

  assert.equal(body.get("client_id"), grokCli.config.clientId);
  assert.equal(body.get("device_code"), "opaque-device-code");
  assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
  assert.equal(result.ok, false);
  assert.equal(result.data.error, "authorization_pending");
});

test("Grok Build OAuth Provider - maps a standard OAuth token response", () => {
  const accessPayload = {
    sub: "user-123",
    email: "device@example.com",
    team_id: "team-456",
    tier: 2,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const accessToken = `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify(accessPayload)).toString("base64url")}.signature`;
  const idToken = `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(
    JSON.stringify({ email: "device@example.com" })
  ).toString("base64url")}.signature`;

  const result = grokCli.mapTokens({
    access_token: accessToken,
    refresh_token: "refresh-device-token",
    id_token: idToken,
    expires_in: 3600,
    token_type: "Bearer",
    scope: GROK_CLI_SCOPE,
  });

  assert.equal(result.accessToken, accessToken);
  assert.equal(result.refreshToken, "refresh-device-token");
  assert.equal(result.idToken, idToken);
  assert.equal(result.expiresIn, 3600);
  assert.equal(result.tokenType, "Bearer");
  assert.equal(result.scope, GROK_CLI_SCOPE);
  assert.equal(result.email, "device@example.com");
  assert.equal(result.providerSpecificData?.teamId, "team-456");
});

test("Grok Build OAuth Provider - mapTokens from raw JWT", () => {
  // Create a valid JWT with base64url-encoded payload
  const payload = { sub: "12345", email: "test@example.com", team_id: "team-67890", tier: 1 };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mockJwt = `eyJhbGciOiJFUzI1NiJ9.${payloadBase64}.signature`;
  const result = grokCli.mapTokens(mockJwt, null);

  assert.equal(result.accessToken, mockJwt);
  assert.equal(result.refreshToken, null);
  assert.equal(result.email, "test@example.com");
  assert.equal(result.expiresIn, 21600);
  assert.equal(result.providerSpecificData?.userId, "12345");
  assert.equal(result.providerSpecificData?.teamId, "team-67890");
  assert.equal(result.providerSpecificData?.tier, 1);
});

test("Grok Build OAuth Provider - mapTokens from auth.json", () => {
  const authJson = {
    "https://auth.x.ai::clientId": {
      key: "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20ifQ.signature",
      refresh_token: "test-refresh-token",
    },
  };
  const result = grokCli.mapTokens(authJson, null);

  assert.ok(result.accessToken.includes("eyJ"), "accessToken should be JWT");
  assert.equal(result.refreshToken, "test-refresh-token");
  assert.equal(result.email, "test@example.com");
});

test("Grok Build OAuth Provider - mapTokens from empty string", () => {
  const result = grokCli.mapTokens("", null);
  assert.equal(result.accessToken, "");
});

test("Grok Build OAuth Provider - mapTokens from object with accessToken", () => {
  const input = { accessToken: "direct-token" };
  const result = grokCli.mapTokens(input, null);
  assert.equal(result.accessToken, "direct-token");
});

test("Grok Build OAuth Provider - mapTokens from route-wrapped auth.json", () => {
  // The route handler wraps the token: { accessToken: <token> }.
  // This simulates what the import-token endpoint passes to mapTokens.
  const authJson = {
    "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828": {
      key: "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20ifQ.signature",
      refresh_token: "test-refresh-token-wrapped",
      expires_at: "2026-12-31T00:00:00Z",
    },
  };
  const wrapped = { accessToken: authJson };
  const result = grokCli.mapTokens(wrapped, null);

  assert.ok(
    result.accessToken.startsWith("eyJ"),
    "accessToken should be JWT from wrapped auth.json"
  );
  assert.equal(result.refreshToken, "test-refresh-token-wrapped");
  assert.equal(result.email, "test@example.com");
  assert.ok(result.providerSpecificData?.rawAuthJson, "rawAuthJson should be populated");
  assert.deepEqual(
    result.providerSpecificData?.rawAuthJson,
    authJson,
    "rawAuthJson should equal the original auth.json"
  );
});

test("Grok Build OAuth Provider - mapTokens from direct auth.json has rawAuthJson", () => {
  const authJson = {
    "https://auth.x.ai::clientId": {
      key: "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20ifQ.signature",
      refresh_token: "direct-refresh",
    },
  };
  const result = grokCli.mapTokens(authJson, null);

  assert.ok(result.accessToken.startsWith("eyJ"));
  assert.equal(result.refreshToken, "direct-refresh");
  assert.deepEqual(result.providerSpecificData?.rawAuthJson, authJson);
});

test("Grok Build OAuth Provider - mapTokens from raw JWT has no rawAuthJson", () => {
  const payload = { sub: "12345", email: "test@example.com" };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mockJwt = `eyJhbGciOiJFUzI1NiJ9.${payloadBase64}.signature`;
  const result = grokCli.mapTokens(mockJwt, null);

  assert.equal(result.accessToken, mockJwt);
  assert.equal(result.refreshToken, null);
  assert.equal(result.providerSpecificData?.rawAuthJson, undefined);
});

test("Grok Build OAuth Provider - mapTokens extracts expiresIn from JWT exp (dynamic)", () => {
  const futureSec = Math.floor(Date.now() / 1000) + 1200; // 20 minutes from now
  const payload = { sub: "12345", email: "test@example.com", exp: futureSec };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mockJwt = `eyJhbGciOiJFUzI1NiJ9.${payloadBase64}.signature`;
  const result = grokCli.mapTokens(mockJwt, null);

  assert.ok(result.expiresIn > 0);
  assert.ok(Math.abs(result.expiresIn - 1200) <= 2);
});

test("Grok Build OAuth Provider - mapTokens extracts expiresIn from JSON expires_at (dynamic)", () => {
  const futureDateStr = new Date(Date.now() + 1800 * 1000).toISOString(); // 30 minutes from now
  const authJson = {
    "https://auth.x.ai::clientId": {
      key: "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20ifQ.signature",
      refresh_token: "test-refresh-token",
      expires_at: futureDateStr,
    },
  };
  const result = grokCli.mapTokens(authJson, null);

  assert.ok(result.expiresIn > 0);
  assert.ok(Math.abs(result.expiresIn - 1800) <= 2);
});

test("Grok Build OAuth Provider - mapTokens falls back to 21600 if no exp or expires_at", () => {
  const payload = { sub: "12345", email: "test@example.com" };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mockJwt = `eyJhbGciOiJFUzI1NiJ9.${payloadBase64}.signature`;
  const result = grokCli.mapTokens(mockJwt, null);

  assert.equal(result.expiresIn, 21600);
});

// #5775 follow-up: an already-expired token must NOT produce a negative expiresIn.
// A negative value is truthy in the import-token route (route.ts), yielding a PAST
// expiresAt that AutoCombo (virtualFactory.ts) reads as "already expired" and excludes
// the connection immediately — instead of clamping to a tiny positive TTL so the token
// is treated as due-for-refresh. Clamp with Math.max(1, …).
test("Grok Build OAuth Provider - mapTokens clamps expired JWT exp to a positive expiresIn", () => {
  const pastSec = Math.floor(Date.now() / 1000) - 3600; // expired 1h ago
  const payload = { sub: "12345", email: "test@example.com", exp: pastSec };
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mockJwt = `eyJhbGciOiJFUzI1NiJ9.${payloadBase64}.signature`;
  const result = grokCli.mapTokens(mockJwt, null);

  assert.ok(result.expiresIn >= 1, `expected expiresIn >= 1, got ${result.expiresIn}`);
});

test("Grok Build OAuth Provider - mapTokens clamps expired JSON expires_at to a positive expiresIn", () => {
  const pastDateStr = new Date(Date.now() - 3600 * 1000).toISOString(); // expired 1h ago
  const authJson = {
    "https://auth.x.ai::clientId": {
      key: "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20ifQ.signature",
      refresh_token: "test-refresh-token",
      expires_at: pastDateStr,
    },
  };
  const result = grokCli.mapTokens(authJson, null);

  assert.ok(result.expiresIn >= 1, `expected expiresIn >= 1, got ${result.expiresIn}`);
});
