export const ANTIGRAVITY_CLIENT_PROFILE_VALUES = ["ide", "cli"] as const;

export type AntigravityClientProfile = (typeof ANTIGRAVITY_CLIENT_PROFILE_VALUES)[number];

export const DEFAULT_ANTIGRAVITY_CLIENT_PROFILE: AntigravityClientProfile = "ide";

export type AntigravityClientProfileSetting = AntigravityClientProfile;

export const ANTIGRAVITY_CLIENT_PROFILE_OPTIONS: Array<{
  value: AntigravityClientProfileSetting;
  labelKey: "antigravityClientProfileIde" | "antigravityClientProfileCli";
}> = [
  { value: "ide", labelKey: "antigravityClientProfileIde" },
  { value: "cli", labelKey: "antigravityClientProfileCli" },
];

export function normalizeAntigravityClientProfile(value: unknown): AntigravityClientProfile {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "ide" || normalized === "cli") {
      return normalized;
    }
  }
  return DEFAULT_ANTIGRAVITY_CLIENT_PROFILE;
}

export const normalizeAntigravityClientProfileSetting = normalizeAntigravityClientProfile;
