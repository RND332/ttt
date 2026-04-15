import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ExtensionSettings } from "./shared";
import { DEFAULT_SETTINGS } from "./shared";

function normalizeSettings(settings: ExtensionSettings): ExtensionSettings {
  return {
    botToken: settings.botToken.trim(),
    channelId: settings.channelId.trim(),
    autoPrefix: settings.autoPrefix
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
      const loaded = (await storage.get(DEFAULT_SETTINGS)) as ExtensionSettings;
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
      <div className="card">
        <div className="topbar">
          <div>
            <div className="eyebrow">Extension settings</div>
            <h1>TTT</h1>
            <p>Connect Telegram and tune posting behavior.</p>
          </div>
          <div className="row" style={{ marginTop: 0 }}>
            <button type="button" onClick={() => void saveSettings()}>
              Save
            </button>
          </div>
        </div>
        <div className="divider" />

        <div className="layout">
          <aside className="sidebar">
            <h2>Sections</h2>
            <nav>
              <a href="#telegram">Telegram</a>
              <a href="#behavior">Behavior</a>
            </nav>
          </aside>

          <main className="main">
            <div className="grid">
              <div className="section" id="telegram">
                <h2>Telegram</h2>
                <label htmlFor="botToken">Bot Token</label>
                <input
                  id="botToken"
                  type="password"
                  placeholder="123456:ABC-DEF..."
                  value={settings.botToken}
                  onChange={(event) => updateSetting("botToken", event.target.value)}
                />
                <label htmlFor="channelId">Channel ID or @username</label>
                <input
                  id="channelId"
                  type="text"
                  placeholder="@mychannel or -1001234567890"
                  value={settings.channelId}
                  onChange={(event) => updateSetting("channelId", event.target.value)}
                />
                <div className="hint">This is where media will be posted.</div>
              </div>
              <div className="section" id="behavior">
                <h2>Behavior</h2>
                <label>
                  <input
                    id="autoPrefix"
                    type="checkbox"
                    checked={settings.autoPrefix}
                    onChange={(event) => updateSetting("autoPrefix", event.target.checked)}
                  />
                  Prefix Telegram captions with “New post”
                </label>
                <div className="hint">Videos are downloaded directly in the browser from X/Twitter when a usable direct file URL is exposed.</div>
                <div className="hint">If X falls back to an HLS playlist, TTT retries through any direct MP4 variant exposed by that playlist before failing.</div>
                <div className="hint">Set <code>localStorage.ttt-debug = 1</code> in the page console to log classification details.</div>
              </div>
            </div>
            <div className="row">
              <button type="button" onClick={() => void saveSettings()}>
                Save
              </button>
              <span id="status">{status}</span>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<OptionsPage />);
}
