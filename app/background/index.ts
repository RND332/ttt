import {
  BROWSER_VIDEO_FETCH_FAILED_ERROR,
  BROWSER_VIDEO_INVALID_FILE_ERROR,
  downloadBrowserVideo
} from "../../src/browser-video-download";
import { getErrorMessage } from "../../src/error-message";
import { downloadHlsVideo } from "../../src/hls-video-download";
import { ensurePageBlobBridgeInstalled } from "../../src/page-blob-video-bridge-install";
import {
  RECOVERED_VIDEO_SOURCE_PRIORITY,
  classifyRecoveredVideoUrl
} from "../../src/page-stream-video-discovery-shared";
import { ensurePageStreamVideoDiscoveryInstalled } from "../../src/page-stream-video-discovery-install";
import {
  createRecoveredVideoCandidateStore,
  getBestRecoveredVideoCandidate,
  mergeRecoveredVideoCandidates
} from "../../src/recovered-video-candidates";
import { ensurePageTwitterVideoResolverInstalled } from "../../src/page-twitter-video-resolver-install";
import {
  isTwitterBrokenContainerTweetId,
  parseTwitterPostRef,
  resolveTwitterVideoCandidates,
  TWITTER_BROKEN_CONTAINER_POLICY_ERROR
} from "../../src/twitter-video-metadata-resolver";
import { getPostedPostIds, isPostPosted, recordPostedPost } from "../../src/posted-posts";
import { loadExtensionSettings } from "../../src/settings";
import type {
  BackgroundMessage,
  ExtensionSettings,
  MessageResponse,
  RecoveredVideoCandidate,
  PostPostedMessage,
  TelegramPhotoAlbumPayload,
  TelegramPhotoPayload,
  TelegramVideoPayload
} from "../../src/shared";

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set(await loadExtensionSettings());
  await chrome.storage.local.remove("autoPrefix");
});

const recoveredVideoCandidateStore = createRecoveredVideoCandidateStore();
const inFlightPosts = new Map<string, Promise<unknown>>();

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
  if (message?.type === "SEND_TO_TELEGRAM") {
    respondWith(sendResponse, sendToTelegram(sender, message.payload));
    return true;
  }

  if (message?.type === "ENSURE_PAGE_BLOB_BRIDGE") {
    respondWith(sendResponse, installPageBlobBridgeForSender(sender));
    return true;
  }

  if (message?.type === "ENSURE_PAGE_STREAM_VIDEO_DISCOVERY") {
    respondWith(sendResponse, installPageStreamDiscoveryForSender(sender));
    return true;
  }

  if (message?.type === "ENSURE_PAGE_TWITTER_VIDEO_RESOLVER") {
    respondWith(sendResponse, installPageTwitterVideoResolverForSender(sender));
    return true;
  }

  if (message?.type === "REPORT_RECOVERED_VIDEO_CANDIDATES") {
    respondWith(sendResponse, storeRecoveredVideoCandidates(sender, message.postUrl, message.candidates));
    return true;
  }

  if (message?.type === "GET_RECOVERED_VIDEO_CANDIDATES") {
    respondWith(sendResponse, getRecoveredVideoCandidates(sender, message.postUrl));
    return true;
  }

  if (message?.type === "GET_POSTED_POSTS") {
    respondWith(sendResponse, getPostedPostIds(message.postIds).then((postIds) => ({ postIds })));
    return true;
  }

  return false;
});

function respondWith<T>(
  sendResponse: (response: MessageResponse<T>) => void,
  operation: Promise<T>
) {
  operation
    .then((result) => sendResponse({ ok: true, result } satisfies MessageResponse<T>))
    .catch((error: unknown) => sendResponse({ ok: false, error: getErrorMessage(error) } satisfies MessageResponse<T>));
}

async function installPageBlobBridgeForSender(sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    throw new Error("Cannot install page blob bridge without a sender tab ID.");
  }

  await ensurePageBlobBridgeInstalled(chrome, {
    tabId,
    ...(sender.documentId
      ? { documentIds: [sender.documentId] }
      : typeof sender.frameId === "number"
        ? { frameIds: [sender.frameId] }
        : {})
  });
}

async function installPageStreamDiscoveryForSender(sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    throw new Error("Cannot install page stream discovery without a sender tab ID.");
  }

  return await ensurePageStreamVideoDiscoveryInstalled(chrome, {
    tabId,
    ...(sender.documentId
      ? { documentIds: [sender.documentId] }
      : typeof sender.frameId === "number"
        ? { frameIds: [sender.frameId] }
        : {})
  });
}

async function installPageTwitterVideoResolverForSender(sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    throw new Error("Cannot install page Twitter/X video resolver without a sender tab ID.");
  }

  return await ensurePageTwitterVideoResolverInstalled(chrome, {
    tabId,
    ...(sender.documentId
      ? { documentIds: [sender.documentId] }
      : typeof sender.frameId === "number"
        ? { frameIds: [sender.frameId] }
        : {})
  });
}

