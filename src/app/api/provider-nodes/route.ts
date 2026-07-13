import { NextResponse } from "next/server";
import { createProviderNode, getProviderNodes, getProviderNodesCount } from "@/models";
import {
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
  CLAUDE_CODE_COMPATIBLE_PREFIX,
} from "@/shared/constants/providers";
import { generateId } from "@/shared/utils";
import { isCcCompatibleProviderEnabled } from "@/shared/utils/featureFlags";
import { createProviderNodeSchema, paginationSchema } from "@/shared/validation/schemas";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";
import { validateProviderNodeBaseUrl } from "./urlGuard";

const OPENAI_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
};

const ANTHROPIC_COMPATIBLE_DEFAULTS = {
  baseUrl: "https://api.anthropic.com/v1",
};

function sanitizeAnthropicBaseUrl(baseUrl: string) {
  return (baseUrl || "")
    .trim()
    .replace(/\/$/, "")
    .replace(/\/messages(?:\?[^#]*)?$/i, "");
}

function sanitizeClaudeCodeCompatibleBaseUrl(baseUrl: string) {
  return (baseUrl || "")
    .trim()
    .replace(/\/$/, "")
    .replace(/\/(?:v\d+\/)?messages(?:\?[^#]*)?$/i, "");
}

export async function GET(request?: Request) {
  try {
    const url = new URL(request?.url ?? "http://localhost/api/provider-nodes");
    const raw = {
      offset: url.searchParams.get("offset") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    };
    const validation = validateBody(paginationSchema, raw);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { limit: parsedLimit, offset: parsedOffset } = validation.data;
    const limit =
      Number.isInteger(parsedLimit) && parsedLimit && parsedLimit > 0 ? parsedLimit : undefined;
    const offset =
      Number.isInteger(parsedOffset) && parsedOffset && parsedOffset > 0 ? parsedOffset : 0;

    const total = getProviderNodesCount();
    const nodes = await getProviderNodes({}, limit, offset);
    return NextResponse.json({
      nodes,
      total,
      ccCompatibleProviderEnabled: isCcCompatibleProviderEnabled(),
    });
  } catch (error) {
    console.log("Error fetching provider nodes:", error);
    return NextResponse.json({ error: "Failed to fetch provider nodes" }, { status: 500 });
  }
}

// POST /api/provider-nodes - Create provider node
export async function POST(request) {
  let rawBody;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          message: "Invalid request",
          details: [{ field: "body", message: "Invalid JSON body" }],
        },
      },
      { status: 400 }
    );
  }

  try {
    const validation = validateBody(createProviderNodeSchema, rawBody);
    if (isValidationFailure(validation)) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const {
      name,
      prefix,
      apiType,
      baseUrl,
      type,
      compatMode,
      chatPath,
      modelsPath,
      customHeaders,
      iconUrl,
    } = validation.data;

    // Determine type
    const nodeType = type || "openai-compatible";

    if (nodeType === "openai-compatible") {
      const resolvedBaseUrl = (baseUrl || OPENAI_COMPATIBLE_DEFAULTS.baseUrl).trim();
      const baseUrlError = validateProviderNodeBaseUrl(resolvedBaseUrl);
      if (baseUrlError) return baseUrlError;

      const node = await createProviderNode({
        id: `${OPENAI_COMPATIBLE_PREFIX}${apiType}-${generateId()}`,
        type: "openai-compatible",
        prefix: prefix.trim(),
        apiType,
        baseUrl: resolvedBaseUrl,
        name: name.trim(),
        chatPath: chatPath || null,
        modelsPath: modelsPath || null,
        iconUrl: iconUrl?.trim() || null,
        customHeaders: customHeaders || null,
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    if (nodeType === "anthropic-compatible") {
      if (compatMode === "cc" && !isCcCompatibleProviderEnabled()) {
        return NextResponse.json({ error: "CC Compatible provider is disabled" }, { status: 403 });
      }

      const rawBaseUrl = baseUrl || ANTHROPIC_COMPATIBLE_DEFAULTS.baseUrl;
      const sanitizedBaseUrl =
        compatMode === "cc"
          ? sanitizeClaudeCodeCompatibleBaseUrl(rawBaseUrl)
          : sanitizeAnthropicBaseUrl(rawBaseUrl);
      const baseUrlError = validateProviderNodeBaseUrl(sanitizedBaseUrl);
      if (baseUrlError) return baseUrlError;

      const node = await createProviderNode({
        id:
          compatMode === "cc"
            ? `${CLAUDE_CODE_COMPATIBLE_PREFIX}${generateId()}`
            : `${ANTHROPIC_COMPATIBLE_PREFIX}${generateId()}`,
        type: "anthropic-compatible",
        prefix: prefix.trim(),
        baseUrl: sanitizedBaseUrl,
        name: name.trim(),
        chatPath: chatPath || null,
        modelsPath: compatMode === "cc" ? null : modelsPath || null,
        iconUrl: iconUrl?.trim() || null,
        customHeaders: customHeaders || null,
      });
      return NextResponse.json({ node }, { status: 201 });
    }

    return NextResponse.json({ error: "Invalid provider node type" }, { status: 400 });
  } catch (error) {
    console.log("Error creating provider node:", error);
    return NextResponse.json({ error: "Failed to create provider node" }, { status: 500 });
  }
}
