import { getBestRecoveredVideoCandidate } from "./recovered-video-candidates";
import type {
  BackgroundMessage,
  GetRecoveredVideoCandidatesResult,
  MessageResponse,
  RecoveredVideoCandidate,
  TelegramSendPayload,
  TelegramVideoPayload
} from "./shared";
import { resolveTwitterVideoCandidatesFromPage } from "./page-twitter-video-resolver";
import { createBlobBridgeClient, type BlobBridgeSuccess } from "./page-blob-video-bridge";
import { sendExtensionMessage } from "./runtime-messaging";

type BlobBridgeClient = {
  resolveBlobUrl: (blobUrl: string) => Promise<BlobBridgeSuccess>;
};

type CreateSendHandlerOptions = {
  blobBridgeClient?: BlobBridgeClient;
};

export function createSendHandler(options: CreateSendHandlerOptions = {}) {
  return async (payload: TelegramSendPayload) => {
    const resolvedPayload = payload.kind === "video"
      ? await resolveVideoPayload(payload, options.blobBridgeClient)
      : payload;

    return await sendExtensionMessage<MessageResponse<unknown>>({
      type: "SEND_TO_TELEGRAM",
      payload: resolvedPayload
    } satisfies BackgroundMessage);
  };
}

async function resolveVideoPayload(payload: TelegramVideoPayload, blobBridgeClient?: BlobBridgeClient): Promise<TelegramVideoPayload> {
  if (payload.videoUrl || payload.playlistUrl) {
    return payload;
  }

  if (!payload.blobUrl) {
    return await resolveRecoveredVideoPayload(payload) ?? payload;
  }

  const installResponse = await sendExtensionMessage<MessageResponse<unknown>>({
    type: "ENSURE_PAGE_BLOB_BRIDGE"
  } satisfies BackgroundMessage);
  if (installResponse.ok === false) {
    throw new Error(installResponse.error || "Failed to install page blob bridge.");
  }

  const blob = await (blobBridgeClient ?? createBlobBridgeClient()).resolveBlobUrl(payload.blobUrl)
    .catch(async (error: unknown) => {
      if (!isStreamBackedBlobError(error)) {
        throw error;
      }

      const recoveredPayload = await resolveRecoveredVideoPayload(payload);
      return {
        recoveredPayload: recoveredPayload ?? payload
      };
    });

  if ("recoveredPayload" in blob) {
    return blob.recoveredPayload;
  }

  return {
    kind: "video",
    postUrl: payload.postUrl,
    videoBlobBytes: blob.bytes,
    videoFilename: payload.videoFilename || inferBlobFilename(blob.mimeType),
    videoMimeType: blob.mimeType || payload.videoMimeType || "video/mp4"
  };
}

function isStreamBackedBlobError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /stream-backed|MediaSource|cannot fetch it directly yet/i.test(message);
}

async function resolveRecoveredVideoPayload(payload: TelegramVideoPayload): Promise<TelegramVideoPayload | null> {
  const [storedCandidates, pageResolvedCandidates] = await Promise.all([
    getRecoveredVideoCandidates(payload.postUrl),
    getPageResolvedVideoCandidates(payload.postUrl)
  ]);

  const bestCandidate = getBestRecoveredVideoCandidate([
    ...pageResolvedCandidates,
    ...storedCandidates
  ]);
  if (!bestCandidate) {
    return null;
  }

  return bestCandidate.kind === "direct-mp4"
    ? {
        ...payload,
        videoUrl: bestCandidate.url
      }
    : {
        ...payload,
        playlistUrl: bestCandidate.url
      };
}

async function getPageResolvedVideoCandidates(postUrl: string): Promise<RecoveredVideoCandidate[]> {
  try {
    return await resolveTwitterVideoCandidatesFromPage(postUrl);
  } catch {
    return [];
  }
}

async function getRecoveredVideoCandidates(postUrl: string): Promise<RecoveredVideoCandidate[]> {
  const response = await sendExtensionMessage<MessageResponse<GetRecoveredVideoCandidatesResult>>({
    type: "GET_RECOVERED_VIDEO_CANDIDATES",
    postUrl
  } satisfies BackgroundMessage);

  if (response.ok === false) {
    return [];
  }

  return response.result?.candidates || [];
}

function inferBlobFilename(mimeType: string | undefined) {
  if (mimeType === "video/webm") return "video.webm";
  if (mimeType === "video/quicktime") return "video.mov";
  return "video.mp4";
}

