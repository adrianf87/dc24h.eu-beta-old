import { parseDashboard } from "./dashboard.ts";
import type { DashboardSnapshot } from "./dashboard.ts";
import {parseMute} from "./mute.ts";
import type {MuteSnapshot} from "./mute.ts";
import {parseKick} from "./kick.ts";
import type {KickSnapshot} from "./kick.ts";
import { parseTransfers } from "./transfer-status.ts";
import type { TransferSnapshot } from "./transfer-status.ts";
import { parseSearch } from "./search-status.ts";
import type { SearchSnapshot } from "./search-status.ts";
import { parseConfiguration } from "./configuration.ts";
import type { StartupConfiguration } from "./configuration.ts";
export const WEBADMIN_VERSION = "beta-0.4.7";
export interface HubSnapshot {
  api_version: "v1";
  server: {
    name: "dc24h.eu";
    version: string;
    core_running: boolean;
    uptime_seconds: number;
  };
  network: {
    active_connections: number;
    accepted_connections: number;
    adc_frames: number;
    adcs_handshakes: number;
    security_rejected: number;
    security_closed: number;
    rejected_connections: number;
    closed_connections: number;
    received_bytes: number;
    sent_bytes: number;
    peak_connections: number;
  };
  users: { online: number; peak_online: number; successful_logins: number };
  chat: {
    received: number;
    public_dispatches: number;
    private_dispatches: number;
    rejected: number;
    flood_limited: number;
    errors: number;
    queued: number;
    unavailable: number;
    refused: number;
  };
  kick?: KickSnapshot;
  mute?: MuteSnapshot;
  dashboard?: DashboardSnapshot;
  search?: SearchSnapshot;
  transfers?: TransferSnapshot;
  database: { enabled: boolean };
  configuration?: StartupConfiguration;
  monitoring?: MonitoringSample;
}
// Independent, server-side read-only projection for the remote WebAdmin.
// Never validate/forward unrelated local-admin sections (configuration,
// monitoring, audit or user identities) through this interface.
export interface RemoteStatusProjection {
  server: { version: string; running: boolean; uptime_seconds: number };
  network: { active_connections: number; accepted_connections: number };
  users: { online: number; peak_online: number };
  chat: { received: number; rejected: number };
  search?: { queries: number; results: number };
  transfers?: { ctm: number; rcm: number };
}
export interface MonitoringSample {
  available: boolean;
  cpu_user_ms: string;
  cpu_system_ms: string;
  cpu_window_ms: string;
  cpu_delta_ms: string;
  rss_bytes: string;
  sessions_accepted: string;
  sessions_negotiating: string;
  sessions_identified: string;
  sessions_ready: string;
  sessions_closing: string;
  sessions_closed: string;
  sessions_created: string;
  sessions_completed: string;
  login_samples: string;
  login_last_ms: string;
  login_max_ms: string;
  reactor_samples: string;
  reactor_last_ms: string;
  reactor_max_ms: string;
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid API response");
  return value as Record<string, unknown>;
};
const counter = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid API counter");
  return value;
};
export function parseRemoteSummary(value: unknown): RemoteStatusProjection {
  const root = record(value);
  const server = record(root.server);
  const network = record(root.network);
  const users = record(root.users);
  const chat = record(root.chat);
  if (root.api_version !== "v1" || server.name !== "dc24h.eu" ||
    typeof server.version !== "string" ||
    !/^(?:alpha-\d{1,3}\.\d{1,3}\.\d{1,3}|beta-\d{1,3}\.\d{1,3}(?:\.\d{1,3})?)$/.test(server.version) ||
    typeof server.core_running !== "boolean") throw new Error("Invalid remote status schema");

  // Construct new objects from a fixed whitelist. Unknown upstream fields,
  // even nested or incorrectly typed private sections, are never included.
  const result: RemoteStatusProjection = {
    server: { version: server.version, running: server.core_running,
      uptime_seconds: counter(server.uptime_seconds) },
    network: { active_connections: counter(network.active_connections),
      accepted_connections: counter(network.accepted_connections) },
    users: { online: counter(users.online), peak_online: counter(users.peak_online) },
    chat: { received: counter(chat.received), rejected: counter(chat.rejected) },
  };
  if (root.search !== undefined) {
    const statistics = record(record(root.search).statistics);
    result.search = { queries: counter(statistics.queries_received),
      results: counter(statistics.results_received) };
  }
  if (root.transfers !== undefined) {
    const statistics = record(record(root.transfers).statistics);
    result.transfers = { ctm: counter(statistics.ctm_received),
      rcm: counter(statistics.rcm_received) };
  }
  return result;
}
const decimalText = /^(0|[1-9][0-9]{0,19})$/;
const monitoringKeys = [
  "cpu_user_ms",
  "cpu_system_ms",
  "cpu_window_ms",
  "cpu_delta_ms",
  "rss_bytes",
  "sessions_accepted",
  "sessions_negotiating",
  "sessions_identified",
  "sessions_ready",
  "sessions_closing",
  "sessions_closed",
  "sessions_created",
  "sessions_completed",
  "login_samples",
  "login_last_ms",
  "login_max_ms",
  "reactor_samples",
  "reactor_last_ms",
  "reactor_max_ms",
] as const;
function parseMonitoring(value: unknown): MonitoringSample {
  const sample = record(value);
  if (typeof sample.available !== "boolean") throw new Error("Invalid monitoring sample");
  const parsed = { available: sample.available } as MonitoringSample;
  for (const key of monitoringKeys) {
    const field = sample[key];
    if (typeof field !== "string" || !decimalText.test(field)) throw new Error("Invalid monitoring sample");
    parsed[key] = field;
  }
  return parsed;
}
export function parseSnapshot(value: unknown): HubSnapshot {
  const root = record(value),
    server = record(root.server),
    network = record(root.network),
    database = record(root.database),
    users = record(root.users),
    chat = record(root.chat);
  if (
    root.api_version !== "v1" ||
    server.name !== "dc24h.eu" ||
    typeof server.version !== "string" ||
    !/^(?:alpha-\d{1,3}\.\d{1,3}\.\d{1,3}|beta-\d{1,3}\.\d{1,3}(?:\.\d{1,3})?)$/.test(server.version) ||
    typeof server.core_running !== "boolean" ||
    typeof database.enabled !== "boolean"
  ) {
    throw new Error("Invalid API schema");
  }
  const configuration = root.configuration === undefined ? undefined : parseConfiguration(root.configuration);
  if(configuration && configuration.database.enabled !== database.enabled) throw new Error("Inconsistent database configuration");
  const kick = root.kick === undefined ? undefined : parseKick(root.kick);
  const mute = root.mute === undefined ? undefined : parseMute(root.mute);
  const search = root.search === undefined ? undefined : parseSearch(root.search);
  const transfers = root.transfers === undefined ? undefined : parseTransfers(root.transfers);
  const dashboard = root.dashboard === undefined ? undefined : parseDashboard(root.dashboard);
  const monitoring = root.monitoring === undefined ? undefined : parseMonitoring(root.monitoring);
  const uptime = counter(server.uptime_seconds);
  const networkValues = {
    active_connections: counter(network.active_connections),
    accepted_connections: counter(network.accepted_connections),
    adc_frames: counter(network.adc_frames),
    adcs_handshakes: counter(network.adcs_handshakes),
    security_rejected: counter(network.security_rejected),
    security_closed: counter(network.security_closed),
    rejected_connections: counter(network.rejected_connections),
    closed_connections: counter(network.closed_connections),
    received_bytes: counter(network.received_bytes),
    sent_bytes: counter(network.sent_bytes),
    peak_connections: counter(network.peak_connections),
  };
  const userValues = {
    online: counter(users.online),
    peak_online: counter(users.peak_online),
    successful_logins: counter(users.successful_logins),
  };
  const chatValues = {
    received: counter(chat.received),
    public_dispatches: counter(chat.public_dispatches),
    private_dispatches: counter(chat.private_dispatches),
    rejected: counter(chat.rejected),
    flood_limited: counter(chat.flood_limited),
    errors: counter(chat.errors),
    queued: counter(chat.queued),
    unavailable: counter(chat.unavailable),
    refused: counter(chat.refused),
  };
  if (dashboard) {
    const agree = (decimal: string, value: number) => {
      if (decimal !== String(value)) throw new Error("Inconsistent dashboard");
    };
    if (
      dashboard.core_running !== server.core_running ||
      dashboard.database_enabled !== database.enabled ||
      dashboard.uptime_seconds !== String(uptime)
    ) {
      throw new Error("Inconsistent dashboard");
    }
    agree(dashboard.connections_active, networkValues.active_connections);
    agree(dashboard.connections_peak, networkValues.peak_connections);
    agree(dashboard.connections_accepted, networkValues.accepted_connections);
    agree(dashboard.connections_rejected, networkValues.rejected_connections);
    agree(dashboard.connections_closed, networkValues.closed_connections);
    agree(dashboard.security_rejected, networkValues.security_rejected);
    agree(dashboard.security_closed, networkValues.security_closed);
    agree(dashboard.adc_frames, networkValues.adc_frames);
    agree(dashboard.adcs_handshakes, networkValues.adcs_handshakes);
    agree(dashboard.bytes_received, networkValues.received_bytes);
    agree(dashboard.bytes_sent, networkValues.sent_bytes);
    agree(dashboard.users_online, userValues.online);
    agree(dashboard.users_peak, userValues.peak_online);
    agree(dashboard.users_logins, userValues.successful_logins);
    agree(dashboard.chat_received, chatValues.received);
    agree(dashboard.chat_public, chatValues.public_dispatches);
    agree(dashboard.chat_private, chatValues.private_dispatches);
    agree(dashboard.chat_rejected, chatValues.rejected);
    agree(dashboard.chat_flood_limited, chatValues.flood_limited);
    if (!kick || !mute || !search || !transfers) throw new Error("Incomplete dashboard");
    if (
      dashboard.kicks_succeeded !== kick.succeeded ||
      dashboard.kicks_refused !== kick.refused ||
      dashboard.mutes_applied !== mute.applied ||
      dashboard.mutes_public_blocked !== mute.public_blocked ||
      dashboard.mutes_private_blocked !== mute.private_blocked
    ) {
      throw new Error("Inconsistent dashboard");
    }
    agree(dashboard.search_queries, search.statistics.queries_received);
    agree(dashboard.search_routed, search.statistics.queries_routed);
    agree(dashboard.search_rejected, search.statistics.queries_rejected);
    agree(dashboard.search_results, search.statistics.results_received);
    agree(dashboard.search_tracked, search.statistics.tracked_searches);
    agree(dashboard.transfers_ctm, transfers.statistics.ctm_received);
    agree(dashboard.transfers_rcm, transfers.statistics.rcm_received);
    agree(dashboard.transfers_peer_unsupported, transfers.statistics.peer_protocol_unsupported);
    agree(dashboard.transfers_peer_failed, transfers.statistics.peer_connection_failed);
  }
  // Normalize the allowlisted fields; never forward unknown data or credentials.
  return {
    api_version: "v1",
    ...(kick === undefined ? {} : { kick }),
    ...(mute === undefined ? {} : { mute }),
    ...(dashboard === undefined ? {} : { dashboard }),
    server: {
      name: "dc24h.eu",
      version: server.version,
      core_running: server.core_running,
      uptime_seconds: uptime,
    },
    network: networkValues,
    users: userValues,
    chat: chatValues,
    database: { enabled: database.enabled },
    ...(configuration === undefined ? {} : {configuration}),
    ...(search === undefined ? {} : { search }),
    ...(transfers === undefined ? {} : { transfers }),
    ...(monitoring === undefined ? {} : { monitoring }),
  };
}
export function duration(seconds: number): string {
  const days = Math.floor(seconds / 86400),
    hours = Math.floor(seconds / 3600) % 24,
    minutes = Math.floor(seconds / 60) % 60;
  return days
    ? `${days}d ${hours}h`
    : hours
      ? `${hours}h ${minutes}m`
      : minutes
        ? `${minutes}m ${seconds % 60}s`
        : `${seconds}s`;
}
