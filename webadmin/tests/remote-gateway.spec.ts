import { test, expect, type Route } from "@playwright/test";

const sessionCsrf = "d".repeat(64);
const snapshot = {
  schema: 1, mode: "read-only",
  server: { version: "beta-0.4.6", running: true, uptime_seconds: 123 },
  network: { active_connections: 5, accepted_connections: 22 },
  users: { online: 4, peak_online: 7 },
  chat: { received: 10, rejected: 1 },
};

test("remote read-only screen needs a session, supports EN/PL and never offers mutations", async ({ page }) => {
  let loggedIn = false;
  await page.route("**/remote/v1/session", async (route) => {
    await route.fulfill({ status: loggedIn ? 200 : 401, contentType: "application/json",
      body: loggedIn ? JSON.stringify({ schema: 1, authenticated: true, mfa: true, mode: "read-only", csrf: sessionCsrf, expires_in: 120 }) :
        '{"error":"unauthorized"}' });
  });
  await page.route("**/remote/v1/challenge", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ schema: 1, csrf: "e".repeat(64) }) });
  });
  await page.route("**/remote/v1/login", async (route) => {
    const body = route.request().postDataJSON() as {actor_id:string;password:string;otp:string};
    expect(body.actor_id).toBe("7");
    expect(body.password).toBe("example-proof");
    expect(body.otp).toBe("123456");
    expect(route.request().headers()["x-dc24h-remote-csrf"]).toBe("e".repeat(64));
    loggedIn = true;
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ schema: 1, authenticated: true, mfa: true, mode: "read-only", csrf: sessionCsrf, expires_in: 600 }) });
  });
  await page.route("**/remote/v1/summary", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });
  await page.route("**/remote/v1/logout", async (route) => {
    expect(route.request().headers()["x-dc24h-remote-csrf"]).toBe(sessionCsrf);
    loggedIn = false;
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"schema":1,"authenticated":false}' });
  });
  await page.goto("/remote.html");
  await expect(page.getByText("Sign in to read approved hub metrics.")).toBeVisible();
  await page.getByRole("button", { name: "Polski" }).click();
  await expect(page.getByText("Zaloguj się, aby odczytać zatwierdzone dane huba.")).toBeVisible();
  await page.getByLabel("ID konta administratora").fill("7");
  await page.getByLabel("Hasło konta").fill("example-proof");
  await page.getByLabel("Kod uwierzytelniający (6 cyfr)").fill("123456");
  await page.getByRole("button", { name: "Zaloguj" }).click();
  await expect(page.getByText("beta-0.4.6")).toBeVisible();
  await expect(page.getByText("Aktywne połączenia")).toBeVisible();
  await expect(page.getByText("Użytkownicy online")).toBeVisible();
  for (const title of ["Start", "Stop", "Restart", "Edit", "Restore", "Grant"]) {
    await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Wyloguj" }).click();
  await expect(page.getByText("Zaloguj się, aby odczytać zatwierdzone dane huba.")).toBeVisible();
});

test("remote view fails closed on unavailable API and does not render stale metrics", async ({ page }) => {
  await page.route("**/remote/v1/session", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ schema: 1, authenticated: true, mfa: true, mode: "read-only", csrf: sessionCsrf, expires_in: 120 }),
  }));
  await page.route("**/remote/v1/summary", async (route) => route.fulfill({
    status: 503, contentType: "application/json", body: '{"error":"unavailable"}',
  }));
  await page.goto("/remote.html");
  await expect(page.getByText(/The gateway or hub API is unavailable/)).toBeVisible();
  await expect(page.getByText("Active connections")).toHaveCount(0);
});

test("remote view clears previously displayed metrics after session expiration", async ({ page }) => {
  let expired = false;
  await page.route("**/remote/v1/session", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ schema: 1, authenticated: true, mfa: true, mode: "read-only", csrf: sessionCsrf, expires_in: 120 }),
  }));
  await page.route("**/remote/v1/summary", async (route) => route.fulfill({
    status: expired ? 401 : 200, contentType: "application/json",
    body: expired ? '{"error":"unauthorized"}' : JSON.stringify(snapshot),
  }));
  await page.goto("/remote.html");
  await expect(page.getByText("Active connections")).toBeVisible();
  expired = true;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Your session expired or was revoked. Sign in again.")).toBeVisible();
  await expect(page.getByText("Active connections")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});

