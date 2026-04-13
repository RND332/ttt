// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const originalChrome = globalThis.chrome;
const originalBrowser = (globalThis as any).browser;
const originalPostMessage = window.postMessage;

describe("page twitter video resolver", () => {
  beforeEach(() => {
    (globalThis as any).chrome = undefined;
    (globalThis as any).browser = undefined;
  });

  afterEach(() => {
    (globalThis as any).chrome = originalChrome;
    (globalThis as any).browser = originalBrowser;
    window.postMessage = originalPostMessage;
    vi.restoreAllMocks();
  });

  test("resolveTwitterVideoCandidatesFromPage extracts authenticated amplify_video candidates from a page tweet result", async () => {
    const { resolveTwitterVideoCandidatesFromPage, TTT_PAGE_TWITTER_VIDEO_REQUEST, TTT_PAGE_TWITTER_VIDEO_RESPONSE } =
      await import("./page-twitter-video-resolver");

    const sendMessage = vi.fn(async (message: any) => {
      if (message.type === "ENSURE_PAGE_TWITTER_VIDEO_RESOLVER") {
        return { ok: true, result: undefined };
      }

      throw new Error(`unexpected message ${message.type}`);
    });

    (globalThis as any).chrome = {
      runtime: { sendMessage }
    };

    const postMessageMock = vi.fn((message: unknown) => {
      const data = message as { type?: string; requestId?: string; tweetId?: string };
      if (data.type !== TTT_PAGE_TWITTER_VIDEO_REQUEST) {
        return;
      }

      window.dispatchEvent(new MessageEvent("message", {
        source: window,
        data: {
          type: TTT_PAGE_TWITTER_VIDEO_RESPONSE,
          requestId: data.requestId,
          ok: true,
          payload: {
            data: {
              tweetResult: {
                result: {
                  rest_id: "2013426523601019141",
                  legacy: {
                    extended_entities: {
                      media: [
                        {
                          type: "video",
                          video_info: {
                            variants: [
                              {
                                content_type: "application/x-mpegURL",
                                url: "https://video.twimg.com/amplify_video/2013425991624876032/pl/master.m3u8?tag=21"
                              },
                              {
                                bitrate: 832000,
                                content_type: "video/mp4",
                                url: "https://video.twimg.com/amplify_video/2013425991624876032/vid/avc1/1188x992/sN6YkOgo-EF3XUHD.mp4?tag=21"
                              }
                            ]
                          }
                        }
                      ]
                    }
                  }
                }
              }
            }
          }
        }
      }));
    });

    window.postMessage = postMessageMock as typeof window.postMessage;

    await expect(
      resolveTwitterVideoCandidatesFromPage("https://x.com/torinyannyan1/status/2013426523601019141")
    ).resolves.toEqual([
      {
        bitrate: 832000,
        kind: "direct-mp4",
        mimeType: "video/mp4",
        source: "tweet-json",
        url: "https://video.twimg.com/amplify_video/2013425991624876032/vid/avc1/1188x992/sN6YkOgo-EF3XUHD.mp4"
      },
      {
        kind: "hls-playlist",
        mimeType: "application/x-mpegURL",
        source: "tweet-json",
        url: "https://video.twimg.com/amplify_video/2013425991624876032/pl/master.m3u8?tag=21"
      }
    ]);

    expect(sendMessage).toHaveBeenCalledWith({ type: "ENSURE_PAGE_TWITTER_VIDEO_RESOLVER" });
    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TTT_PAGE_TWITTER_VIDEO_REQUEST,
      tweetId: "2013426523601019141"
    }), "*");
  });

  test("resolveTwitterVideoCandidatesFromPage returns no candidates when the authenticated page response is still a tombstone", async () => {
    const { resolveTwitterVideoCandidatesFromPage, TTT_PAGE_TWITTER_VIDEO_REQUEST, TTT_PAGE_TWITTER_VIDEO_RESPONSE } =
      await import("./page-twitter-video-resolver");

    (globalThis as any).chrome = {
      runtime: {
        sendMessage: vi.fn(async () => ({ ok: true, result: undefined }))
      }
    };

    window.postMessage = vi.fn((message: unknown) => {
      const data = message as { type?: string; requestId?: string };
      if (data.type !== TTT_PAGE_TWITTER_VIDEO_REQUEST) {
        return;
      }

      window.dispatchEvent(new MessageEvent("message", {
        source: window,
        data: {
          type: TTT_PAGE_TWITTER_VIDEO_RESPONSE,
          requestId: data.requestId,
          ok: true,
          payload: {
            data: {
              tweetResult: {
                result: {
                  __typename: "TweetTombstone",
                  tombstone: {
                    __typename: "BlurredMediaTombstone"
                  }
                }
              }
            }
          }
        }
      }));
    }) as typeof window.postMessage;

    await expect(
      resolveTwitterVideoCandidatesFromPage("https://x.com/torinyannyan1/status/2013426523601019141")
    ).resolves.toEqual([]);
  });
});
