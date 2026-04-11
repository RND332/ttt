import type {
  BackgroundMessage,
  CobaltResolution,
  ExtensionSettings,
  MessageResponse,
  TelegramPhotoAlbumPayload,
  TelegramPhotoPayload,
  TelegramVideoPayload
} from "../../src/shared";
import { DEFAULT_SETTINGS } from "../../src/shared";

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set({ ...DEFAULT_SETTINGS, ...existing });
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, _sender, sendResponse) => {
  if (message?.type === "SEND_TO_TELEGRAM") {
    sendToTelegram(message.payload)
      .then((result) => sendResponse({ ok: true, result } satisfies MessageResponse))
      .catch((error: unknown) => sendResponse({ ok: false, error: getErrorMessage(error) } satisfies MessageResponse));
    return true;
  }

  if (message?.type === "TEST_COBALT_AUTH") {
    testCobaltAuth(message.payload)
      .then((result) => sendResponse({ ok: true, result } satisfies MessageResponse))
      .catch((error: unknown) => sendResponse({ ok: false, error: getErrorMessage(error) } satisfies MessageResponse));
    return true;
  }

  return false;
});

async function sendToTelegram(payload: TelegramPhotoPayload | TelegramPhotoAlbumPayload | TelegramVideoPayload) {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS) as ExtensionSettings;

  if (!settings.botToken || !settings.channelId) {
    throw new Error("Configure your Telegram bot token and channel ID in extension options.");
  }

  if (!payload?.postUrl) {
    throw new Error("Missing post URL.");
  }

  if (payload.kind === "video") {
    return sendVideo(settings, payload.postUrl);
  }

  if (payload.kind === "photo") {
    return sendPhoto(settings, payload);
  }

  if (payload.kind === "photo-album") {
    return sendPhotoAlbum(settings, payload);
  }

  throw new Error("Unsupported media type.");
}

async function sendPhoto(settings: ExtensionSettings, payload: TelegramPhotoPayload) {
  if (!payload.mediaUrl) {
    throw new Error("Missing image URL.");
  }

  const url = `https://api.telegram.org/bot${settings.botToken}/sendPhoto`;
  const body = {
    chat_id: settings.channelId,
    photo: payload.mediaUrl,
    caption: buildCaption(payload.postUrl, settings.autoPrefix),
    parse_mode: "HTML"
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  return handleTelegramResponse(response);
}

async function sendPhotoAlbum(settings: ExtensionSettings, payload: TelegramPhotoAlbumPayload) {
  if (!payload.mediaUrls.length) {
    throw new Error("Missing image URLs.");
  }

  const chunks = chunkArray(payload.mediaUrls, 10);
  const results = [];

  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    const media = chunk.map((url, mediaIndex) => ({
      type: "photo",
      media: url,
      ...(index === 0 && mediaIndex === 0 ? { caption: buildCaption(payload.postUrl, settings.autoPrefix), parse_mode: "HTML" } : {})
    }));

    const response = await fetch(`https://api.telegram.org/bot${settings.botToken}/sendMediaGroup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: settings.channelId, media })
    });

    results.push(await handleTelegramResponse(response));
  }

  return results;
}

async function sendVideo(settings: ExtensionSettings, postUrl: string) {
  const video = await downloadVideoViaCobalt(settings, postUrl);
  const formData = new FormData();
  formData.append("chat_id", settings.channelId);
  formData.append("caption", buildCaption(postUrl, settings.autoPrefix));
  formData.append("video", video.blob, video.filename || "video.mp4");

  const url = `https://api.telegram.org/bot${settings.botToken}/sendVideo`;
  const response = await fetch(url, {
    method: "POST",
    body: formData
  });

  return handleTelegramResponse(response);
}

async function testCobaltAuth(payload: Pick<ExtensionSettings, "cobaltUrl" | "cobaltAuthToken" | "cobaltAuthScheme" | "cobaltQuality">) {
  const api = normalizeCobaltUrl(payload.cobaltUrl);
  await ensureCobaltOriginPermission(api);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };

  if (payload.cobaltAuthToken) {
    headers.Authorization = `${normalizeAuthScheme(payload.cobaltAuthScheme)} ${payload.cobaltAuthToken}`;
  }

  const response = await fetch(`${api}/`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      url: "https://x.com/jack/status/20",
      videoQuality: payload.cobaltQuality || "1080",
      downloadMode: "auto",
      localProcessing: "disabled"
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(formatCobaltAuthError(data, response.status, api));
  }
  return data;
}

async function downloadVideoViaCobalt(settings: Pick<ExtensionSettings, "cobaltUrl" | "cobaltAuthToken" | "cobaltAuthScheme" | "cobaltQuality">, sourceUrl: string) {
  const api = normalizeCobaltUrl(settings.cobaltUrl);
  await ensureCobaltOriginPermission(api);
  const requestBody = {
    url: sourceUrl,
    videoQuality: settings.cobaltQuality || "1080",
    downloadMode: "auto",
    localProcessing: "disabled"
  };

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json"
  };

  if (settings.cobaltAuthToken) {
    headers.Authorization = `${normalizeAuthScheme(settings.cobaltAuthScheme)} ${settings.cobaltAuthToken}`;
  }

  const response = await fetch(`${api}/`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(formatCobaltAuthError(data, response.status, api));
  }

  const resolution = resolveCobaltDownload(data);
  if (!resolution.url) {
    throw new Error(`Cobalt could not resolve video: ${data?.error?.code || data.status || "unknown"}`);
  }

  return fetchBinaryFile(resolution.url, resolution.filename || data.filename || data.output?.filename || "video.mp4");
}

