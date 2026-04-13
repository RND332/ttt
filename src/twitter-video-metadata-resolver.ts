import { mergeRecoveredVideoCandidates } from "./recovered-video-candidates";
import type { RecoveredVideoCandidate } from "./shared";

const TWITTER_GUEST_ACTIVATE_URL = "https://api.x.com/1.1/guest/activate.json";
const TWITTER_TWEET_DETAIL_URL = "https://api.x.com/graphql/4Siu98E55GquhG52zHdY5w/TweetDetail";
const TWITTER_SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result";
const TWITTER_BEARER_TOKEN =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const TWEET_DETAIL_FEATURES = {
  rweb_video_screen_enabled: false,
  payments_enabled: false,
  rweb_xchat_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
} as const;

const TWEET_DETAIL_FIELD_TOGGLES = {
  withArticleRichContentState: true,
  withArticlePlainText: false,
  withGrokAnalyze: false,
  withDisallowedReplyControls: false,
} as const;

const TWEET_DETAIL_VARIABLES_BASE = {
  with_rux_injections: false,
  rankingMode: "Relevance",
  includePromotedContent: true,
  withCommunity: true,
  withQuickPromoteEligibilityTweetFields: true,
  withBirdwatchNotes: true,
  withVoice: true,
} as const;

const TWITTER_POST_HOST_PATTERN = /^(?:www\.)?(?:x\.com|twitter\.com|mobile\.twitter\.com)$/i;
const TWITTER_EPOCH = BigInt("1288834974657");
const TWITTER_SNOWFLAKE_TIMESTAMP_SHIFT = BigInt(22);
const TWITTER_BROKEN_CONTAINER_START_MS = 1701446400000;
const TWITTER_BROKEN_CONTAINER_END_MS = 1702605600000;

export const TWITTER_BROKEN_CONTAINER_POLICY_ERROR =
  "This X/Twitter video falls in a known broken-container window. A playlist rescue is required because direct MP4 bytes may be broken.";

type FetchLike = typeof fetch;

export interface TwitterPostRef {
  canonicalUrl: string;
  tweetId: string;
  videoIndex: number | null;
}

export interface TwitterVideoVariant {
  bitrate?: number;
  contentType: string;
  url: string;
}

interface TwitterVariantLike {
  bitrate?: number;
  content_type?: string;
  contentType?: string;
  url?: string;
}

interface TwitterMediaLike {
  type?: string;
  video_info?: {
    variants?: TwitterVariantLike[];
  };
  legacy?: {
    binding_values?: Array<{ value?: { string_value?: string } }>;
    extended_entities?: {
      media?: TwitterMediaLike[];
    };
    retweeted_status_result?: {
      result?: unknown;
    };
  };
  binding_values?: {
    unified_card?: {
      string_value?: string;
    };
  };
  card?: unknown;
  extended_entities?: {
    media?: TwitterMediaLike[];
  };
}

export function parseTwitterPostRef(postUrl: string): TwitterPostRef | null {
  try {
    const parsed = new URL(postUrl);
    if (!TWITTER_POST_HOST_PATTERN.test(parsed.hostname)) {
      return null;
    }

    const match = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)(?:\/video\/(\d+))?\/?$/i);
    if (!match) {
      return null;
    }

    const username = match[1];
    const tweetId = match[2];
    const videoIndex = normalizeVideoIndex(match[3]);
    const canonicalPath = videoIndex === null
      ? `/${username}/status/${tweetId}`
      : `/${username}/status/${tweetId}/video/${videoIndex}`;

    return {
      canonicalUrl: `https://x.com${canonicalPath}`,
      tweetId,
      videoIndex,
    };
  } catch {
    return null;
  }
}