async function storeRecoveredVideoCandidates(
  sender: chrome.runtime.MessageSender,
  postUrl: string,
  candidates: RecoveredVideoCandidate[]
) {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    throw new Error("Cannot store recovered video candidates without a sender tab ID.");
  }

  return { stored: recoveredVideoCandidateStore.record(tabId, postUrl, candidates, { merge: true }) };
}

async function getRecoveredVideoCandidates(sender: chrome.runtime.MessageSender, postUrl: string) {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    return { candidates: [] };
  }

  return {
    candidates: recoveredVideoCandidateStore.get(tabId, postUrl)
  };
}

async function sendToTelegram(
  sender: chrome.runtime.MessageSender,
  payload: TelegramPhotoPayload | TelegramPhotoAlbumPayload | TelegramVideoPayload
) {
  const settings = await loadExtensionSettings();

  if (!settings.botToken || !settings.channelId) {
    throw new Error("Configure your Telegram bot token and channel ID in extension options.");
  }

  if (!payload?.postUrl) {
    throw new Error("Missing post URL.");
  }

  const postId = parseTwitterPostRef(payload.postUrl)?.tweetId;
  if (!postId) throw new Error("Invalid X post URL.");

  const pending = inFlightPosts.get(postId);
  if (pending) return pending;

  const operation = (async () => {
    if (await isPostPosted(postId)) return { alreadyPosted: true };

    let result: unknown;
    switch (payload.kind) {
      case "video":
        result = await sendVideo(sender, settings, payload);
        break;
      case "photo":
        result = await sendPhoto(settings, payload);
        break;
      case "photo-album":
        result = await sendPhotoAlbum(settings, payload);
        break;
      default:
        throw new Error("Unsupported media type.");
    }

    await recordPostedPost(postId);
    void notifyPosted(postId).catch((error: unknown) => {
      console.warn("[TTT] Post saved, but open tabs could not be notified", error);
    });
    return result;
  })().finally(() => inFlightPosts.delete(postId));
  inFlightPosts.set(postId, operation);
  return operation;
}

async function notifyPosted(postId: string) {
  const tabs = await chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] });
  // Tabs may have navigated away or not loaded a content script yet.
  const notifications: Promise<unknown>[] = [];
  for (const tab of tabs) {
    if (tab.id !== undefined) {
      notifications.push(chrome.tabs.sendMessage(tab.id, { type: "POST_POSTED", postId } satisfies PostPostedMessage));
    }
  }
  await Promise.allSettled(notifications);
}

async function sendPhoto(settings: ExtensionSettings, payload: TelegramPhotoPayload) {
  if (!payload.mediaUrl) {
    throw new Error("Missing image URL.");
  }

  const url = `https://api.telegram.org/bot${settings.botToken}/sendPhoto`;
  const body = {
    chat_id: settings.channelId,
    photo: payload.mediaUrl,
    caption: buildCaption(payload.postUrl, settings),
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
      ...(index === 0 && mediaIndex === 0 ? { caption: buildCaption(payload.postUrl, settings), parse_mode: "HTML" } : {})
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

async function sendVideo(
  sender: chrome.runtime.MessageSender,
  settings: ExtensionSettings,
  payload: TelegramVideoPayload
) {
  const canRecoverCandidates = !payload.videoBlobBytes?.length;
  const recoveredCandidates = canRecoverCandidates
    ? await getRecoveredVideoCandidates(sender, payload.postUrl).then((result) => result.candidates)
    : [];

  let authoritativeCandidates: RecoveredVideoCandidate[] = [];
  let resolverBrokenContainerPolicyError: string | null = null;
  if (canRecoverCandidates) {
    try {
      authoritativeCandidates = await resolveTwitterVideoCandidates(payload.postUrl, fetch);
    } catch (error: unknown) {
      if (getErrorMessage(error) === TWITTER_BROKEN_CONTAINER_POLICY_ERROR) {
        resolverBrokenContainerPolicyError = TWITTER_BROKEN_CONTAINER_POLICY_ERROR;
      }
    }
  }

  const mergedCandidates = mergeRecoveredVideoCandidates(
    authoritativeCandidates,
    getPayloadVideoCandidates(payload),
    recoveredCandidates
  );
  const recoveredDirectVideoUrl = getBestRecoveredVideoDirectCandidate(mergedCandidates)?.url || null;
  const recoveredPlaylistUrl = getRecoveredPlaylistCandidate(mergedCandidates)?.url || null;
  const brokenContainerPolicy = getTwitterBrokenContainerPolicyForPost(payload.postUrl, mergedCandidates);
  const directVideoUrl = brokenContainerPolicy.preferPlaylist ? null : (recoveredDirectVideoUrl || payload.videoUrl);
  const playlistUrl = recoveredPlaylistUrl || payload.playlistUrl;
  const brokenContainerPolicyError = brokenContainerPolicy.error || resolverBrokenContainerPolicyError;

  if (brokenContainerPolicyError && !playlistUrl) {
    throw new Error(brokenContainerPolicyError);
  }

  const video = payload.videoBlobBytes?.length
    ? reconstructTransferredVideo(payload)
    : await resolveVideoForSend(directVideoUrl, playlistUrl);

  if (!video) {
    throw new Error("Could not find a trustworthy downloadable video URL for this post. To avoid sending the wrong video, TTT stopped instead.");
  }

  const formData = new FormData();
  formData.append("chat_id", settings.channelId);
  formData.append("caption", buildCaption(payload.postUrl, settings));
  formData.append("parse_mode", "HTML");
  formData.append("video", video.blob, video.filename || "video.mp4");

  const url = `https://api.telegram.org/bot${settings.botToken}/sendVideo`;
  const response = await fetch(url, {
    method: "POST",
    body: formData
  });

  return handleTelegramResponse(response);
}

function reconstructTransferredVideo(payload: TelegramVideoPayload) {
  const bytes = new Uint8Array(payload.videoBlobBytes || []);
  return {
    blob: new Blob([bytes], { type: payload.videoMimeType || "video/mp4" }),
    filename: payload.videoFilename || "video.mp4"
  };
}

async function resolveVideoForSend(directVideoUrl: string | null | undefined, playlistUrl: string | null | undefined) {
  if (directVideoUrl) {
    try {
      return await downloadBrowserVideo(directVideoUrl, deriveVideoFilename(directVideoUrl));
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      const canRescueWithPlaylist = errorMessage === BROWSER_VIDEO_FETCH_FAILED_ERROR
        || errorMessage === BROWSER_VIDEO_INVALID_FILE_ERROR
        || /^Failed to download video file: (403|404|410)$/.test(errorMessage);

      if (!playlistUrl || !canRescueWithPlaylist) {
        throw error;
      }
    }
  }

  if (playlistUrl) {
    return await downloadHlsVideo(playlistUrl);
  }

  return null;
}

function deriveVideoFilename(url: string) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const lastSegment = parts.length ? parts[parts.length - 1] : undefined;
    return lastSegment || "video.mp4";
  } catch {
    return "video.mp4";
  }
}