function resolveCobaltDownload(data: any): CobaltResolution {
  if (data.status === "redirect" && data.url) return { url: data.url, filename: data.filename };
  if (data.status === "tunnel" && data.url) return { url: data.url, filename: data.filename };
  if (data.status === "local-processing" && Array.isArray(data.tunnel) && data.tunnel.length > 0) {
    return { url: data.tunnel[0], filename: data.output?.filename };
  }
  if (data.status === "picker" && Array.isArray(data.picker)) {
    const videoItem = data.picker.find((item: any) => item.type === "video") || data.picker[0];
    if (videoItem?.url) return { url: videoItem.url, filename: videoItem.filename || videoItem.thumb };
  }
  return { url: null, filename: null };
}

function normalizeCobaltUrl(url: string) {
  const cleaned = String(url || "").trim().replace(/\/$/, "");
  return cleaned || "https://api.cobalt.tools";
}

async function ensureCobaltOriginPermission(url: string) {
  const origin = toPermissionOrigin(url);
  const contains = await chrome.permissions.contains({ origins: [origin] });
  if (contains) return;

  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    throw new Error(`Grant TTT access to ${origin.slice(0, -2)} to use this Cobalt instance.`);
  }
}

function toPermissionOrigin(url: string) {
  const parsed = new URL(normalizeCobaltUrl(url));
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Cobalt URL must use HTTP or HTTPS.");
  }

  return `${parsed.origin}/*`;
}

function normalizeAuthScheme(scheme: string) {
  const cleaned = String(scheme || "Api-Key").trim();
  if (!cleaned) return "Api-Key";
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(cleaned) ? cleaned : "Api-Key";
}

function formatCobaltAuthError(data: any, status: number, api: string) {
  const code = data?.error?.code || data?.error || data?.code || null;
  const message = data?.error?.message || data?.message || data?.description || null;
  const authHint = code && typeof code === "string" && code.includes("auth")
    ? ` Check the API key and scheme in Cobalt. For a self-hosted instance, verify the UUIDv4 key in keys.json and use Api-Key first.`
    : "";
  const detail = message ? ` (${message})` : "";
  const codePart = code ? `: ${code}` : "";
  return `Cobalt request failed${codePart || `: ${status}`}${detail}${authHint} [${api}]`;
}

async function fetchBinaryFile(url: string, filename: string) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(`Failed to download video file: ${response.status}`);
  }
  const blob = await response.blob();
  return { blob, filename };
}

async function handleTelegramResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram API error: ${response.status}`);
  }
  return data.result;
}

function escapeCaption(text: string) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildCaption(postUrl: string, autoPrefix: boolean) {
  const prefix = autoPrefix ? "New post\n" : "";
  return `${prefix}${escapeCaption(postUrl)}`;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
