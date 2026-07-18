const ANTIGRAVITY_IDE_RELEASE_FEED_URL =
  "https://antigravity-auto-updater-974169037036.us-central1.run.app/releases";
const ANTIGRAVITY_CLI_RELEASE_URL =
  "https://api.github.com/repos/google-antigravity/antigravity-cli/releases/latest";

export const ANTIGRAVITY_VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const ANTIGRAVITY_VERSION_FETCH_TIMEOUT_MS = 5_000;
export const ANTIGRAVITY_IDE_FALLBACK_VERSION = "2.1.1";
export const ANTIGRAVITY_CLI_FALLBACK_VERSION = "1.1.1";

type VersionCache = {
  fetchedAt: number;
  version: string;
};

type ProductVersionState = {
  cache: VersionCache | null;
  inFlight: Promise<string> | null;
};

type FetchLike = typeof fetch;
type VersionParser = (payload: unknown) => string | null;

const ideState: ProductVersionState = { cache: null, inFlight: null };
const cliState: ProductVersionState = { cache: null, inFlight: null };

function normalizeVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^v/i, "");
  const match = trimmed.match(/^(\d+\.\d+\.\d+)\b/);
  return match ? match[1] : null;
}

async function fetchJsonWithTimeout(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANTIGRAVITY_VERSION_FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "OmniRoute-AntigravityVersion/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Version source ${url} returned ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseIdeReleaseFeed(payload: unknown): string | null {
  if (!Array.isArray(payload)) return null;

  for (const entry of payload) {
    const version = normalizeVersion((entry as { version?: unknown })?.version);
    if (version) return version;
  }

  return null;
}

function parseCliRelease(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const release = payload as { name?: unknown; tag_name?: unknown };
  return normalizeVersion(release.tag_name ?? release.name);
}

async function resolveProductVersion(
  state: ProductVersionState,
  fallbackVersion: string,
  sourceUrl: string,
  parsePayload: VersionParser,
  fetchImpl: FetchLike
): Promise<string> {
  const now = Date.now();
  if (state.cache && now - state.cache.fetchedAt < ANTIGRAVITY_VERSION_CACHE_TTL_MS) {
    return state.cache.version;
  }

  if (state.inFlight) {
    return state.inFlight;
  }

  state.inFlight = (async () => {
    let resolved: string | null = null;
    try {
      resolved = parsePayload(await fetchJsonWithTimeout(fetchImpl, sourceUrl));
    } catch {
      resolved = null;
    }

    if (!resolved) {
      return state.cache?.version ?? fallbackVersion;
    }

    state.cache = {
      fetchedAt: Date.now(),
      version: resolved,
    };
    return resolved;
  })();

  try {
    return await state.inFlight;
  } finally {
    state.inFlight = null;
  }
}

function seedVersionCache(state: ProductVersionState, version: string, fetchedAt: number): void {
  const normalized = normalizeVersion(version);
  if (!normalized) {
    throw new TypeError(`Invalid Antigravity version: ${version}`);
  }
  state.cache = { fetchedAt, version: normalized };
}

export function resolveAntigravityIdeVersion(fetchImpl: FetchLike = fetch): Promise<string> {
  return resolveProductVersion(
    ideState,
    ANTIGRAVITY_IDE_FALLBACK_VERSION,
    ANTIGRAVITY_IDE_RELEASE_FEED_URL,
    parseIdeReleaseFeed,
    fetchImpl
  );
}

export function resolveAntigravityCliVersion(fetchImpl: FetchLike = fetch): Promise<string> {
  return resolveProductVersion(
    cliState,
    ANTIGRAVITY_CLI_FALLBACK_VERSION,
    ANTIGRAVITY_CLI_RELEASE_URL,
    parseCliRelease,
    fetchImpl
  );
}

export function getCachedAntigravityIdeVersion(): string {
  return ideState.cache?.version ?? ANTIGRAVITY_IDE_FALLBACK_VERSION;
}

export function getCachedAntigravityCliVersion(): string {
  return cliState.cache?.version ?? ANTIGRAVITY_CLI_FALLBACK_VERSION;
}

export function seedAntigravityIdeVersionCache(version: string, fetchedAt = Date.now()): void {
  seedVersionCache(ideState, version, fetchedAt);
}

export function seedAntigravityCliVersionCache(version: string, fetchedAt = Date.now()): void {
  seedVersionCache(cliState, version, fetchedAt);
}

export function clearAntigravityVersionCaches(): void {
  ideState.cache = null;
  ideState.inFlight = null;
  cliState.cache = null;
  cliState.inFlight = null;
}
