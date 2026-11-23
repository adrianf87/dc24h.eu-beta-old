import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
let secret = "";
for await (const chunk of process.stdin) secret += chunk;
secret = secret.trim();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let credentialLeak = false;
  page.on("request", (request) => {
    if (request.headers().authorization?.includes(secret))
      credentialLeak = true;
  });
  await page.goto(process.argv[2]);
  await expect(page.getByText("API connected", { exact: true })).toBeVisible();
  await expect(page.getByText("beta-0.4.7", { exact: true })).toHaveCount(2);
  await expect(page.locator(".metric-value").nth(1)).toHaveText("16");
  assert.ok(
    Number(await page.locator(".metric-value").first().textContent()) >= 2,
  );
  const status = await page.request.get(
    new URL("admin-api/v1/status", process.argv[2]).href,
  );
  assert.equal(status.status(), 200);
  const snapshot = await status.json();
  assert.deepEqual(snapshot.users, { online: 2, peak_online: 2, successful_logins: 2 });
  assert.equal(snapshot.transfers.statistics.ctm_received, 1);
  assert.equal(snapshot.transfers.statistics.ctm_routed, 1);
  assert.equal(snapshot.transfers.statistics.ctm_queued, 2);
  assert.equal(snapshot.transfers.statistics.rcm_received, 1);
  assert.equal(snapshot.transfers.statistics.rcm_queued, 1);
  assert.equal(snapshot.transfers.statistics.peer_connection_failed, 1);
  assert.ok(!JSON.stringify(snapshot).includes("WebTransferSecret"));
  assert.equal(snapshot.configuration.mode, "hub");
  assert.equal(snapshot.configuration.database.connect_timeout_seconds, 8);
  assert.equal(snapshot.configuration.database.read_timeout_seconds, 2);
  assert.equal(snapshot.configuration.authentication.enabled, false);
  assert.ok(!JSON.stringify(snapshot.configuration).includes("password_file"));
  await page.getByRole("link", {name:"Configuration",exact:true}).click();
  const startupView=page.getByTestId("startup-configuration");
  await expect(startupView.locator('[data-configuration-setting="connect_timeout_seconds"] dd')).toHaveText("8");
  await expect(startupView.locator('[data-configuration-setting="read_timeout_seconds"] dd')).toHaveText("2");
  assert.ok(!(await page.content()).includes(secret));
  const roles=snapshot.configuration.roles;
  assert.deepEqual(roles.catalog.map(r=>r.key),["guest","registered","vip","moderator","operator","administrator","owner"]);
  assert.ok(roles.catalog.find(r=>r.key==="owner").permissions.includes("roles.manage"));
  assert.equal(roles.operations.find(p=>p.key==="users.ban").implemented,true);
  await page.getByRole("link",{name:"Roles",exact:true}).click();
  await page.getByLabel("Inspect role").selectOption("operator");
  await expect(page.locator('[data-permission="users.ban"] td').nth(1)).toHaveText("Yes");
  await expect(page.locator('[data-permission="users.ban"] td').nth(2)).toContainText("Available service");
  await page.getByRole("link", { name: "Connections", exact: true }).click();
  await expect(page.getByTestId("transfer-ctm").locator(".metric-value")).toHaveText(["1", "1", "0", "0", "0", "0", "2", "0", "0", "0"]);
  await expect(page.getByTestId("transfer-rcm").locator(".metric-value")).toHaveText(["1", "1", "0", "0", "0", "0", "1", "0", "0", "0"]);
  await expect(page.getByTestId("transfer-peer-reports").locator(".metric-value")).toHaveText(["0", "1"]);
  assert.deepEqual(snapshot.transfers.configuration.allowed_protocols, ["ADC/1.0", "ADCS/1.0", 'Future"\\Protocol/1.0']);
  assert.equal(snapshot.transfers.configuration.request_rate, 9);
  const configurationView = page.getByTestId("transfer-configuration");
  await expect(configurationView.locator('[data-transfer-setting="allowed_protocols"]')).toHaveText(snapshot.transfers.configuration.allowed_protocols.join(", "));
  await expect(configurationView.locator('[data-transfer-setting="request_rate"]')).toHaveText("9");

  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByTestId("user-statistics").locator(".metric-value")).toHaveText(["2", "2", "2", "0"]);
  assert.deepEqual(snapshot.chat, { received: 5, public_dispatches: 1, private_dispatches: 2,
    rejected: 2, flood_limited: 0, errors: 0, queued: 5, unavailable: 0, refused: 0 });
  assert.ok(!(await status.text()).includes("WebChatSecret"));
  assert.ok(!(await status.text()).includes(secret));
  assert.ok(!(await page.content()).includes(secret));
  assert.equal(credentialLeak, false);
  const forbidden = await page.request.get(
    new URL("/@fs/" + process.argv[3], process.argv[2]).href,
  );
  assert.equal(forbidden.status(), 403);
  assert.ok(!(await forbidden.text()).includes(secret));
  await page.screenshot({
    path: "test-results/live-desktop.png",
    animations: "disabled", fullPage: true,
  });
  await page.getByRole("link", { name: "Chat", exact: true }).click();
  await expect(page.getByTestId("chat-details").locator(".metric-value"))
    .toHaveText(["5", "1", "2", "2", "0", "0", "5", "0", "0"]);
  assert.ok(!(await page.content()).includes("WebChatSecret"));
  await page.screenshot({ path: "test-results/live-chat-desktop.png", animations: "disabled", fullPage: true });
  await page.getByRole("link", { name: "Search", exact: true }).click();
  await expect(page.getByTestId("search-query-statistics").locator(".metric-value")).toHaveText(["1", "1", "0", "0", "0", "0", "1", "0", "0", "0"]);
  await expect(page.getByTestId("search-result-statistics").locator(".metric-value")).toHaveText(["1", "1", "0", "0", "0", "0", "1", "0", "0"]);
  await expect(page.locator('[data-setting="max_active_per_user"]')).toHaveText("8");
  console.log("SEARCH_MONITOR_READY");
  await expect(page.getByTestId("search-query-statistics").locator(".metric-value").first()).toHaveText("3", { timeout: 12000 });
  await expect(page.getByTestId("search-result-statistics").locator(".metric-value").first()).toHaveText("3");
  const rates = page.getByTestId("search-rates").locator(".metric-value");
  assert.ok(Number(await rates.nth(0).textContent()) > 0, "Live queries did not produce a positive sampled rate");
  assert.ok(Number(await rates.nth(1).textContent()) > 0, "Live results did not produce a positive sampled rate");
  await expect(page.getByTestId("search-monitoring").locator("polyline")).toHaveCount(2);
  assert.ok(!(await page.content()).includes("WebSearchSecret")); assert.ok(!JSON.stringify(snapshot).includes("WebSearchSecret"));
  await page.screenshot({ path: "test-results/live-search-desktop.png", animations: "disabled", fullPage: true });
  await page.getByRole("link", { name: "Connections", exact: true }).click();
  await expect(page.getByTestId("transfer-ctm").locator(".metric-value").first()).toHaveText("3");
  await expect(page.getByTestId("transfer-rcm").locator(".metric-value").first()).toHaveText("3");
  const transferRates = page.getByTestId("transfer-rates").locator(".metric-value");
  assert.ok(Number(await transferRates.nth(0).textContent()) > 0, "Live CTM did not produce a positive sampled rate");
  assert.ok(Number(await transferRates.nth(1).textContent()) > 0, "Live RCM did not produce a positive sampled rate");
  assert.ok(Number(await transferRates.nth(3).textContent()) > 0, "Live queue copies did not produce a positive sampled rate");
  await expect(page.getByTestId("transfer-monitoring").locator("polyline")).toHaveCount(2);
  assert.ok(!(await page.content()).includes("WebTransferSecret"));
  await page.screenshot({ path: "test-results/live-transfers-desktop.png", animations: "disabled", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("combobox").selectOption("pl");
  await expect(
    page.getByRole("heading", { name: "Ostatnia aktywność koordynacji" }),
  ).toBeVisible();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "test-results/live-transfers-mobile-pl.png",
    animations: "disabled", fullPage: true,
  });
  await page.getByRole("button", { name: "Otwórz nawigację" }).click();
  await page.getByRole("link", { name: "Wyszukiwanie", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Monitoring wyszukiwań" })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "test-results/live-search-mobile-pl.png", animations: "disabled", fullPage: true });
  await page.goto(new URL("#kick",process.argv[2]).href);
  const kicks=page.getByTestId("kick-statistics");
  await expect(kicks.locator("dd").first()).toHaveText("1");
  await expect(kicks.locator("dd").nth(2)).toHaveText("1");
  assert.ok(!(await page.content()).includes("PrivateKickReason"));
  assert.equal(snapshot.kick.refused,"1");
  await page.goto(new URL("#mute",process.argv[2]).href);
  await expect(page.getByTestId("mute-statistics").locator("dd")).toHaveCount(8);
  assert.equal(snapshot.mute.attempts,"0");
  assert.equal(snapshot.configuration.roles.operations.find(p=>p.key==="users.mute").implemented,true);
  assert.deepEqual(errors, []);
  console.log(
    "Real C++ API → local adapter → React: live search/transfer rates, counters, secret isolation, desktop and mobile PL OK",
  );
} finally {
  await browser.close();
}
