import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSnapshot, parseRemoteSummary, duration } from "../src/lib/status.ts";
import { snapshot } from "./fixtures.ts";
test("accepts the C++ status contract and strips unrecognized fields", () => {
  assert.deepEqual(
    parseSnapshot({
      ...snapshot,
      secret: "never-forward",
      server: { ...snapshot.server, private_path: "never-forward" },
      users: { ...snapshot.users, cid: "never-forward" },
      network: { ...snapshot.network, peer_ip: "never-forward" },
      chat: { ...snapshot.chat, text: "never-forward", sid: "never-forward" },
    }),
    snapshot,
  );
  assert.equal(duration(3661), "1h 1m");
  assert.equal(duration(86400), "1d 0h");
  assert.equal(duration(0), "0s");
});
test("rejects incompatible schema, absent counters and imprecise or unsafe numbers", () => {
  for (const input of [
    null,
    [],
    {},
    { ...snapshot, api_version: "v2" },
    { ...snapshot, server: { ...snapshot.server, version: "<script>" } },
    { ...snapshot, database: { enabled: 1 } },
    ...[
      -1,
      NaN,
      Infinity,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      "7",
      undefined,
    ].map((active_connections) => ({
      ...snapshot,
      network: { ...snapshot.network, active_connections },
    })),
  ]) {
    assert.throws(() => parseSnapshot(input));
  }
});

test("validates every new statistics counter without fabricating absent values", () => {
  for (const group of ["network", "users", "chat"] as const) {
    for (const field of Object.keys(snapshot[group])) {
      for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined, "0"]) {
        assert.throws(() => parseSnapshot({
          ...snapshot, [group]: { ...snapshot[group], [field]: value },
        }));
      }
    }
  }
  assert.throws(() => parseSnapshot({ ...snapshot, users: undefined }));
});

test("search extension is allowlisted and older snapshots remain compatible", async () => {
  const { searchSnapshot } = await import("./fixtures.ts");
  const parsed = parseSnapshot({ ...snapshot, search: { ...searchSnapshot,
    token: "SearchPrivate", statistics: { ...searchSnapshot.statistics, filename: "SearchPrivate" },
    configuration: { ...searchSnapshot.configuration, credential: "SearchPrivate" } } });
  assert.deepEqual(parsed.search, searchSnapshot);
  assert.ok(!JSON.stringify(parsed).includes("SearchPrivate"));
  assert.equal(parseSnapshot(snapshot).search, undefined);
});
test("search counters and settings reject malformed or unsafe values", async () => {
  const { searchSnapshot } = await import("./fixtures.ts");
  for (const key of Object.keys(searchSnapshot.statistics)) {
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined, "0"]) {
      assert.throws(() => parseSnapshot({ ...snapshot, search: { ...searchSnapshot, statistics: { ...searchSnapshot.statistics, [key]: value } } }));
    }
  }
  for (const change of [{ queries_enabled: "true" }, { max_active_searches: 0 }, { max_active_searches: 1, max_active_per_user: 2 },
    { search_lifetime_seconds: 3601 }, { query_byte_burst: 16383 }, { result_rate: 1000001 }, { result_byte_rate: 0 }]) {
    assert.throws(() => parseSnapshot({ ...snapshot, search: { ...searchSnapshot, configuration: { ...searchSnapshot.configuration, ...change } } }));
  }
  for (const value of [null, {}, { statistics: searchSnapshot.statistics }]) assert.throws(() => parseSnapshot({ ...snapshot, search: value }));
});

const monitoring = {
  available: true,
  cpu_user_ms: "1024",
  cpu_system_ms: "256",
  cpu_window_ms: "1000",
  cpu_delta_ms: "40",
  rss_bytes: "1048576",
  sessions_accepted: "1",
  sessions_negotiating: "0",
  sessions_identified: "2",
  sessions_ready: "4",
  sessions_closing: "0",
  sessions_closed: "0",
  sessions_created: "9",
  sessions_completed: "3",
  login_samples: "5",
  login_last_ms: "40",
  login_max_ms: "250",
  reactor_samples: "8",
  reactor_last_ms: "1",
  reactor_max_ms: "12",
};

