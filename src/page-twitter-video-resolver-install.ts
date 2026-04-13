import { TTT_PAGE_TWITTER_VIDEO_REQUEST, TTT_PAGE_TWITTER_VIDEO_RESPONSE } from "./page-twitter-video-resolver";

type ChromeScriptingApi = {
  executeScript: (injection: {
    target: {
      tabId: number;
      frameIds?: number[];
      documentIds?: string[];
    };
    world: "MAIN";
    func: (requestType: string, responseType: string, bearerToken: string, queryId: string, operationName: string) => void;
    args: [string, string, string, string, string];
  }) => Promise<unknown> | unknown;
};

type ChromeWithScripting = {
  scripting?: ChromeScriptingApi;
};

type ResolverTarget = {
  tabId: number;
  frameIds?: number[];
  documentIds?: string[];
};

const TWITTER_BEARER_TOKEN = "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const TWEET_RESULT_BY_REST_ID_QUERY_ID = "tmhPpO5sDermwYmq3h034A";
const TWEET_RESULT_BY_REST_ID_OPERATION = "TweetResultByRestId";

export {
  TTT_PAGE_TWITTER_VIDEO_REQUEST,
  TTT_PAGE_TWITTER_VIDEO_RESPONSE,
};

export async function ensurePageTwitterVideoResolverInstalled(chromeApi: ChromeWithScripting, target: ResolverTarget) {
  if (!chromeApi.scripting?.executeScript) {
    throw new Error("chrome.scripting.executeScript is unavailable.");
  }

  return await chromeApi.scripting.executeScript({
    target,
    world: "MAIN",
    func: (requestType, responseType, bearerToken, queryId, operationName) => {
      const targetWindow = window as Window & { __tttPageTwitterVideoResolverInstalled?: boolean };
      if (targetWindow.__tttPageTwitterVideoResolverInstalled) return;
      targetWindow.__tttPageTwitterVideoResolverInstalled = true;

      const getCookieValue = (name: string) => {
        const entries = String(document.cookie || "").split(";");
        for (const entry of entries) {
          const [rawKey, ...rest] = entry.split("=");
          if (rawKey?.trim() === name) {
            return rest.join("=").trim();
          }
        }
        return "";
      };

      const buildRequestUrl = (tweetId: string) => {
        const url = new URL(`${location.origin}/i/api/graphql/${queryId}/${operationName}`);
        url.searchParams.set("variables", JSON.stringify({
          tweetId,
          includePromotedContent: true,
          withCommunity: true,
          withVoice: true,
        }));
        url.searchParams.set("features", JSON.stringify({
          creator_subscriptions_tweet_preview_api_enabled: true,
          premium_content_api_read_enabled: false,
          communities_web_enable_tweet_community_results_fetch: true,
          c9s_tweet_anatomy_moderator_badge_enabled: true,
          responsive_web_grok_analyze_button_fetch_trends_enabled: false,
          responsive_web_grok_analyze_post_followups_enabled: true,
          responsive_web_jetfuel_frame: true,
          responsive_web_grok_share_attachment_enabled: true,
          responsive_web_grok_annotations_enabled: true,
          articles_preview_enabled: true,
          responsive_web_edit_tweet_api_enabled: true,
          graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
          view_counts_everywhere_api_enabled: true,
          longform_notetweets_consumption_enabled: true,
          responsive_web_twitter_article_tweet_consumption_enabled: true,
          content_disclosure_indicator_enabled: true,
          content_disclosure_ai_generated_indicator_enabled: true,
          responsive_web_grok_show_grok_translated_post: false,
          responsive_web_grok_analysis_button_from_backend: true,
          post_ctas_fetch_enabled: true,
          freedom_of_speech_not_reach_fetch_enabled: true,
          standardized_nudges_misinfo: true,
          tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
          longform_notetweets_rich_text_read_enabled: true,
          longform_notetweets_inline_media_enabled: true,
          profile_label_improvements_pcf_label_in_post_enabled: true,
          responsive_web_profile_redirect_enabled: true,
          rweb_tipjar_consumption_enabled: true,
          verified_phone_label_enabled: false,
          responsive_web_grok_image_annotation_enabled: true,
          responsive_web_grok_imagine_annotation_enabled: true,
          responsive_web_grok_community_note_auto_translation_is_enabled: false,
          responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
          responsive_web_graphql_timeline_navigation_enabled: true,
          responsive_web_enhance_cards_enabled: false,
        }));
        url.searchParams.set("fieldToggles", JSON.stringify({
          withArticleRichContentState: true,
          withArticlePlainText: false,
          withArticleSummaryText: false,
          withArticleVoiceOver: false,
          withGrokAnalyze: false,
          withDisallowedReplyControls: false,
          withPayments: false,
          withAuxiliaryUserLabels: false,
        }));
        return url.toString();
      };

      targetWindow.addEventListener("message", async (event: Event) => {
        const message = event as MessageEvent<{ type?: string; requestId?: string; tweetId?: string }>;
        if (message.source !== targetWindow) return;
        if (message.data?.type !== requestType) return;

        try {
          const csrfToken = getCookieValue("ct0");
          const authToken = getCookieValue("auth_token");
          const response = await fetch(buildRequestUrl(String(message.data.tweetId || "")), {
            credentials: "include",
            headers: {
              authorization: bearerToken,
              "content-type": "application/json",
              "x-csrf-token": csrfToken,
              "x-twitter-auth-type": authToken ? "OAuth2Session" : "",
              "x-twitter-active-user": "yes",
              "x-twitter-client-language": document.documentElement.lang || "en",
            },
          });

          const payload = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(
              payload?.errors?.[0]?.message
                || payload?.error
                || `Failed to resolve authenticated Twitter/X video metadata from the page: ${response.status}`
            );
          }

          targetWindow.postMessage({
            type: responseType,
            requestId: message.data.requestId,
            ok: true,
            payload,
          }, "*");
        } catch (error: unknown) {
          targetWindow.postMessage({
            type: responseType,
            requestId: message.data.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }, "*");
        }
      });
    },
    args: [
      TTT_PAGE_TWITTER_VIDEO_REQUEST,
      TTT_PAGE_TWITTER_VIDEO_RESPONSE,
      TWITTER_BEARER_TOKEN,
      TWEET_RESULT_BY_REST_ID_QUERY_ID,
      TWEET_RESULT_BY_REST_ID_OPERATION,
    ],
  });
}
