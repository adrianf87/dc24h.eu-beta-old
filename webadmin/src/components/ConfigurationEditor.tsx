import {useEffect, useRef, useState} from "react";
import type {Copy} from "../languages/us";
import {adminHeaders} from "../lib/adminAccess";
import {EDITABLE_SETTINGS, configurationChanges, configurationFailureNotice, configurationForm, parseConfigurationReview,
  parseConfigurationValidation, parseConfigurationWrite, validSetting} from "../lib/configuration-editor";
import type {ConfigurationReview, EditableSetting, EditableValues} from "../lib/configuration-editor";

const paths = {
  review: "./admin-api/v1/management/configuration",
  write: "./admin-api/v1/management/configuration/write",
  restore: "./admin-api/v1/management/configuration/restore",
};

type Notice = "configEditAuth" | "configEditUnavailable" | "configEditInvalid" | "configEditNoChanges" |
  "configEditValidated" | "configEditRejected" | "configEditStale" | "configEditUnknown" |
  "configEditSaved" | "configEditRestored";

function failure(response: Response): Notice {
  if (response.status === 401 || response.status === 403) return "configEditAuth";
  if (response.status === 409) return "configEditStale";
  if (response.status === 422) return "configEditRejected";
  return "configEditUnknown";
}

function label(key: EditableSetting, t: Copy): string {
  if (key === "network_max_connections") return t.configEditConnections;
  if (key === "network_idle_timeout") return t.configEditTimeout;
  if (key === "logging_level") return t.configEditLogLevel;
  return t.configEditLanguage;
}