test("a delayed denial from the previous session cannot expire a new login", async ({ page }) => {
  let firstRequest!: Route;
  let signalStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => { signalStarted = resolve; });
  let summaries = 0;
  await page.route("**/remote/v1/session", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ schema: 1, authenticated: true, mfa: true, mode: "read-only", csrf: sessionCsrf, expires_in: 120 }),
  }));
  await page.route("**/remote/v1/challenge", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ schema: 1, csrf: "e".repeat(64) }),
  }));
  await page.route("**/remote/v1/login", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ schema: 1, authenticated: true, mfa: true, mode: "read-only", csrf: "f".repeat(64), expires_in: 600 }),
  }));
  await page.route("**/remote/v1/summary", async (route) => {
    summaries++;
    if (summaries === 1) {
      firstRequest = route;
      signalStarted();
      return; // Leave the old session request in flight.
    }
    await route.fulfill(summaries === 2
      ? { status: 401, contentType: "application/json", body: '{"error":"unauthorized"}' }
      : { status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  });

  await page.goto("/remote.html");
  await firstStarted;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Your session expired or was revoked. Sign in again.")).toBeVisible();
  await page.getByLabel("Administrator account ID").fill("7");
  await page.getByLabel("Account password").fill("correct");
  await page.getByLabel("Authenticator code (6 digits)").fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Active connections")).toBeVisible();

  const oldResponse = page.waitForResponse((response) =>
    response.url().includes("/remote/v1/summary") && response.status() === 401);
  await firstRequest.fulfill({ status: 401, contentType: "application/json", body: '{"error":"unauthorized"}' });
  await oldResponse;
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByText("Active connections")).toBeVisible();
});

test("a failed login challenge clears the entered password", async ({ page }) => {
  await page.route("**/remote/v1/session", async (route) => route.fulfill({
    status: 401, contentType: "application/json", body: '{"error":"unauthorized"}',
  }));
  await page.route("**/remote/v1/challenge", async (route) => route.fulfill({
    status: 503, contentType: "application/json", body: '{"error":"unavailable"}',
  }));
  await page.goto("/remote.html");
  await page.getByLabel("Administrator account ID").fill("7");
  await page.getByLabel("Account password").fill("sensitive-proof");
  await page.getByLabel("Authenticator code (6 digits)").fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/The gateway or hub API is unavailable/)).toBeVisible();
  await expect(page.getByLabel("Account password")).toHaveValue("");
  await expect(page.getByLabel("Authenticator code (6 digits)")).toHaveValue("");
});

test("an old summary cannot overwrite metrics after logout and a new login", async ({ page }) => {
  let oldRequest!: Route;
  let signalStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => { signalStarted = resolve; });
  let reads = 0;
  await page.route("**/remote/v1/session", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ schema: 1, authenticated: true, mfa: true, mode: "read-only", csrf: sessionCsrf, expires_in: 120 }),
  }));
  await page.route("**/remote/v1/logout", async (route) => route.fulfill({
    status: 200, contentType: "application/json", body: '{"schema":1,"authenticated":false}',
  }));
  await page.route("**/remote/v1/challenge", async (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ schema: 1, csrf: "e".repeat(64) }),
  }));
  await page.route("**/remote/v1/login", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ schema: 1, authenticated: true, mfa: true, mode: "read-only", csrf: "f".repeat(64), expires_in: 600 }),
  }));
  await page.route("**/remote/v1/summary", async (route) => {
    reads++;
    if (reads === 1) {
      oldRequest = route;
      signalStarted();
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ...snapshot, network: { active_connections: 99, accepted_connections: 100 } }) });
  });
  await page.goto("/remote.html");
  await firstStarted;
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("Sign in to read approved hub metrics.")).toBeVisible();
  await page.getByLabel("Administrator account ID").fill("7");
  await page.getByLabel("Account password").fill("new-proof");
  await page.getByLabel("Authenticator code (6 digits)").fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("99", { exact: true })).toBeVisible();

  const staleResponse = page.waitForResponse((response) =>
    response.url().includes("/remote/v1/summary") && response.status() === 200);
  await oldRequest.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  await staleResponse;
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByText("99", { exact: true })).toBeVisible();
  await expect(page.getByText("5", { exact: true })).toHaveCount(0);
});

test("an older read in the same session cannot replace fresher metrics", async ({ page }) => {
  let oldRequest!: Route;
  let signalStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => { signalStarted = resolve; });
  let reads = 0;
  await page.route("**/remote/v1/session", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ schema: 1, authenticated: true, mfa: true, mode: "read-only", csrf: sessionCsrf, expires_in: 120 }),
  }));
  await page.route("**/remote/v1/summary", async (route) => {
    reads++;
    if (reads === 1) { oldRequest = route; signalStarted(); return; }
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ...snapshot, network: { active_connections: 99, accepted_connections: 100 } }) });
  });

  await page.goto("/remote.html");
  await firstStarted;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("99", { exact: true })).toBeVisible();

  const staleResponse = page.waitForResponse((response) =>
    response.url().includes("/remote/v1/summary") && response.status() === 200);
  await oldRequest.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(snapshot) });
  await staleResponse;
  await page.evaluate(() => new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.getByText("99", { exact: true })).toBeVisible();
  await expect(page.getByText("5", { exact: true })).toHaveCount(0);
});

test("malformed HTTP 200 metrics fail closed without rendering unsafe nested data", async ({ page }) => {
  await page.route("**/remote/v1/session", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ schema: 1, authenticated: true, mfa: true, mode: "read-only", csrf: sessionCsrf, expires_in: 120 }),
  }));
  await page.route("**/remote/v1/summary", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ ...snapshot, server: { ...snapshot.server, version: { nested: "private" } } }),
  }));
  await page.goto("/remote.html");
  await expect(page.getByText(/The gateway or hub API is unavailable/)).toBeVisible();
  await expect(page.getByText("Active connections")).toHaveCount(0);
});