test("monitoring sample is optional, allowlisted and decimal", () => {
  assert.equal(parseSnapshot(snapshot).monitoring, undefined);
  const parsed = parseSnapshot({ ...snapshot, monitoring: { ...monitoring, cmdline: "/secret" } });
  assert.deepEqual(parsed.monitoring, monitoring);
  assert.ok(!JSON.stringify(parsed).includes("/secret"));
  for (const value of [null, {}, { ...monitoring, available: "yes" }, { ...monitoring, rss_bytes: "01" }, { ...monitoring, cpu_user_ms: "-1" }]) {
    assert.throws(() => parseSnapshot({ ...snapshot, monitoring: value }));
  }
});

test("remote status projection includes only reviewed aggregate counters", () => {
  const minimal = {
    api_version: "v1", server: snapshot.server,
    network: { active_connections: 7, accepted_connections: 48 },
    users: { online: 4, peak_online: 6 },
    chat: { received: 12, rejected: 2 },
  };
  const expected = {
    server: { version: "beta-0.4.6", running: true, uptime_seconds: 3661 },
    network: { active_connections: 7, accepted_connections: 48 },
    users: { online: 4, peak_online: 6 },
    chat: { received: 12, rejected: 2 },
  };
  assert.deepEqual(parseRemoteSummary(minimal), expected);
  const malicious = {
    ...minimal, secret: "SECRET_TOKEN", audit: [{ cid: "PRIVATE_CID" }],
    private_blob: "DO_NOT_FORWARD".repeat(4000),
    server: { ...minimal.server, private_path: "/private/api.sock" },
    network: { ...minimal.network, ip: "192.0.2.1" },
    users: { ...minimal.users, nick: "PRIVATE_NICK" },
    chat: { ...minimal.chat, text: "PRIVATE_MESSAGE" },
    configuration: { token: "SECRET_TOKEN", database: null },
    dashboard: { account: "PRIVATE_ACCOUNT" }, monitoring: { credentials: "SECRET_TOKEN" },
    search: { statistics: { queries_received: 9, results_received: 11, cid: "PRIVATE_CID" }, configuration: "changed-upstream-format" },
    transfers: { statistics: { ctm_received: 13, rcm_received: 17, ip: "192.0.2.1" }, configuration: { token: "SECRET_TOKEN" } },
  };
  const sanitized = parseRemoteSummary(malicious);
  assert.deepEqual(sanitized, { ...expected, search: { queries: 9, results: 11 }, transfers: { ctm: 13, rcm: 17 } });
  for (const needle of ["SECRET_TOKEN", "PRIVATE_CID", "PRIVATE_ACCOUNT", "PRIVATE_NICK", "PRIVATE_MESSAGE", "/private/api.sock", "192.0.2.1", "DO_NOT_FORWARD"]) {
    assert.ok(!JSON.stringify(sanitized).includes(needle), needle);
  }
});

test("remote status rejects malformed mandatory aggregates and optional public counters", () => {
  const good = { ...snapshot, server: { ...snapshot.server, version: "beta-0.4.6" } };
  for (const corrupt of [
    null, [], {}, { ...good, api_version: "v2" }, { ...good, server: undefined },
    { ...good, server: { ...good.server, version: "<script>" } },
    { ...good, server: { ...good.server, core_running: "yes" } },
    { ...good, network: undefined }, { ...good, users: null },
    { ...good, search: null }, { ...good, search: { statistics: { queries_received: 1 } } },
    { ...good, transfers: { statistics: { ctm_received: 1, rcm_received: "2" } } },
  ]) assert.throws(() => parseRemoteSummary(corrupt));
  for (const part of ["network", "users", "chat"] as const) {
    const field = part === "network" ? "active_connections" : part === "users" ? "online" : "received";
    for (const value of [null, -1, 1.2, "2", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
      assert.throws(() => parseRemoteSummary({ ...good, [part]: { ...good[part], [field]: value } }));
    }
  }
});
