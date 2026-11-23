import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { KICK_COUNTERS } from "../src/lib/kick.ts";
import { MUTE_COUNTERS } from "../src/lib/mute.ts";
import { TRANSFER_COUNTERS } from "../src/lib/transfer-status.ts";
import { searchSnapshot } from "./fixtures.ts";

const base = {
  api_version: "v1",
  server: { name: "dc24h.eu", version: "beta-0.4.7", core_running: true, uptime_seconds: 3661 },
  network: {
    active_connections: 7, accepted_connections: 48, adc_frames: 144, adcs_handshakes: 3,
    security_rejected: 2, security_closed: 1, rejected_connections: 5, closed_connections: 41,
    received_bytes: 4096, sent_bytes: 8192, peak_connections: 9,
  },
  users: { online: 4, peak_online: 6, successful_logins: 23 },
  chat: { received: 12, public_dispatches: 5, private_dispatches: 3, rejected: 2, flood_limited: 1, errors: 1, queued: 21, unavailable: 0, refused: 0 },
  database: { enabled: false },
};
const kick = Object.fromEntries(KICK_COUNTERS.map((key) => [key, key === "succeeded" ? "18446744073709551615" : "0"]));
const mute = Object.fromEntries(MUTE_COUNTERS.map((key) => [key, "0"]));
mute.applied = "7";
mute.public_blocked = "8";
mute.private_blocked = "9";
const dashboard = {
  schema: 1, core_running: true, database_enabled: false, uptime_seconds: "3661",
  users_online: "4", users_peak: "6", users_logins: "23",
  connections_active: "7", connections_peak: "9", connections_accepted: "48", connections_rejected: "5", connections_closed: "41",
  security_rejected: "2", security_closed: "1", adc_frames: "144", adcs_handshakes: "3", bytes_received: "4096", bytes_sent: "8192",
  chat_received: "12", chat_public: "5", chat_private: "3", chat_rejected: "2", chat_flood_limited: "1",
  search_queries: "1", search_routed: "2", search_rejected: "3", search_results: "11", search_tracked: "1",
  transfers_ctm: "1", transfers_rcm: "11", transfers_peer_unsupported: "21", transfers_peer_failed: "22",
  kicks_succeeded: "18446744073709551615", kicks_refused: "0", mutes_applied: "7", mutes_public_blocked: "8", mutes_private_blocked: "9",
};
const full = {
  ...base,
  kick,
  mute,
  search: searchSnapshot,
  transfers: { statistics: Object.fromEntries(TRANSFER_COUNTERS.map((key, index) => [key, index + 1])) },
  dashboard,
};

test("dashboard stays unavailable until the summary is published", async ({ page }) => {
  await page.goto("/#dashboard");
  await expect(page.getByRole("heading", { name: "Hub dashboard", exact: true })).toBeVisible();
  await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
  await expect(page.getByTestId("hub-dashboard")).toContainText("does not publish the dashboard summary");
  await expect(page.getByRole("button", { name: "Export snapshot" })).toBeDisabled();
  await page.route("**/admin-api/v1/status", (route) => route.fulfill({ json: base }));
  await page.getByRole("button", { name: "Refresh now" }).click();
  await expect(page.getByText("API connected", { exact: true })).toBeVisible();
  await expect(page.getByTestId("hub-dashboard")).toContainText("does not publish the dashboard summary");
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hub overview", exact: true })).toBeVisible();
  await expect(page.getByTestId("user-statistics").locator(".metric-value")).toHaveText(["4", "6", "23", "41"]);
});

test("dashboard renders the fixed summary, keeps secrets out of export and supports Polish mobile navigation", async ({ page }) => {
  await page.route("**/admin-api/v1/status", (route) => route.fulfill({
    json: { ...full, dashboard: { ...dashboard, password: "DashboardSecret" }, nickname: "DashboardSecret" },
  }));
  await page.goto("/#dashboard");
  await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("dashboard-hub").locator(".metric-value")).toHaveText(["Running", "Disabled", "1h 1m"]);
  await expect(page.getByTestId("dashboard-users").locator(".metric-value")).toHaveText(["4", "6", "23"]);
  await expect(page.getByTestId("dashboard-network").locator(".metric-value").nth(9)).toHaveText("4,096");
  await expect(page.getByTestId("dashboard-search").locator(".metric-value")).toHaveText(["1", "2", "3", "11", "1"]);
  const kicked = await page.evaluate(() => new Intl.NumberFormat("en-US").format(18446744073709551615n));
  await expect(page.getByTestId("dashboard-moderation").locator(".metric-value").first()).toHaveText(kicked);
  await expect(page.getByText("DashboardSecret")).toHaveCount(0);
  await expect(page.getByText("Current stored windows, not a cumulative event count")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export snapshot", exact: true }).click();
  const exported = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(exported.dashboard.kicks_succeeded).toBe("18446744073709551615");
  expect(JSON.stringify(exported)).not.toContain("DashboardSecret");
  await page.getByRole("link", { name: "Open details", exact: true }).nth(2).click();
  await expect(page).toHaveURL(/#chat$/);
  await expect(page.getByRole("heading", { name: "Chat statistics", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("combobox").selectOption("pl");
  await page.getByRole("button", { name: "Otwórz nawigację", exact: true }).click();
  await page.getByRole("link", { name: "Panel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Panel główny", exact: true })).toBeVisible();
  const online = await page.evaluate(() => new Intl.NumberFormat("pl-PL").format(4));
  await expect(page.getByTestId("dashboard-users").locator(".metric-value").first()).toHaveText(online);
  await expect(page.getByRole("button", { name: "Otwórz nawigację", exact: true })).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("a malformed dashboard clears the snapshot", async ({ page }) => {
  await page.route("**/admin-api/v1/status", (route) => route.fulfill({
    json: { ...full, dashboard: { ...dashboard, bytes_received: 4096 } },
  }));
  await page.goto("/#dashboard");
  await expect(page.getByText("Connection lost", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export snapshot" })).toBeDisabled();
  await expect(page.getByTestId("hub-dashboard")).toContainText("does not publish the dashboard summary");
});

const monitoring = {
  available: true,
  cpu_user_ms: "1024", cpu_system_ms: "256", cpu_window_ms: "1000", cpu_delta_ms: "40", rss_bytes: "1048576",
  sessions_accepted: "1", sessions_negotiating: "0", sessions_identified: "2", sessions_ready: "4",
  sessions_closing: "0", sessions_closed: "0", sessions_created: "9", sessions_completed: "3",
  login_samples: "5", login_last_ms: "40", login_max_ms: "250",
  reactor_samples: "8", reactor_last_ms: "1", reactor_max_ms: "12",
};

test("dashboard shows the process sample without treating it as a host history", async ({ page }) => {
  await page.route("**/admin-api/v1/status", (route) => route.fulfill({
    json: { ...full, monitoring: { ...monitoring, cmdline: "ProcessSecret" } },
  }));
  await page.goto("/#dashboard");
  const values = page.getByTestId("dashboard-process").locator(".metric-value");
  await expect(values.nth(0)).toHaveText("1,024");
  await expect(values.nth(4)).toHaveText("1.0 MiB");
  await expect(values.nth(12)).toHaveText("40 ms");
  await expect(values.nth(13)).toHaveText("250 ms");
  await expect(page.getByText("ProcessSecret")).toHaveCount(0);
  await expect(page.getByText("One sample of this process. Not a host total and not a stored history.").first()).toBeVisible();
});
