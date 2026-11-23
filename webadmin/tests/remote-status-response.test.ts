import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRemoteSummaryResponse } from "../src/lib/remote-status.ts";

const status = {
  schema: 1, mode: "read-only",
  server: { version: "beta-0.4.6", running: true, uptime_seconds: 130 },
  network: { active_connections: 3, accepted_connections: 20 },
  users: { online: 2, peak_online: 7 },
  chat: { received: 12, rejected: 1 },
};

test("remote browser accepts only safe aggregate fields and strips unknown private data", () => {
  const secret = "PRIVATE_UPSTREAM_IDENTITY";
  const parsed = parseRemoteSummaryResponse({
    ...status, secret, server: { ...status.server, secret },
    users: { ...status.users, nickname: secret },
    search: { queries: 6, results: 9, secret },
    transfers: { ctm: 4, rcm: 5, secret },
  });
  assert.deepEqual(parsed, {
    ...status,
    search: { queries: 6, results: 9 },
    transfers: { ctm: 4, rcm: 5 },
  });
  assert.ok(!JSON.stringify(parsed).includes(secret));
});

test("remote browser refuses malformed nested metrics instead of rendering or caching them", () => {
  const malformed = [
    null, [], { ...status, schema: 2 }, { ...status, mode: "write" },
    { ...status, server: { ...status.server, running: "false" } },
    { ...status, server: { ...status.server, version: { private: "value" } } },
    { ...status, network: { ...status.network, active_connections: "3" } },
    { ...status, users: { ...status.users, online: -1 } },
    { ...status, chat: { ...status.chat, received: Number.MAX_SAFE_INTEGER + 1 } },
    { ...status, chat: null },
    { ...status, search: { queries: "6", results: 9 } },
    { ...status, transfers: { ctm: 4, rcm: NaN } },
  ];
  for (const candidate of malformed) {
    assert.equal(parseRemoteSummaryResponse(candidate), null, JSON.stringify(candidate));
  }
  assert.deepEqual(parseRemoteSummaryResponse(status), status);
});