export function ConfigurationEditor({t}: {t: Copy}) {
  const [review, setReview] = useState<ConfigurationReview | null>(null);
  const [draft, setDraft] = useState<EditableValues | null>(null);
  const [preview, setPreview] = useState<{revision: string; fingerprint: string; changes: Partial<EditableValues>} | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restart, setRestart] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function run<T>(path: string, body: URLSearchParams | null, parse: (value: unknown) => T): Promise<T> {
    if (!adminHeaders()["X-DC24H-Admin-Grant"]) throw new Error("configEditAuth");
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, {
        method: body ? "POST" : "GET", body: body ?? undefined, signal: controller.signal,
        cache: "no-store", credentials: "same-origin", redirect: "error",
        headers: {...adminHeaders(), ...(body ? {"Content-Type": "application/x-www-form-urlencoded", "X-DC24H-Admin": "1"} : {})},
      });
      if (!response.ok) throw new Error(failure(response));
      return parse(await response.json());
    } finally {
      clearTimeout(timer);
      if (pending.current === controller) pending.current = null;
    }
  }

  function failed(error: unknown, mutation = false) {
    const next = configurationFailureNotice(error, mutation);
    setNotice(next);
    if (next === "configEditStale" || next === "configEditUnknown" || next === "configEditAuth") {
      setReview(null); setDraft(null);
    }
    setPreview(null);
  }

  async function load() {
    if (busy) return;
    setBusy(true); setNotice(null); setPreview(null); setConfirmWrite(false); setConfirmRestore(false);
    try {
      const value = await run(paths.review, null, parseConfigurationReview);
      setReview(value); setDraft({...value.saved});
    } catch (error) { failed(error); }
    finally { setBusy(false); }
  }

  function edit(key: EditableSetting, value: string) {
    if (!draft) return;
    setDraft({...draft, [key]: value});
    setPreview(null); setNotice(null); setConfirmWrite(false);
  }

  function proposed() {
    if (!review || !draft) throw new Error("configEditInvalid");
    return configurationChanges(review.saved, draft);
  }

  async function validate() {
    if (busy || !review || !draft) return;
    let changes: Partial<EditableValues>;
    try {
      changes = proposed();
      if (!Object.keys(changes).length) { setNotice("configEditNoChanges"); return; }
    } catch { setNotice("configEditInvalid"); return; }
    setBusy(true); setNotice(null); setPreview(null); setConfirmWrite(false);
    try {
      const validation = await run(paths.review, configurationForm(review.revision, changes), parseConfigurationValidation);
      if (!validation.valid) { setNotice("configEditRejected"); return; }
      setPreview({revision: review.revision, fingerprint: JSON.stringify(changes), changes});
      setNotice("configEditValidated");
    } catch (error) { failed(error); }
    finally { setBusy(false); }
  }

  async function write() {
    if (busy || !review || !draft || !preview || !confirmWrite || review.revision !== preview.revision) return;
    let changes: Partial<EditableValues>;
    try { changes = proposed(); }
    catch { setNotice("configEditInvalid"); return; }
    if (JSON.stringify(changes) !== preview.fingerprint) return;
    setBusy(true); setNotice(null);
    try {
      const result = await run(paths.write, configurationForm(review.revision, changes), parseConfigurationWrite);
      const saved = {...review.saved, ...changes};
      setReview({...review, revision: result.revision, saved,
        matches_active: EDITABLE_SETTINGS.every(key => saved[key] === review.active[key])});
      setDraft(saved); setPreview(null); setConfirmWrite(false); setRestart(true); setNotice("configEditSaved");
    } catch (error) { failed(error, true); }
    finally { setBusy(false); }
  }

  async function restore() {
    if (busy || !review || !confirmRestore) return;
    setBusy(true); setNotice(null); setPreview(null); setConfirmWrite(false); setConfirmRestore(false);
    try {
      await run(paths.restore, new URLSearchParams({revision: review.revision}), parseConfigurationWrite);
      setReview(null); setDraft(null); setRestart(true); setNotice("configEditRestored");
    } catch (error) { failed(error, true); }
    finally { setBusy(false); }
  }

  return <section className="card configuration-editor" data-testid="configuration-editor" aria-label={t.configEditTitle}>
    <div className="card-heading"><div><h2>{t.configEditTitle}</h2><p>{t.configEditIntro}</p></div></div>
    <p className="configuration-alert" role="note">{t.configEditLocal}</p>
    <div className="accounts-buttons"><button type="button" disabled={busy} onClick={() => void load()}>{t.configEditLoad}</button></div>
    {!review && <p className="configuration-footnote">{t.configEditAccess}</p>}
    {review && draft && <>
      <p>{t.configEditSavedScope} <strong>{review.matches_active ? t.configEditUnchanged : t.configEditDifferent}</strong></p>
      <div className="configuration-edit-grid">
        {EDITABLE_SETTINGS.map(key => <label key={key} className="configuration-edit-field">
          <span>{label(key,t)}</span>
          {key === "logging_level" || key === "general_language" ?
            <select data-testid={`config-input-${key}`} value={draft[key]} disabled={busy} onChange={event => edit(key,event.target.value)}>
              {(key === "logging_level" ? ["info","warning","error","off"] : ["us","pl"]).map(value =>
                <option key={value} value={value}>{value}</option>)}
            </select> :
            <input data-testid={`config-input-${key}`} type="text" inputMode="numeric" autoComplete="off" maxLength={5} value={draft[key]} disabled={busy}
              aria-invalid={!validSetting(key,draft[key])} onChange={event => edit(key,event.target.value)}/>}
          <small>{t.configEditCurrent}: <code>{review.saved[key]}</code> · {t.configEditMaintenance}: <code>{review.active[key]}</code></small>
        </label>)}
      </div>
      <div className="accounts-buttons"><button type="button" disabled={busy} onClick={() => void validate()}>{t.configEditValidate}</button></div>
      {preview && <div className="configuration-preview" data-testid="configuration-preview">
        <h3>{t.configEditPreview}</h3>
        <table><thead><tr><th>{t.configEditSetting}</th><th>{t.configEditCurrent}</th><th>{t.configEditProposed}</th></tr></thead>
          <tbody>{EDITABLE_SETTINGS.filter(key=>preview.changes[key]!==undefined).map(key =>
            <tr key={key}><th scope="row">{label(key,t)}</th><td>{review.saved[key]}</td><td>{preview.changes[key]}</td></tr>)}</tbody></table>
        <label className="configuration-confirm"><input type="checkbox" checked={confirmWrite} disabled={busy}
          onChange={event => setConfirmWrite(event.target.checked)}/>{t.configEditConfirm}</label>
        <button type="button" disabled={busy || !confirmWrite} onClick={() => void write()}>{t.configEditWrite}</button>
      </div>}
      <div className="configuration-restore">
        <h3>{t.configEditRestore}</h3><p>{t.configEditRestoreNote}</p>
        <label className="configuration-confirm"><input type="checkbox" checked={confirmRestore} disabled={busy}
          onChange={event => setConfirmRestore(event.target.checked)}/>{t.configEditRestoreConfirm}</label>
        <button type="button" disabled={busy || !confirmRestore} onClick={() => void restore()}>{t.configEditRestoreAction}</button>
      </div>
    </>}
    {notice && <p role="status" data-testid="configuration-editor-status">{t[notice]}</p>}
    {restart && <p role="alert" className="configuration-alert">{t.configEditRestart}</p>}
  </section>;
}
