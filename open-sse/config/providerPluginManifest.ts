import type { RegistryEntry, RegistryModel } from "./providers/shared.ts";

export type ProviderPluginCapability =
  | "apikey"
  | "custom-executor"
  | "oauth"
  | "passthrough-models"
  | "responses"
  | "sidecar-candidate";

export interface ProviderPluginModel {
  id: string;
  name: string;
  contextLength?: number;
  maxOutputTokens?: number;
  toolCalling?: boolean;
  supportsReasoning?: boolean;
  supportsVision?: boolean;
  unsupportedParams?: readonly string[];
  targetFormat?: string;
}

export interface ProviderPluginManifestEntry {
  id: string;
  alias?: string;
  format: string;
  executor: string;
  auth: {
    type: string;
    header: string;
    prefix?: string;
  };
  endpoints: {
    baseUrl?: string;
    baseUrls?: string[];
    responsesBaseUrl?: string;
    chatPath?: string;
    modelsUrl?: string;
  };
  capabilities: ProviderPluginCapability[];
  passthroughModels: boolean;
  defaultContextLength?: number;
  timeoutMs?: number;
  models: ProviderPluginModel[];
  sidecar: {
    eligible: boolean;
    reasons: string[];
  };
}

export interface ProviderPluginManifest {
  schemaVersion: 1;
  generatedFrom: "open-sse/config/providers";
  providers: ProviderPluginManifestEntry[];
}

const SIDECAR_COMPATIBLE_EXECUTORS = new Set(["default"]);

const LOCAL_SERVICE_DEFAULTS = {
  "9router": {
    host: "127.0.0.1",
    port: 20130,
  },
  cliproxyapi: {
    host: "127.0.0.1",
    port: 8317,
  },
} as const;

