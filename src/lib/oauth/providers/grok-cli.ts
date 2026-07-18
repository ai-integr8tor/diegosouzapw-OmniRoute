/**
 * Grok Build OAuth Provider — Device Code Flow with Import Token Fallback
 *
 * User pastes the entire auth.json from ~/.grok/auth.json
 * or just the JWT access token string.
 * Supports automatic token refresh using the refresh_token.
 */

import { GROK_CLI_CONFIG } from "../constants/oauth";

interface GrokCliAuthInfo {
  user_id: string;
  email: string;
  team_id: string;
  tier: number;
  principal_type: string;
}

const EMPTY_STANDARD_TOKEN_FIELDS = {
  idToken: null,
  tokenType: null,
  scope: null,
  oauthExpiresIn: null,
} as const;

async function parseOAuthResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    const value = await response.json();
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {
      error: "invalid_response",
      error_description: "xAI returned a non-JSON OAuth response",
    };
  }
}

async function requestDeviceCode(config: typeof GROK_CLI_CONFIG) {
  const response = await fetch(config.deviceCodeUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      scope: config.scope,
    }),
  });
  const data = await parseOAuthResponse(response);

  if (!response.ok) {
    throw new Error(
      typeof data.error_description === "string"
        ? data.error_description
        : "Grok device authorization failed"
    );
  }
  if (
    typeof data.device_code !== "string" ||
    typeof data.user_code !== "string" ||
    typeof data.verification_uri !== "string"
  ) {
    throw new Error("Grok device authorization response is incomplete");
  }

  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    verification_uri_complete:
      typeof data.verification_uri_complete === "string"
        ? data.verification_uri_complete
        : data.verification_uri,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : 1800,
    interval: typeof data.interval === "number" ? data.interval : 5,
  };
}

async function pollToken(config: typeof GROK_CLI_CONFIG, deviceCode: string) {
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });

  return { ok: response.ok, data: await parseOAuthResponse(response) };
}

function parseJwtPayload(token: string): {
  email: string | null;
  authInfo: GrokCliAuthInfo | null;
  exp: number | null;
} {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { email: null, authInfo: null, exp: null };

    let base64 = parts[1];
    switch (base64.length % 4) {
      case 2:
        base64 += "==";
        break;
      case 3:
        base64 += "=";
        break;
    }
    base64 = base64.replace(/-/g, "+").replace(/_/g, "/");

    const payload = JSON.parse(Buffer.from(base64, "base64").toString("utf-8"));
    return {
      email: payload.email || null,
      authInfo: {
        user_id: payload.sub || "",
        email: payload.email || "",
        team_id: payload.team_id || "",
        tier: payload.tier || 1,
        principal_type: payload.principal_type || "User",
      },
      exp: typeof payload.exp === "number" ? payload.exp : null,
    };
  } catch {
    return { email: null, authInfo: null, exp: null };
  }
}

/**
 * Extract the JWT access token and refresh_token from user input.
 * Accepts either:
 *   - Raw JWT string (no refresh_token available)
 *   - The entire auth.json object: { "https://auth.x.ai::...": { "key": "eyJ...", "refresh_token": "..." } }
 */
