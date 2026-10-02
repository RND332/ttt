import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ExtensionSettings } from "./shared";
import { DEFAULT_SETTINGS } from "./shared";
import { loadExtensionSettings } from "./settings";

function normalizeSettings(settings: ExtensionSettings): ExtensionSettings {
  return {
    botToken: settings.botToken.trim(),
    channelId: settings.channelId.trim(),
    captionPrefix: settings.captionPrefix.trim(),
    includePostLink: settings.includePostLink
  };
}

function OptionsPage() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextAutosaveRef = useRef(true);

  const storage = chrome.storage.local;

  const showStatus = useCallback((message: string) => {
    setStatus(message);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => {
      setStatus((current) => (current === message ? "" : current));
    }, 1500);
  }, []);

  const saveSettings = useCallback(async (message: string = "Saved") => {
    await storage.set(normalizeSettings(settings));
    showStatus(message);
  }, [settings, showStatus, storage]);

  useEffect(() => {
    void (async () => {
      const loaded = await loadExtensionSettings();
      setSettings(loaded);
      setHydrated(true);
    })();
  }, [storage]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void saveSettings("Auto-saved");
    }, 500);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [hydrated, saveSettings]);

  function updateSetting<K extends keyof ExtensionSettings>(key: K, value: ExtensionSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="shell">
      <header className="masthead">
        <span className="wordmark">ttt.</span>
        <span>X → Telegram</span>
      </header>
      <main>
        <div className="intro">
          <h1>Settings</h1>
          <p>Send media from X to your Telegram channel.</p>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void saveSettings(); }}>
          <fieldset disabled={!hydrated}>
            <div className="field">
              <label htmlFor="botToken">Bot token</label>
              <input id="botToken" type="password" autoComplete="off" spellCheck={false}
                value={settings.botToken}
                onChange={(event) => updateSetting("botToken", event.target.value)} />
              <p className="hint">Get a token from <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather ↗</a></p>
            </div>
            <div className="field">
              <label htmlFor="channelId">Channel ID or username</label>
              <input id="channelId" type="text" placeholder="@mychannel or -1001234567890" spellCheck={false}
                value={settings.channelId}
                onChange={(event) => updateSetting("channelId", event.target.value)} />
              <p className="hint">Add your bot as a channel admin before posting.</p>
            </div>
            <div className="field">
              <label htmlFor="captionPrefix">Caption prefix</label>
              <input id="captionPrefix" type="text"
                value={settings.captionPrefix}
                onChange={(event) => updateSetting("captionPrefix", event.target.value)} />
              <p className="hint">Leave empty for no prefix.</p>
            </div>
            <label className="switch-row" htmlFor="includePostLink">
              <span>Include link to original post</span>
              <input id="includePostLink" type="checkbox" role="switch"
                checked={settings.includePostLink}
                onChange={(event) => updateSetting("includePostLink", event.target.checked)} />
            </label>
            <div className="actions">
              <button type="submit">Save changes</button>
              <span id="status" role="status">{status || "Changes save automatically"}</span>
            </div>
          </fieldset>
        </form>
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<OptionsPage />);
}
