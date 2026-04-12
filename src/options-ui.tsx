import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ExtensionSettings, MessageResponse } from "./shared";
import { DEFAULT_SETTINGS } from "./shared";

function OptionsPage() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState("");
  const [cobaltTestStatus, setCobaltTestStatus] = useState("");
  const [testingCobalt, setTestingCobalt] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextAutosaveRef = useRef(true);

  const storage = useMemo(() => chrome.storage.local, []);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, hydrated]);

  async function saveSettings(message: string = "Saved") {
    const nextSettings: ExtensionSettings = {
      botToken: settings.botToken.trim(),
      channelId: settings.channelId.trim(),
      cobaltUrl: settings.cobaltUrl.trim(),
      cobaltAuthToken: settings.cobaltAuthToken.trim(),
      cobaltAuthScheme: settings.cobaltAuthScheme.trim() || "Api-Key",
      cobaltQuality: settings.cobaltQuality.trim() || "1080",
      autoPrefix: settings.autoPrefix
    };

    await storage.set(nextSettings);
    setStatus(message);
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(() => {
      setStatus((current) => (current === message ? "" : current));
    }, 1500);
  }

  async function testCobaltAuth() {
    setCobaltTestStatus("Testing...");
    setTestingCobalt(true);
    try {
      const response = (await chrome.runtime.sendMessage({
        type: "TEST_COBALT_AUTH",
        payload: {
          cobaltUrl: settings.cobaltUrl.trim(),
          cobaltAuthToken: settings.cobaltAuthToken.trim(),
          cobaltAuthScheme: settings.cobaltAuthScheme.trim() || "Api-Key",
          cobaltQuality: settings.cobaltQuality.trim() || "1080"
        }
      })) as MessageResponse;
      if (!response?.ok) throw new Error(response?.error || "Unknown error");
      const result = response.result as { status?: string };
      setCobaltTestStatus(`OK: ${result.status || "connected"}`);
    } catch (error: unknown) {
      setCobaltTestStatus(`Failed: ${getErrorMessage(error)}`);
    } finally {
      setTestingCobalt(false);
    }
  }

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
            <p>Connect Telegram, grant Cobalt access, and tune posting behavior.</p>
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
              <a href="#cobalt">Cobalt</a>
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
              <div className="section" id="cobalt">
                <h2>Cobalt</h2>
                <label htmlFor="cobaltUrl">Cobalt API URL</label>
                <input
                  id="cobaltUrl"
                  type="text"
                  placeholder="https://api.cobalt.tools"
                  value={settings.cobaltUrl}
                  onChange={(event) => updateSetting("cobaltUrl", event.target.value)}
                />
                <div className="hint">Use the hosted API or your own Cobalt instance for reliable video downloads.</div>
                <label htmlFor="cobaltAuthToken">Cobalt Auth Token</label>
                <input
                  id="cobaltAuthToken"
                  type="password"
                  placeholder="Optional token if your Cobalt is protected"
                  value={settings.cobaltAuthToken}
                  onChange={(event) => updateSetting("cobaltAuthToken", event.target.value)}
                />
                <label htmlFor="cobaltAuthScheme">Cobalt Auth Scheme</label>
                <input
                  id="cobaltAuthScheme"
                  type="text"
                  placeholder="Api-Key or Bearer"
                  value={settings.cobaltAuthScheme}
                  onChange={(event) => updateSetting("cobaltAuthScheme", event.target.value)}
                />
                <div className="hint">
                  Use <code>Api-Key</code> for most Cobalt API keys. Use <code>Bearer</code> only if your instance explicitly requires it.
                </div>
                <div className="hint">
                  If auth fails on a self-hosted instance, check that server's keys file (usually <code>keys.json</code>) for a UUIDv4 API key, then use <code>Api-Key</code> + that key. This extension cannot mint Cobalt keys for you.
                </div>
                <div className="hint">The first auth test or video send will ask the browser to allow access to the configured Cobalt host.</div>
                <label htmlFor="cobaltQuality">Video quality</label>
                <input
                  id="cobaltQuality"
                  type="text"
                  placeholder="1080"
                  value={settings.cobaltQuality}
                  onChange={(event) => updateSetting("cobaltQuality", event.target.value)}
                />
                <div className="hint">Examples: <code>1080</code>, <code>720</code>, <code>max</code></div>
                <div className="row">
                  <button type="button" onClick={() => void testCobaltAuth()} disabled={testingCobalt}>
                    Test Cobalt auth
                  </button>
                  <span className="hint" id="cobaltTestStatus">
                    {cobaltTestStatus}
                  </span>
                </div>
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<OptionsPage />);
}