export function buildSyndicationToken(tweetId: string) {
  return ((Number(tweetId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export function stripTagParamFromTwitterVideoUrl(maybeUrl: string) {
  try {
    const url = new URL(maybeUrl);
    url.searchParams.delete("tag");
    return url.toString();
  } catch {
    return maybeUrl;
  }
}

export function selectHighestBitrateTwitterMp4Variant(variants: unknown): TwitterVideoVariant | null {
  const mp4Variants = normalizeTwitterVariants(variants)
    .filter((variant) => variant.contentType === "video/mp4")
    .sort((left, right) => (right.bitrate || 0) - (left.bitrate || 0));

  return mp4Variants[0] || null;
}

export function extractTwitterVideoCandidatesFromMedia(
  media: unknown,
  options: { videoIndex?: number | null } = {}
): RecoveredVideoCandidate[] {
  const mediaItems = normalizeTwitterMediaItems(media);
  if (!mediaItems.length) {
    return [];
  }

  const selectedMedia = selectTwitterMediaItem(mediaItems, options.videoIndex ?? null);
  if (!selectedMedia) {
    return [];
  }

  const variants = normalizeTwitterVariants(selectedMedia.video_info?.variants);
  if (!variants.length) {
    return [];
  }

  const candidates: RecoveredVideoCandidate[] = [];
  const bestMp4Variant = selectHighestBitrateTwitterMp4Variant(variants);
  if (bestMp4Variant) {
    candidates.push({
      bitrate: bestMp4Variant.bitrate,
      kind: "direct-mp4",
      mimeType: bestMp4Variant.contentType,
      source: "tweet-json",
      url: stripTagParamFromTwitterVideoUrl(bestMp4Variant.url),
    });
  }

  const hlsVariant = variants.find((variant) => variant.contentType === "application/x-mpegURL");
  if (hlsVariant) {
    candidates.push({
      kind: "hls-playlist",
      mimeType: hlsVariant.contentType,
      source: "tweet-json",
      url: hlsVariant.url,
    });
  }

  return candidates;
}

export function isTwitterBrokenContainerTweetId(tweetId: string | null | undefined) {
  const timestampMs = getTwitterSnowflakeTimestamp(tweetId);
  return timestampMs !== null
    && timestampMs > TWITTER_BROKEN_CONTAINER_START_MS
    && timestampMs < TWITTER_BROKEN_CONTAINER_END_MS;
}

export async function resolveTwitterVideoCandidates(
  postUrl: string,
  fetchImpl: FetchLike = fetch
): Promise<RecoveredVideoCandidate[]> {
  const postRef = parseTwitterPostRef(postUrl);
  if (!postRef) {
    throw new Error("Unsupported Twitter/X post URL");
  }

  let graphqlCandidates: RecoveredVideoCandidate[] = [];
  const isBrokenWindow = isTwitterBrokenContainerTweetId(postRef.tweetId);

  try {
    const guestToken = await requestTwitterGuestToken(fetchImpl);
    const graphqlMedia = await requestTwitterTweetDetailMedia(postRef.tweetId, guestToken, fetchImpl);
    graphqlCandidates = extractTwitterVideoCandidatesFromMedia(graphqlMedia, {
      videoIndex: postRef.videoIndex,
    });
    if (graphqlCandidates.length > 0) {
      const graphqlHasPlaylist = graphqlCandidates.some((candidate) => candidate.kind === "hls-playlist");
      if (!isBrokenWindow || graphqlHasPlaylist) {
        return applyTwitterBrokenContainerPolicy(graphqlCandidates, postRef.tweetId);
      }
    }
  } catch {
    // Fall back to syndication when guest activation or TweetDetail fetch fails.
  }

  const syndicationMedia = await requestTwitterSyndicationMedia(postRef.tweetId, fetchImpl);
  const syndicationCandidates = extractTwitterVideoCandidatesFromMedia(syndicationMedia, {
    videoIndex: postRef.videoIndex,
  });
  const mergedCandidates = mergeRecoveredVideoCandidates(graphqlCandidates, syndicationCandidates);

  if (mergedCandidates.length > 0) {
    return applyTwitterBrokenContainerPolicy(mergedCandidates, postRef.tweetId);
  }

  return applyTwitterBrokenContainerPolicy(graphqlCandidates, postRef.tweetId);
}

async function requestTwitterGuestToken(fetchImpl: FetchLike) {
  const response = await fetchImpl(TWITTER_GUEST_ACTIVATE_URL, {
    method: "POST",
    headers: buildTwitterCommonHeaders(),
  });
  const body = await parseJsonResponse<{ guest_token?: string }>(response);
  const guestToken = String(body?.guest_token || "").trim();

  if (!guestToken) {
    throw new Error(`Failed to activate Twitter/X guest token: ${response.status}`);
  }

  return guestToken;
}

async function requestTwitterTweetDetailMedia(tweetId: string, guestToken: string, fetchImpl: FetchLike) {
  const response = await fetchImpl(buildTweetDetailUrl(tweetId), {
    headers: {
      ...buildTwitterCommonHeaders(),
      "content-type": "application/json",
      "x-guest-token": guestToken,
    },
  });

  const body = await parseJsonResponse(response);
  if (!body) {
    return [];
  }

  return extractMediaFromTweetDetailPayload(body, tweetId);
}

async function requestTwitterSyndicationMedia(tweetId: string, fetchImpl: FetchLike) {
  const response = await fetchImpl(buildSyndicationUrl(tweetId));
  const body = await parseJsonResponse<any>(response);
  if (!body) {
    return [];
  }

  return normalizeTwitterMediaItems(body.mediaDetails || extractMediaFromCard(body.card));
}

function buildTwitterCommonHeaders() {
  return {
    authorization: TWITTER_BEARER_TOKEN,
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "en",
  };
}

function buildTweetDetailUrl(tweetId: string) {
  const url = new URL(TWITTER_TWEET_DETAIL_URL);
  url.searchParams.set(
    "variables",
    JSON.stringify({
      focalTweetId: tweetId,
      ...TWEET_DETAIL_VARIABLES_BASE,
    })
  );
  url.searchParams.set("features", JSON.stringify(TWEET_DETAIL_FEATURES));
  url.searchParams.set("fieldToggles", JSON.stringify(TWEET_DETAIL_FIELD_TOGGLES));
  return url.toString();
}

function buildSyndicationUrl(tweetId: string) {
  const url = new URL(TWITTER_SYNDICATION_URL);
  url.searchParams.set("id", tweetId);
  url.searchParams.set("token", buildSyndicationToken(tweetId));
  return url.toString();
}

async function parseJsonResponse<T = any>(response: Response): Promise<T | null> {
  if (!response.ok) {
    return null;
  }

  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function normalizeVideoIndex(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getTwitterSnowflakeTimestamp(tweetId: string | null | undefined) {
  const normalizedTweetId = String(tweetId || "").trim();
  if (!/^\d+$/.test(normalizedTweetId)) {
    return null;
  }

  try {
    return Number((BigInt(normalizedTweetId) >> TWITTER_SNOWFLAKE_TIMESTAMP_SHIFT) + TWITTER_EPOCH);
  } catch {
    return null;
  }
}

function applyTwitterBrokenContainerPolicy(
  candidates: RecoveredVideoCandidate[],
  representativeTweetId: string | null | undefined
) {
  if (!isTwitterBrokenContainerTweetId(representativeTweetId)) {
    return candidates;
  }

  const playlistCandidates = candidates.filter((candidate) => candidate.kind === "hls-playlist");
  if (playlistCandidates.length > 0) {
    return [
      ...playlistCandidates,
      ...candidates.filter((candidate) => candidate.kind !== "hls-playlist"),
    ];
  }

  if (candidates.some((candidate) => candidate.kind === "direct-mp4")) {
    throw new Error(TWITTER_BROKEN_CONTAINER_POLICY_ERROR);
  }

  return candidates;
}

function normalizeTwitterMediaItems(media: unknown): TwitterMediaLike[] {
  if (Array.isArray(media)) {
    return media.filter(isTwitterMediaLike);
  }

  return isTwitterMediaLike(media) ? [media] : [];
}

function isTwitterMediaLike(value: unknown): value is TwitterMediaLike {
  return Boolean(value) && typeof value === "object";
}

function normalizeTwitterVariants(variants: unknown): TwitterVideoVariant[] {
  if (!Array.isArray(variants)) {
    return [];
  }

  const normalizedVariants: TwitterVideoVariant[] = [];

  for (const variant of variants) {
    if (!variant || typeof variant !== "object") {
      continue;
    }

    const typedVariant = variant as TwitterVariantLike;
    const contentType = String(typedVariant.content_type || typedVariant.contentType || "").trim();
    const url = String(typedVariant.url || "").trim();
    if (!contentType || !url) {
      continue;
    }

    normalizedVariants.push({
      bitrate: Number.isFinite(typedVariant.bitrate) ? Number(typedVariant.bitrate) : undefined,
      contentType,
      url,
    });
  }

  return normalizedVariants;
}

function selectTwitterMediaItem(mediaItems: TwitterMediaLike[], videoIndex: number | null) {
  if (videoIndex !== null) {
    const indexedMedia = mediaItems[videoIndex - 1];
    return isTwitterVideoMedia(indexedMedia) ? indexedMedia : null;
  }

  return mediaItems.find(isTwitterVideoMedia) || null;
}

function isTwitterVideoMedia(media: TwitterMediaLike | undefined | null): media is TwitterMediaLike {
  if (!media) {
    return false;
  }

  return media.type === "video" || media.type === "animated_gif";
}

function extractMediaFromTweetDetailPayload(payload: unknown, tweetId: string) {
  const tweetResult = findTweetDetailResult(payload, tweetId);
  const normalizedTweet = unwrapTweetDetailResult(tweetResult);
  if (!normalizedTweet) {
    return [] as TwitterMediaLike[];
  }

  const cardMedia = extractMediaFromCard(normalizedTweet.card);
  if (cardMedia.length > 0) {
    return cardMedia;
  }

  const legacy = normalizedTweet.legacy;
  const retweetedLegacy = unwrapTweetDetailResult(legacy?.retweeted_status_result?.result)?.legacy;
  return normalizeTwitterMediaItems(
    retweetedLegacy?.extended_entities?.media
      || legacy?.extended_entities?.media
      || normalizedTweet.extended_entities?.media
  );
}

function findTweetDetailResult(payload: unknown, tweetId: string) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const queue: unknown[] = [payload];
  const seen = new Set<object>();
  let fallback: unknown = null;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }

    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    const record = current as Record<string, unknown>;
    if (record.entryId === `tweet-${tweetId}`) {
      const tweetResult = (record.content as any)?.itemContent?.tweet_results?.result;
      if (tweetResult) {
        return tweetResult;
      }
    }

    if (
      fallback === null
      && (record.rest_id === tweetId
        || record.id_str === tweetId
        || (record.legacy as any)?.id_str === tweetId)
    ) {
      fallback = current;
    }

    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        queue.push(...value);
      } else if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return fallback;
}

function unwrapTweetDetailResult(result: unknown): any {
  if (!result || typeof result !== "object") {
    return null;
  }

  const record = result as any;
  if (record.__typename === "TweetWithVisibilityResults") {
    return unwrapTweetDetailResult(record.tweet);
  }

  if (record.tweet?.legacy) {
    return record.tweet;
  }

  return record;
}

function extractMediaFromCard(cardOuter: unknown) {
  try {
    const bindingValue = (cardOuter as any)?.legacy?.binding_values?.[0]?.value?.string_value
      || (cardOuter as any)?.binding_values?.unified_card?.string_value;
    if (!bindingValue) {
      return [] as TwitterMediaLike[];
    }

    const card = JSON.parse(bindingValue);
    const mediaId = card?.component_objects?.media_1?.data?.id;
    const mediaEntity = mediaId ? card?.media_entities?.[mediaId] : null;
    return normalizeTwitterMediaItems(mediaEntity);
  } catch {
    return [] as TwitterMediaLike[];
  }
}