function toIntPort(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? "", 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function resolveLocalServiceBaseUrl(service: keyof typeof LOCAL_SERVICE_DEFAULTS): string {
  const defaults = LOCAL_SERVICE_DEFAULTS[service];
  const hostEnv = service === "9router" ? process.env.NINEROUTER_HOST : process.env.CLIPROXYAPI_HOST;
  const portEnv = service === "9router" ? process.env.NINEROUTER_PORT : process.env.CLIPROXYAPI_PORT;
  const host = hostEnv || defaults.host;
  const port = toIntPort(portEnv, defaults.port);
  return `http://${host}:${port}`;
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

function mapModel(model: RegistryModel): ProviderPluginModel {
  return compactObject({
    id: model.id,
    name: model.name,
    contextLength: model.contextLength,
    maxOutputTokens: model.maxOutputTokens,
    toolCalling: model.toolCalling,
    supportsReasoning: model.supportsReasoning,
    supportsVision: model.supportsVision,
    unsupportedParams: model.unsupportedParams,
    targetFormat: model.targetFormat,
  }) as ProviderPluginModel;
}

function sidecarEligibility(entry: RegistryEntry): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (!SIDECAR_COMPATIBLE_EXECUTORS.has(entry.executor)) {
    reasons.push(`custom executor: ${entry.executor}`);
  }
  if (entry.authType !== "apikey" && entry.authType !== "optional" && entry.authType !== "none") {
    reasons.push(`auth type requires TS handling: ${entry.authType}`);
  }
  if (!entry.baseUrl && !entry.baseUrls?.length && !entry.responsesBaseUrl) {
    reasons.push("no static upstream endpoint");
  }
  if (typeof entry.urlBuilder === "function") {
    reasons.push("dynamic URL builder");
  }
  if (entry.oauth) {
    reasons.push("oauth metadata");
  }
  if (entry.poolConfig) {
    reasons.push("session pool config");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

function capabilitiesFor(entry: RegistryEntry, eligible: boolean): ProviderPluginCapability[] {
  const capabilities = new Set<ProviderPluginCapability>();

  if (entry.authType === "apikey" || entry.authType === "optional") {
    capabilities.add("apikey");
  }
  if (entry.authType === "oauth" || entry.oauth) {
    capabilities.add("oauth");
  }
  if (entry.responsesBaseUrl) {
    capabilities.add("responses");
  }
  if (entry.passthroughModels) {
    capabilities.add("passthrough-models");
  }
  if (entry.executor !== "default") {
    capabilities.add("custom-executor");
  }
  if (eligible) {
    capabilities.add("sidecar-candidate");
  }

  return [...capabilities].sort();
}

function createServicePluginManifestEntries(): ProviderPluginManifestEntry[] {
  const nineRouterBaseUrl = resolveLocalServiceBaseUrl("9router");
  const cliproxyapiBaseUrl = resolveLocalServiceBaseUrl("cliproxyapi");

  return [
    {
      id: "9router",
      format: "openai",
      executor: "9router",
      auth: {
        type: "apikey",
        header: "bearer",
      },
      endpoints: {
        baseUrl: `${nineRouterBaseUrl}/v1/chat/completions`,
        baseUrls: [
          `${nineRouterBaseUrl}/v1/chat/completions`,
          `${nineRouterBaseUrl}/v1/messages`,
        ],
        responsesBaseUrl: `${nineRouterBaseUrl}/v1/responses`,
        modelsUrl: `${nineRouterBaseUrl}/v1/models`,
      },
      capabilities: ["apikey", "custom-executor"],
      passthroughModels: false,
      models: [],
      sidecar: {
        eligible: false,
        reasons: ["local service backend: nine-router custom executor"],
      },
    },
    {
      id: "cliproxyapi",
      format: "openai",
      executor: "cliproxyapi",
      auth: {
        type: "apikey",
        header: "bearer",
      },
      endpoints: {
        baseUrl: `${cliproxyapiBaseUrl}/v1/chat/completions`,
        baseUrls: [
          `${cliproxyapiBaseUrl}/v1/chat/completions`,
          `${cliproxyapiBaseUrl}/v1/messages`,
        ],
        responsesBaseUrl: `${cliproxyapiBaseUrl}/v1/responses`,
        modelsUrl: `${cliproxyapiBaseUrl}/v1/models`,
        chatPath: "/v1/messages",
      },
      capabilities: ["apikey", "custom-executor"],
      passthroughModels: false,
      models: [],
      sidecar: {
        eligible: false,
        reasons: ["local service backend: CLIProxyAPI custom executor"],
      },
    },
  ];
}

export function createProviderPluginManifestEntry(
  entry: RegistryEntry,
): ProviderPluginManifestEntry {
  const sidecar = sidecarEligibility(entry);

  return {
    id: entry.id,
    ...(entry.alias ? { alias: entry.alias } : {}),
    format: entry.format,
    executor: entry.executor,
    auth: compactObject({
      type: entry.authType,
      header: entry.authHeader,
      prefix: entry.authPrefix,
    }) as ProviderPluginManifestEntry["auth"],
    endpoints: compactObject({
      baseUrl: entry.baseUrl,
      baseUrls: entry.baseUrls,
      responsesBaseUrl: entry.responsesBaseUrl,
      chatPath: entry.chatPath,
      modelsUrl: entry.modelsUrl,
    }) as ProviderPluginManifestEntry["endpoints"],
    capabilities: capabilitiesFor(entry, sidecar.eligible),
    passthroughModels: entry.passthroughModels === true,
    ...(typeof entry.defaultContextLength === "number"
      ? { defaultContextLength: entry.defaultContextLength }
      : {}),
    ...(typeof entry.timeoutMs === "number" ? { timeoutMs: entry.timeoutMs } : {}),
    models: (entry.models ?? []).map(mapModel),
    sidecar,
  };
}

export function generateProviderPluginManifestFromRegistry(
  registry: Record<string, RegistryEntry>,
): ProviderPluginManifest {
  const serviceEntries = createServicePluginManifestEntries();

  const manifestEntries: ProviderPluginManifestEntry[] = Object.values(registry)
    .map(createProviderPluginManifestEntry)
    .filter((entry) =>
      !serviceEntries.some((service) => service.id === entry.id)
    );

  for (const serviceEntry of serviceEntries) {
    manifestEntries.push(serviceEntry);
  }

  return {
    schemaVersion: 1,
    generatedFrom: "open-sse/config/providers",
    providers: manifestEntries.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function getProviderPluginManifestEntryFromRegistry(
  registry: Record<string, RegistryEntry>,
  provider: string,
): ProviderPluginManifestEntry | null {
  const entry =
    registry[provider] ||
    Object.values(registry).find((candidate) => candidate.alias === provider);

  return entry ? createProviderPluginManifestEntry(entry) : null;
}
