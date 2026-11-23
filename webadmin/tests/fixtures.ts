export const snapshot = {
  api_version: "v1",
  server: {
    name: "dc24h.eu",
    version: "beta-0.4.7",
    core_running: true,
    uptime_seconds: 3661,
  },
  network: {
    active_connections: 7,
    accepted_connections: 48,
    adc_frames: 144,
    adcs_handshakes: 3,
    security_rejected: 2,
    security_closed: 1,
    rejected_connections: 5,
    closed_connections: 41,
    received_bytes: 4096,
    sent_bytes: 8192,
    peak_connections: 9,
  },
  users: { online: 4, peak_online: 6, successful_logins: 23 },
  chat: { received: 12, public_dispatches: 5, private_dispatches: 3, rejected: 2, flood_limited: 1, errors: 1, queued: 21, unavailable: 0, refused: 0 },
  database: { enabled: false },
};

export const searchSnapshot = {
  statistics: { queries_received: 1, queries_routed: 2, queries_rejected: 3, queries_rate_limited: 4, queries_ignored: 5, query_errors: 6,
    query_queued: 7, query_unavailable: 8, query_refused: 9, query_canceled: 10,
    results_received: 11, results_routed: 12, results_rejected: 13, results_rate_limited: 14, results_recipient_limited: 15, result_errors: 16,
    result_queued: 17, result_unavailable: 18, result_refused: 19, tracked_searches: 1 },
  configuration: { queries_enabled: true, results_enabled: true, guest_queries: true, guest_results: true, require_result_token: false,
    max_active_searches: 4096, max_active_per_user: 8, search_lifetime_seconds: 60,
    query_rate: 10, query_burst: 32, query_byte_rate: 32768, query_byte_burst: 131072,
    result_rate: 64, result_burst: 128, result_byte_rate: 262144, result_byte_burst: 1048576 },
};

export const transferConfiguration = {
  ctm_enabled: true, rcm_enabled: true, guest_initiate: true, guest_receive: true,
  request_rate: 32, request_burst: 64, request_byte_rate: 131072, request_byte_burst: 262144,
  incoming_rate: 128, incoming_burst: 256, incoming_byte_rate: 524288, incoming_byte_burst: 1048576,
  allowed_protocols: "any" as const,
};
