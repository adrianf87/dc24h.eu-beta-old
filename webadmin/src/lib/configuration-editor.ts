// Only the four non-secret settings exposed by the local maintenance API.
export const EDITABLE_SETTINGS = ["network_max_connections", "network_idle_timeout", "logging_level", "general_language"] as const;
export type EditableSetting = typeof EDITABLE_SETTINGS[number];
export type EditableValues = Record<EditableSetting, string>;
export type ConfigurationFailureNotice = "configEditAuth" | "configEditStale" | "configEditRejected" |
  "configEditUnknown" | "configEditUnavailable";

// A missing or malformed response to a write/restore does not prove the
// operation failed: the INI may already have been atomically replaced.
export function configurationFailureNotice(error: unknown, mutation: boolean): ConfigurationFailureNotice {
  const key = error instanceof Error ? error.message : "";
  if (key === "configEditAuth" || key === "configEditStale" || key === "configEditRejected" ||
      key === "configEditUnknown") return key;
  return mutation ? "configEditUnknown" : "configEditUnavailable";
}
export interface ConfigurationReview {
  schema: 1;
  maintenance: true;
  read_only: true;
  restart_required: true;
  active_scope: "maintenance_process";
  hub_active_available: false;
  revision: string;
  saved: EditableValues;
  active: EditableValues;
  matches_active: boolean;
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const revision = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const positive = (value: string, maximum: number) => {
  if (!/^[1-9][0-9]{0,4}$/.test(value)) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum;
};

export function validSetting(key: EditableSetting, value: string): boolean {
  if (key === "network_max_connections") return positive(value, 65535);
  if (key === "network_idle_timeout") return positive(value, 86400);
  if (key === "logging_level") return ["info", "warning", "error", "off"].includes(value);
  return value === "us" || value === "pl";
}

function settings(value: unknown): EditableValues {
  if (!object(value)) throw new Error("Invalid configuration settings");
  const entries = EDITABLE_SETTINGS.map(key => {
    const item = value[key];
    if (typeof item !== "string" || !validSetting(key, item)) throw new Error("Invalid configuration setting");
    return [key, item] as const;
  });
  return Object.fromEntries(entries) as EditableValues;
}

export function parseConfigurationReview(value: unknown): ConfigurationReview {
  if (!object(value) || value.schema !== 1 || value.maintenance !== true || value.read_only !== true ||
      value.restart_required !== true || value.active_scope !== "maintenance_process" ||
      value.hub_active_available !== false || !revision(value.revision) || typeof value.matches_active !== "boolean") {
    throw new Error("Invalid configuration review");
  }
  const saved = settings(value.saved);
  const active = settings(value.active);
  const matches = EDITABLE_SETTINGS.every(key => saved[key] === active[key]);
  if (matches !== value.matches_active) throw new Error("Inconsistent configuration review");
  return {schema: 1, maintenance: true, read_only: true, restart_required: true,
    active_scope: "maintenance_process", hub_active_available: false,
    revision: value.revision, saved, active, matches_active: matches};
}

export function configurationChanges(saved: EditableValues, draft: EditableValues): Partial<EditableValues> {
  const changes: Partial<EditableValues> = {};
  for (const key of EDITABLE_SETTINGS) {
    if (!validSetting(key, draft[key])) throw new Error("Invalid proposed setting");
    if (saved[key] !== draft[key]) changes[key] = draft[key];
  }
  return changes;
}

export function configurationForm(revisionValue: string, changes: Partial<EditableValues>): URLSearchParams {
  if (!revision(revisionValue)) throw new Error("Invalid configuration revision");
  const body = new URLSearchParams({revision: revisionValue});
  let count = 0;
  for (const key of EDITABLE_SETTINGS) {
    const value = changes[key];
    if (value === undefined) continue;
    if (!validSetting(key, value)) throw new Error("Invalid proposed setting");
    body.set(key, value);
    count++;
  }
  if (!count) throw new Error("No changes");
  return body;
}

export function parseConfigurationValidation(value: unknown): {valid: boolean; written: false; restart_required: true} {
  if (!object(value) || typeof value.valid !== "boolean" || value.written !== false || value.restart_required !== true) {
    throw new Error("Invalid configuration validation");
  }
  return {valid: value.valid, written: false, restart_required: true};
}

export function parseConfigurationWrite(value: unknown): {revision: string; written: true; backup_available: true; restart_required: true} {
  if (!object(value) || value.written !== true || value.restart_required !== true ||
      value.backup_available !== true || !revision(value.revision)) {
    throw new Error("Invalid configuration write result");
  }
  return {revision: value.revision, written: true, backup_available: true, restart_required: true};
}