function getPayloadVideoCandidates(payload: TelegramVideoPayload): RecoveredVideoCandidate[] {
  const candidates: RecoveredVideoCandidate[] = [];

  if (payload.videoUrl && classifyRecoveredVideoUrl(payload.videoUrl) === "direct-mp4") {
    candidates.push({
      kind: "direct-mp4",
      url: payload.videoUrl
    });
  }

  if (payload.playlistUrl && classifyRecoveredVideoUrl(payload.playlistUrl) === "hls-playlist") {
    candidates.push({
      kind: "hls-playlist",
      url: payload.playlistUrl
    });
  }

  return candidates;
}

function getBestRecoveredVideoDirectCandidate(candidates: RecoveredVideoCandidate[]) {
  return getBestRecoveredVideoCandidate(
    candidates.filter((candidate) => candidate.kind === "direct-mp4")
  );
}

function getRecoveredPlaylistCandidate(candidates: RecoveredVideoCandidate[]) {
  const playlistCandidates = candidates.filter(
    (candidate) => candidate.kind === "hls-playlist" && classifyRecoveredVideoUrl(candidate.url) === "hls-playlist"
  );

  if (playlistCandidates.length === 0) {
    return null;
  }

  return playlistCandidates.reduce((bestCandidate, candidate) => {
    if (!bestCandidate) {
      return candidate;
    }

    const candidateSourceScore = scoreRecoveredPlaylistSource(candidate.source);
    const bestSourceScore = scoreRecoveredPlaylistSource(bestCandidate.source);

    if (candidateSourceScore < bestSourceScore) {
      return candidate;
    }

    if (candidateSourceScore === bestSourceScore) {
      return candidate;
    }

    return bestCandidate;
  }, null as RecoveredVideoCandidate | null);
}

function getTwitterBrokenContainerPolicyForPost(postUrl: string, candidates: RecoveredVideoCandidate[]) {
  const tweetId = parseTwitterPostRef(postUrl)?.tweetId || null;
  const isBrokenWindow = isTwitterBrokenContainerTweetId(tweetId);
  const hasPlaylist = candidates.some((candidate) => candidate.kind === "hls-playlist");
  const hasDirectMp4 = candidates.some((candidate) => candidate.kind === "direct-mp4");

  return {
    preferPlaylist: isBrokenWindow && hasPlaylist,
    error: isBrokenWindow && hasDirectMp4 && !hasPlaylist
      ? TWITTER_BROKEN_CONTAINER_POLICY_ERROR
      : null
  };
}

function scoreRecoveredPlaylistSource(source: RecoveredVideoCandidate["source"]) {
  if (!source) {
    return RECOVERED_VIDEO_SOURCE_PRIORITY.length;
  }

  const index = RECOVERED_VIDEO_SOURCE_PRIORITY.indexOf(source);
  return index === -1 ? RECOVERED_VIDEO_SOURCE_PRIORITY.length : index;
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

function buildCaption(postUrl: string, settings: ExtensionSettings) {
  const prefix = settings.captionPrefix.trim();
  const caption = prefix ? escapeCaption(prefix) : "";
  if (!settings.includePostLink) return caption;
  const link = escapeCaption(postUrl);
  return caption ? `${caption}\n${link}` : link;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

