export {};

import type { ExtensionSettings, MessageResponse } from "./shared";
import { DEFAULT_SETTINGS } from "./shared";

const STORAGE_AREA = chrome.storage.local;

const botToken = document.getElementById("botToken") as HTMLInputElement | null;
const channelId = document.getElementById("channelId") as HTMLInputElement | null;
const cobaltUrl = document.getElementById("cobaltUrl") as HTMLInputElement | null;
const cobaltAuthToken = document.getElementById("cobaltAuthToken") as HTMLInputElement | null;
const cobaltAuthScheme = document.getElementById("cobaltAuthScheme") as HTMLInputElement | null;
const cobaltQuality = document.getElementById("cobaltQuality") as HTMLInputElement | null;
const autoPrefix = document.getElementById("autoPrefix") as HTMLInputElement | null;
const status = document.getElementById("status") as HTMLSpanElement | null;
const testCobalt = document.getElementById("testCobalt") as HTMLButtonElement | null;
const cobaltTestStatus = document.getElementById("cobaltTestStatus") as HTMLSpanElement | null;
const saveButton = document.getElementById("save");
const saveTopButton = document.getElementById("saveTop");
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

async function saveSettings(message = "Saved") {
  const controls = getControls();
  if (!controls) return;

  const settings: ExtensionSettings = {
    botToken: controls.botToken.value.trim(),
    channelId: controls.channelId.value.trim(),
    cobaltUrl: controls.cobaltUrl.value.trim(),
    cobaltAuthToken: controls.cobaltAuthToken.value.trim(),
    cobaltAuthScheme: controls.cobaltAuthScheme.value.trim() || "Api-Key",
    cobaltQuality: controls.cobaltQuality.value.trim() || "1080",
    autoPrefix: controls.autoPrefix.checked
  };

  await STORAGE_AREA.set(settings);
  controls.status.textContent = message;
  setTimeout(() => {
    if (controls.status.textContent === message) controls.status.textContent = "";
  }, 1500);
}

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    void saveSettings("Auto-saved");
  }, 500);
}

if (saveButton && saveTopButton) {
  saveButton.addEventListener("click", () => void saveSettings());
  saveTopButton.addEventListener("click", () => void saveSettings());
}

if (testCobalt && cobaltTestStatus && cobaltUrl && cobaltAuthToken && cobaltAuthScheme && cobaltQuality) {
  testCobalt.addEventListener("click", async () => {
    cobaltTestStatus.textContent = "Testing...";
    testCobalt.disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({
        type: "TEST_COBALT_AUTH",
        payload: {
          cobaltUrl: cobaltUrl.value.trim(),
          cobaltAuthToken: cobaltAuthToken.value.trim(),
          cobaltAuthScheme: cobaltAuthScheme.value.trim() || "Api-Key",
          cobaltQuality: cobaltQuality.value.trim() || "1080"
        }
      }) as MessageResponse;
      if (!response?.ok) throw new Error(response?.error || "Unknown error");
      cobaltTestStatus.textContent = `OK: ${(response.result as { status?: string }).status || "connected"}`;
    } catch (error: unknown) {
      cobaltTestStatus.textContent = `Failed: ${getErrorMessage(error)}`;
    } finally {
      testCobalt.disabled = false;
    }
  });
}

if (botToken && channelId && cobaltUrl && cobaltAuthToken && cobaltAuthScheme && cobaltQuality && autoPrefix && status) {
  const inputs = [botToken, channelId, cobaltUrl, cobaltAuthToken, cobaltAuthScheme, cobaltQuality, autoPrefix];

  inputs.forEach((input) => {
    input.addEventListener("input", scheduleAutosave);
    input.addEventListener("change", scheduleAutosave);
  });

  (async function init() {
    const settings = await STORAGE_AREA.get(DEFAULT_SETTINGS) as ExtensionSettings;
    botToken.value = settings.botToken;
    channelId.value = settings.channelId;
    cobaltUrl.value = settings.cobaltUrl;
    cobaltAuthToken.value = settings.cobaltAuthToken;
    cobaltAuthScheme.value = settings.cobaltAuthScheme;
    cobaltQuality.value = settings.cobaltQuality;
    autoPrefix.checked = settings.autoPrefix;
  })();
}

function getControls() {
  if (!botToken || !channelId || !cobaltUrl || !cobaltAuthToken || !cobaltAuthScheme || !cobaltQuality || !autoPrefix || !status) {
    return null;
  }

  return {
    botToken,
    channelId,
    cobaltUrl,
    cobaltAuthToken,
    cobaltAuthScheme,
    cobaltQuality,
    autoPrefix,
    status
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
