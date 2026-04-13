import { sendExtensionMessage } from "./runtime-messaging";
import type { BackgroundMessage, MessageResponse, RecoveredVideoCandidate } from "./shared";
import {
  extractTwitterVideoCandidatesFromMedia,
  parseTwitterPostRef,
} from "./twitter-video-metadata-resolver";

export const TTT_PAGE_TWITTER_VIDEO_REQUEST = "TTT_PAGE_TWITTER_VIDEO_REQUEST";
export const TTT_PAGE_TWITTER_VIDEO_RESPONSE = "TTT_PAGE_TWITTER_VIDEO_RESPONSE";

interface PageTwitterVideoRequest {
  type: typeof TTT_PAGE_TWITTER_VIDEO_REQUEST;
  requestId: string;
  tweetId: string;
}

type PageTwitterVideoSuccessResponse = {
  type: typeof TTT_PAGE_TWITTER_VIDEO_RESPONSE;
  requestId: string;
  ok: true;
  payload: unknown;
};

type PageTwitterVideoErrorResponse = {
  type: typeof TTT_PAGE_TWITTER_VIDEO_RESPONSE;
  requestId: string;
  ok: false;
  error: string;
};

type PageTwitterVideoResponse = PageTwitterVideoSuccessResponse | PageTwitterVideoErrorResponse;

type ClientOptions = {
  timeoutMs?: number;
  targetWindow?: Window;
};

export function createPageTwitterVideoResolverClient(options: ClientOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const targetWindow = options.targetWindow ?? window;

  return {
    async resolveTweet(tweetId: string): Promise<unknown> {
      const requestId = `ttt-page-twitter-video-${Math.random().toString(36).slice(2)}`;

      return await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error("Timed out while resolving authenticated Twitter/X video metadata from the page."));
        }, timeoutMs);

        const onMessage = (event: Event) => {
          const message = event as MessageEvent<PageTwitterVideoResponse>;
          if (message.source !== targetWindow) return;
          if (message.data?.type !== TTT_PAGE_TWITTER_VIDEO_RESPONSE) return;
          if (message.data.requestId !== requestId) return;

          cleanup();
          if (message.data.ok === false) {
            reject(new Error(message.data.error || "Failed to resolve authenticated Twitter/X video metadata from the page."));
            return;
          }

          resolve(message.data.payload);
        };

        function cleanup() {
          clearTimeout(timeoutId);
          targetWindow.removeEventListener("message", onMessage);
        }

        targetWindow.addEventListener("message", onMessage);
        targetWindow.postMessage({
          type: TTT_PAGE_TWITTER_VIDEO_REQUEST,
          requestId,
          tweetId,
        } satisfies PageTwitterVideoRequest, "*");
      });
    },
  };
}

export async function resolveTwitterVideoCandidatesFromPage(postUrl: string): Promise<RecoveredVideoCandidate[]> {
  const postRef = parseTwitterPostRef(postUrl);
  if (!postRef) {
    return [];
  }

  const installResponse = await sendExtensionMessage<MessageResponse<unknown>>({
    type: "ENSURE_PAGE_TWITTER_VIDEO_RESOLVER",
  } satisfies BackgroundMessage);
  if (installResponse.ok === false) {
    throw new Error(installResponse.error || "Failed to install page Twitter/X video resolver.");
  }

  const payload = await createPageTwitterVideoResolverClient().resolveTweet(postRef.tweetId);
  return extractTwitterVideoCandidatesFromPagePayload(payload, { videoIndex: postRef.videoIndex });
}

export function extractTwitterVideoCandidatesFromPagePayload(
  payload: unknown,
  options: { videoIndex?: number | null } = {}
): RecoveredVideoCandidate[] {
  const normalizedTweet = unwrapPageTweetResult(
    (payload as { data?: { tweetResult?: { result?: unknown } }; tweetResult?: { result?: unknown } } | null | undefined)?.data?.tweetResult?.result
      || (payload as { tweetResult?: { result?: unknown } } | null | undefined)?.tweetResult?.result
      || payload
  );

  if (!normalizedTweet || normalizedTweet.__typename === "TweetTombstone") {
    return [];
  }

  const cardMedia = extractMediaFromPageCard((normalizedTweet as { card?: unknown }).card);
  const legacy = (normalizedTweet as { legacy?: { extended_entities?: { media?: unknown }; retweeted_status_result?: { result?: unknown } } }).legacy;
  const retweetedLegacy = unwrapPageTweetResult(legacy?.retweeted_status_result?.result)?.legacy;
  const media = cardMedia.length > 0
    ? cardMedia
    : retweetedLegacy?.extended_entities?.media
      || legacy?.extended_entities?.media
      || (normalizedTweet as { extended_entities?: { media?: unknown } }).extended_entities?.media;

  return extractTwitterVideoCandidatesFromMedia(media, {
    videoIndex: options.videoIndex ?? null,
  });
}

function unwrapPageTweetResult(result: unknown): any {
  if (!result || typeof result !== "object") {
    return null;
  }

  const record = result as any;
  if (record.__typename === "TweetWithVisibilityResults") {
    return unwrapPageTweetResult(record.tweet);
  }

  if (record.tweet?.legacy) {
    return record.tweet;
  }

  return record;
}

function extractMediaFromPageCard(cardOuter: unknown) {
  try {
    const bindingValue = (cardOuter as any)?.legacy?.binding_values?.[0]?.value?.string_value
      || (cardOuter as any)?.binding_values?.unified_card?.string_value;
    if (!bindingValue) {
      return [] as unknown[];
    }

    const card = JSON.parse(bindingValue);
    const mediaId = card?.component_objects?.media_1?.data?.id;
    const mediaEntity = mediaId ? card?.media_entities?.[mediaId] : null;
    return mediaEntity ? [mediaEntity] : [];
  } catch {
    return [] as unknown[];
  }
}
