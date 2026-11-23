import { useEffect, useRef, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { parseRemoteSummaryResponse } from "../lib/remote-status.ts";
import type { Summary } from "../lib/remote-status.ts";

type Language = "us" | "pl";
type Session = { schema: 1; authenticated: true; mfa: true; mode: "read-only"; csrf: string; expires_in: number };
type Status = "loading" | "unauthorized" | "authorized" | "forbidden" | "unavailable" | "expired" | "rate-limited";
type Device = { id: string; name: string; device_type: "singleDevice" | "multiDevice";
  backed_up: boolean; created_at: number; last_used_at: number | null };

const labels = {
  us: {
    title: "Remote WebAdmin", mode: "Read-only · Local access", id: "Administrator account ID",
    password: "Account password", otp: "Authenticator code (6 digits)", signIn: "Sign in", signOut: "Sign out",
    loginHint: "Use an active administrator or Owner account. Sign in with password + TOTP, or password + an enrolled passkey. No service token is stored in the browser.",
    loading: "Loading current status…", unauthorized: "Sign in to read approved hub metrics.",
    forbidden: "This account is not authorized for remote read-only access.",
    unavailable: "The gateway or hub API is unavailable. Access is denied until it recovers.",
    expired: "Your session expired or was revoked. Sign in again.",
    limited: "Too many attempts. Wait before trying again.",
    version: "Hub version", running: "Hub running", uptime: "Uptime (seconds)",
    connections: "Active connections", accepted: "Accepted connections",
    online: "Online users", peak: "Peak online", chat: "Chat received",
    rejected: "Chat rejected", queries: "Search queries", results: "Search results",
    ctm: "CTM requests", rcm: "RCM requests", refresh: "Refresh",
    yes: "Yes", no: "No", noData: "Optional metrics unavailable",
    passkeySignIn: "Sign in with passkey", devices: "Passkeys / trusted devices",
    loadDevices: "Refresh devices", addPasskey: "Add passkey", rename: "Rename",
    remove: "Revoke", deviceName: "Device name", noDevices: "No passkeys enrolled yet.",
    passkeyHelp: "Passkeys require your administrator password plus an origin-bound device confirmation. Adding or changing devices requires a fresh sign-in (within 60 seconds).",
    actionFailed: "Passkey operation was refused. Sign in again if recent verification is required.",
    actionDone: "Passkey operation completed.", revoked: "The key was revoked and sessions were ended. Sign in again.",
  },
  pl: {
    title: "WebAdmin zdalny", mode: "Tylko odczyt · Dostęp lokalny", id: "ID konta administratora",
    password: "Hasło konta", otp: "Kod uwierzytelniający (6 cyfr)", signIn: "Zaloguj", signOut: "Wyloguj",
    loginHint: "Użyj aktywnego konta administratora lub Ownera. Zaloguj się hasłem + TOTP albo hasłem + zarejestrowanym passkey. Token usługi nie jest zapisany w przeglądarce.",
    loading: "Pobieranie aktualnego stanu…", unauthorized: "Zaloguj się, aby odczytać zatwierdzone dane huba.",
    forbidden: "To konto nie ma uprawnienia do zdalnego odczytu.",
    unavailable: "Brama lub API huba jest niedostępne. Dostęp jest odrzucony do czasu naprawy.",
    expired: "Sesja wygasła albo została unieważniona. Zaloguj się ponownie.",
    limited: "Zbyt wiele prób. Poczekaj przed kolejną.",
    version: "Wersja huba", running: "Hub działa", uptime: "Czas działania (sekundy)",
    connections: "Aktywne połączenia", accepted: "Przyjęte połączenia",
    online: "Użytkownicy online", peak: "Szczyt online", chat: "Wiadomości odebrane",
    rejected: "Wiadomości odrzucone", queries: "Zapytania wyszukiwania", results: "Wyniki wyszukiwania",
    ctm: "Żądania CTM", rcm: "Żądania RCM", refresh: "Odśwież",
    yes: "Tak", no: "Nie", noData: "Opcjonalne dane niedostępne",
    passkeySignIn: "Zaloguj przez passkey", devices: "Passkeys / zaufane urządzenia",
    loadDevices: "Odśwież urządzenia", addPasskey: "Dodaj passkey", rename: "Zmień nazwę",
    remove: "Unieważnij", deviceName: "Nazwa urządzenia", noDevices: "Brak dodanych kluczy passkey.",
    passkeyHelp: "Passkeys wymagają hasła administratora i potwierdzenia urządzeniem powiązanym z domeną. Zmiana urządzeń wymaga świeżego logowania (do 60 sekund).",
    actionFailed: "Operacja passkey odrzucona. Zaloguj się ponownie, jeśli wymagane jest świeże potwierdzenie.",
    actionDone: "Operacja passkey zakończona.", revoked: "Klucz unieważniono i zakończono sesje. Zaloguj się ponownie.",
  },
} as const;

async function call(path: string, init?: RequestInit): Promise<{ status: number; data: unknown }> {
  const answer = await fetch("/remote/v1/" + path, {
    credentials: "same-origin", cache: "no-store",
    ...init,
  });
  const data: unknown = await answer.json();
  return { status: answer.status, data };
}
const validSession = (value: unknown): value is Session => {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return s.schema === 1 && s.authenticated === true && s.mfa === true && s.mode === "read-only" &&
    typeof s.csrf === "string" && /^[0-9a-f]{64}$/.test(s.csrf) &&
    typeof s.expires_in === "number" && s.expires_in > 0 && s.expires_in <= 600;
};
function failure(status: number): Status {
  if (status === 403) return "forbidden";
  if (status === 429) return "rate-limited";
  if (status === 401) return "expired";
  return "unavailable";
}

export function RemoteApp() {
  const [language, setLanguage] = useState<Language>(navigator.language.toLowerCase().startsWith("pl") ? "pl" : "us");
  const [state, setState] = useState<Status>("loading");
  const [csrf, setCsrf] = useState("");
  const [actor, setActor] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [deviceLabels, setDeviceLabels] = useState<Record<string, string>>({});
  const [actionMessage, setActionMessage] = useState("");
  // An older HTTP response must never modify a newer authenticated session.
  const sessionEpoch = useRef(0);
  // A prior refresh must also not replace the latest result within a session.
  const summaryRequest = useRef(0);
  const t = labels[language];

  const invalidate = (next: Status) => {
    sessionEpoch.current++;
    summaryRequest.current++;
    setSummary(null);
    setDevices(null);
    setActionMessage("");
    setCsrf("");
    setState(next);
  };
  useEffect(() => {
    let canceled = false;
    call("session").then(({ status, data }) => {
      if (canceled) return;
      if (status === 200 && validSession(data)) { setCsrf(data.csrf); setState("authorized"); }
      else setState(status === 401 ? "unauthorized" : failure(status));
    }).catch(() => { if (!canceled) setState("unavailable"); });
    return () => { canceled = true; };
  }, []);
  const load = async () => {
    const epoch = sessionEpoch.current;
    const requestId = ++summaryRequest.current;
    try {
      const { status, data } = await call("summary");
      if (epoch !== sessionEpoch.current || requestId !== summaryRequest.current) return;
      const parsed = status === 200 ? parseRemoteSummaryResponse(data) : null;
      if (parsed) { setSummary(parsed); return; }
      invalidate(status === 200 ? "unavailable" : failure(status));
    } catch {
      if (epoch === sessionEpoch.current && requestId === summaryRequest.current) invalidate("unavailable");
    }
  };
  useEffect(() => {
    if (state !== "authorized") return;
    void load();
    const timer = window.setInterval(() => { void load(); }, 15000);
    return () => {
      window.clearInterval(timer);
      sessionEpoch.current++;
    };
    // Session changes drive polling; no retry is scheduled on auth failure.
  }, [state]);
  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    const proof = password;
    const code = otp;
    setPassword(""); // Do not retain a password after a failed challenge.
    setOtp("");
    invalidate("loading");
    try {
      const challenge = await call("challenge");
      if (challenge.status !== 200 || !challenge.data || typeof challenge.data !== "object" ||
        !("csrf" in challenge.data) || typeof challenge.data.csrf !== "string") {
        setState(failure(challenge.status)); return;
      }
      const result = await call("login", {
        method: "POST", headers: {
          "Content-Type": "application/json", "X-DC24H-Remote-CSRF": challenge.data.csrf,
        }, body: JSON.stringify({ actor_id: actor, password: proof, otp: code }),
      });
      if (result.status === 200 && validSession(result.data)) {
        setCsrf(result.data.csrf); setState("authorized");
      } else { invalidate(result.status === 200 ? "unavailable" : failure(result.status)); }
    } catch { invalidate("unavailable"); }
  };
  const logout = async () => {
    if (!csrf) return;
    const token = csrf;
    invalidate("loading");
    try {
      const result = await call("logout", {
        method: "POST", headers: { "Content-Type": "application/json", "X-DC24H-Remote-CSRF": token },
        body: "{}",
      });
      if (result.status !== 200) { invalidate(failure(result.status)); return; }
      invalidate("unauthorized"); setActor("");
    } catch { invalidate("unavailable"); }
  };
  const passkeyRequest = (path: string, data: unknown, token: string) => call(path, {
    method: "POST", headers: { "Content-Type": "application/json", "X-DC24H-Remote-CSRF": token },
    body: JSON.stringify(data),
  });
  const passkeyLogin = async () => {
    const proof = password;
    setPassword(""); setOtp("");
    invalidate("loading");
    try {
      const issued = await call("challenge");
      if (issued.status !== 200 || !issued.data || typeof issued.data !== "object" ||
          !("csrf" in issued.data) || typeof issued.data.csrf !== "string") {
        invalidate(failure(issued.status)); return;
      }
      const token = issued.data.csrf;
      const options = await passkeyRequest("passkey/login/options", { actor_id: actor, password: proof }, token);
      if (options.status !== 200) { invalidate(failure(options.status)); return; }
      const answer = await startAuthentication({ optionsJSON: options.data as Parameters<typeof startAuthentication>[0]["optionsJSON"] });
      const result = await passkeyRequest("passkey/login/finish", { response: answer }, token);
      if (result.status === 200 && validSession(result.data)) {
        setCsrf(result.data.csrf); setState("authorized");
      } else invalidate(failure(result.status));
    } catch { invalidate("unavailable"); }
  };
  const loadDevices = async () => {
    const epoch = sessionEpoch.current;
    try {
      const result = await call("passkey/devices");
      if (epoch !== sessionEpoch.current) return;
      if (result.status !== 200 || !result.data || typeof result.data !== "object" ||
          !("devices" in result.data) || !Array.isArray(result.data.devices)) throw Error();
      const list = result.data.devices as Device[];
      if (list.length > 8 || list.some(d => !d || typeof d.id !== "string" || typeof d.name !== "string")) throw Error();
      setDevices(list); setActionMessage("");
    } catch { if (epoch === sessionEpoch.current) setActionMessage(t.actionFailed); }
  };
  const enroll = async () => {
    if (!csrf) return;
    const epoch = sessionEpoch.current;
    setActionMessage("");
    try {
      const options = await passkeyRequest("passkey/enroll/options", {}, csrf);
      if (options.status !== 200) throw Error();
      const answer = await startRegistration({ optionsJSON: options.data as Parameters<typeof startRegistration>[0]["optionsJSON"] });
      if (epoch !== sessionEpoch.current) return;
      const result = await passkeyRequest("passkey/enroll/finish", { response: answer }, csrf);
      if (result.status !== 200) throw Error();
      setActionMessage(t.actionDone); await loadDevices();
    } catch { if (epoch === sessionEpoch.current) setActionMessage(t.actionFailed); }
  };
  const changeDevice = async (id: string, revoke: boolean) => {
    if (!csrf) return;
    try {
      const result = await passkeyRequest(revoke ? "passkey/device/revoke" : "passkey/device/rename",
        revoke ? { id } : { id, name: deviceLabels[id] ?? "" }, csrf);
      if (result.status !== 200) throw Error();
      if (revoke) { invalidate("unauthorized"); setActionMessage(t.revoked); }
      else { setDeviceLabels(previous => ({ ...previous, [id]: "" })); await loadDevices(); setActionMessage(t.actionDone); }
    } catch { setActionMessage(t.actionFailed); }
  };
  const rows: [string, string | number][] = summary ? [
    [t.version, summary.server.version], [t.running, summary.server.running ? t.yes : t.no],
    [t.uptime, summary.server.uptime_seconds], [t.connections, summary.network.active_connections],
    [t.accepted, summary.network.accepted_connections], [t.online, summary.users.online],
    [t.peak, summary.users.peak_online], [t.chat, summary.chat.received],
    [t.rejected, summary.chat.rejected],
    ...(summary.search ? [[t.queries, summary.search.queries], [t.results, summary.search.results]] as [string, number][] : []),
    ...(summary.transfers ? [[t.ctm, summary.transfers.ctm], [t.rcm, summary.transfers.rcm]] as [string, number][] : []),
  ] : [];
  return (
    <main className="remote-shell">
      <header className="remote-head">
        <div><strong>dc24h.eu High Starter</strong><h1>{t.title}</h1><p>{t.mode}</p></div>
        <div className="remote-actions">
          <button type="button" aria-label="English" onClick={() => setLanguage("us")}>EN</button>
          <button type="button" aria-label="Polski" onClick={() => setLanguage("pl")}>PL</button>
          {state === "authorized" && <button type="button" onClick={() => void logout()}>{t.signOut}</button>}
        </div>
      </header>
      <section className="remote-panel" aria-live="polite">
        {state !== "authorized" && <p role="status">{state === "loading" ? t.loading : state === "unauthorized" ? t.unauthorized :
          state === "forbidden" ? t.forbidden : state === "expired" ? t.expired :
          state === "rate-limited" ? t.limited : t.unavailable}</p>}
        {state !== "authorized" && actionMessage && <p role="status">{actionMessage}</p>}
        {state !== "authorized" && state !== "loading" && <form onSubmit={(event) => { void login(event); }}>
          <label>{t.id}<input name="actor" inputMode="numeric" autoComplete="username"
            required pattern="[1-9][0-9]*" value={actor} onChange={(event) => setActor(event.target.value)} /></label>
          <label>{t.password}<input name="password" type="password" autoComplete="current-password"
            required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>{t.otp}<input name="otp" type="text" inputMode="numeric" autoComplete="one-time-code"
            required pattern="[0-9]{6}" maxLength={6} value={otp} onChange={(event) => setOtp(event.target.value)} /></label>
          <p className="remote-hint">{t.loginHint}</p>
          <button type="submit">{t.signIn}</button>
          <button type="button" onClick={() => void passkeyLogin()} disabled={!actor || !password}>{t.passkeySignIn}</button>
        </form>}
        {state === "authorized" && <>
          <div className="remote-toolbar"><span>{t.mode}</span><button type="button" onClick={() => void load()}>{t.refresh}</button></div>
          {summary ? <dl className="remote-grid">{rows.map(([key, value]) =>
            <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> : <p>{t.loading}</p>}
          {summary && !summary.search && !summary.transfers && <p className="remote-hint">{t.noData}</p>}
          <section className="remote-devices">
            <h2>{t.devices}</h2>
            <p className="remote-hint">{t.passkeyHelp}</p>
            <div className="remote-actions">
              <button type="button" onClick={() => void loadDevices()}>{t.loadDevices}</button>
              <button type="button" onClick={() => void enroll()}>{t.addPasskey}</button>
            </div>
            {devices && (devices.length ? <ul>{devices.map(device => <li key={device.id}>
              <strong>{device.name}</strong> ({device.device_type}, {device.backed_up ? "backup" : "local"})
              <label>{t.deviceName}<input value={deviceLabels[device.id] ?? ""} maxLength={64}
                onChange={event => setDeviceLabels(previous => ({ ...previous, [device.id]: event.target.value }))} /></label>
              <div className="remote-actions">
                <button type="button" onClick={() => void changeDevice(device.id, false)} disabled={!(deviceLabels[device.id] ?? "").trim()}>{t.rename}</button>
                <button type="button" onClick={() => void changeDevice(device.id, true)}>{t.remove}</button>
              </div>
            </li>)}</ul> : <p>{t.noDevices}</p>)}
            {actionMessage && <p role="status">{actionMessage}</p>}
          </section>
        </>}
      </section>
    </main>
  );
}