function extractTokenAndRefresh(input: unknown): {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: string | null;
  scope: string | null;
  oauthExpiresIn: number | null;
  rawAuthJson: Record<string, unknown> | null;
  expiresAt: string | null;
} {
  // Direct JWT string
  if (typeof input === "string")
    return {
      ...EMPTY_STANDARD_TOKEN_FIELDS,
      accessToken: input,
      refreshToken: null,
      rawAuthJson: null,
      expiresAt: null,
    };

  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;

    if (typeof obj.access_token === "string" && obj.access_token.length > 0) {
      return {
        accessToken: obj.access_token,
        refreshToken: typeof obj.refresh_token === "string" ? obj.refresh_token : null,
        idToken: typeof obj.id_token === "string" ? obj.id_token : null,
        tokenType: typeof obj.token_type === "string" ? obj.token_type : null,
        scope: typeof obj.scope === "string" ? obj.scope : null,
        oauthExpiresIn:
          typeof obj.expires_in === "number" && Number.isFinite(obj.expires_in)
            ? obj.expires_in
            : null,
        rawAuthJson: null,
        expiresAt: null,
      };
    }

    // The route handler wraps the token: { accessToken: <token> }.
    // Unwrap once before checking the inner value.
    const inner =
      typeof obj.accessToken === "object" && obj.accessToken !== null
        ? (obj.accessToken as Record<string, unknown>)
        : obj;

    // auth.json format: { "https://auth.x.ai::...": { key: "eyJ...", refresh_token: "..." } }
    if (inner && typeof inner === "object") {
      const innerKeys = Object.keys(inner);
      for (const k of innerKeys) {
        const entry = inner[k];
        if (entry && typeof entry === "object" && "key" in entry) {
          const e = entry as Record<string, unknown>;
          if (typeof e.key === "string" && e.key.startsWith("eyJ")) {
            return {
              ...EMPTY_STANDARD_TOKEN_FIELDS,
              accessToken: e.key,
              refreshToken: typeof e.refresh_token === "string" ? e.refresh_token : null,
              rawAuthJson: inner as Record<string, unknown>,
              expiresAt: typeof e.expires_at === "string" ? e.expires_at : null,
            };
          }
        }
      }
    }

    // Raw JWT passed as { accessToken: "eyJ..." }
    if (typeof obj.accessToken === "string" && obj.accessToken.length > 0) {
      return {
        ...EMPTY_STANDARD_TOKEN_FIELDS,
        accessToken: obj.accessToken,
        refreshToken: typeof obj.refreshToken === "string" ? obj.refreshToken : null,
        rawAuthJson: null,
        expiresAt: null,
      };
    }
  }

  return {
    ...EMPTY_STANDARD_TOKEN_FIELDS,
    accessToken: "",
    refreshToken: null,
    rawAuthJson: null,
    expiresAt: null,
  };
}

export const grokCli = {
  config: GROK_CLI_CONFIG,
  flowType: "device_code",
  requestDeviceCode,
  pollToken,
  mapTokens: (token: unknown, _extra?: unknown) => {
    const extracted = extractTokenAndRefresh(token);
    const accessClaims = parseJwtPayload(extracted.accessToken);
    const idClaims = extracted.idToken
      ? parseJwtPayload(extracted.idToken)
      : { email: null, authInfo: null, exp: null };
    const identity = accessClaims.email || accessClaims.authInfo?.user_id ? accessClaims : idClaims;

    const currentSec = Math.floor(Date.now() / 1000);
    let expiresIn = extracted.oauthExpiresIn ?? 21600;

    if (extracted.oauthExpiresIn == null && extracted.expiresAt) {
      const parsed = Date.parse(extracted.expiresAt);
      if (!isNaN(parsed)) {
        expiresIn = Math.floor(parsed / 1000) - currentSec;
      }
    } else if (extracted.oauthExpiresIn == null && accessClaims.exp) {
      expiresIn = accessClaims.exp - currentSec;
    }

    // #5775 follow-up: guard against an already-expired token yielding a negative
    // expiresIn. A negative value is truthy downstream (import-token route) and maps
    // to a PAST expiresAt, which AutoCombo reads as "already expired" and excludes the
    // connection instead of refreshing it. Clamp to a tiny positive TTL so the token is
    // treated as due-for-refresh.
    expiresIn = Math.max(1, expiresIn);

    return {
      accessToken: extracted.accessToken,
      refreshToken: extracted.refreshToken,
      idToken: extracted.idToken,
      expiresIn,
      tokenType: extracted.tokenType,
      scope: extracted.scope,
      email: identity.email,
      providerSpecificData: {
        userId: identity.authInfo?.user_id || null,
        teamId: identity.authInfo?.team_id || null,
        tier: identity.authInfo?.tier || 1,
        principalType: identity.authInfo?.principal_type || "User",
        rawAuthJson: extracted.rawAuthJson || undefined,
      },
    };
  },
};
