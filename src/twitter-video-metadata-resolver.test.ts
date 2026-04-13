import { describe, expect, test, vi } from "vitest";
import {
  buildSyndicationToken,
  extractTwitterVideoCandidatesFromMedia,
  parseTwitterPostRef,
  resolveTwitterVideoCandidates,
  selectHighestBitrateTwitterMp4Variant,
  stripTagParamFromTwitterVideoUrl,
  TWITTER_BROKEN_CONTAINER_POLICY_ERROR,
} from "./twitter-video-metadata-resolver";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
    ...init,
  });
}

describe("parseTwitterPostRef", () => {
  test("extracts a tweet ID from an x.com status URL", () => {
    expect(parseTwitterPostRef("https://x.com/user/status/123")).toEqual({
      canonicalUrl: "https://x.com/user/status/123",
      tweetId: "123",
      videoIndex: null,
    });
  });

  test("extracts a tweet ID and video index from a twitter.com media route", () => {
    expect(parseTwitterPostRef("https://twitter.com/user/status/123/video/1")).toEqual({
      canonicalUrl: "https://x.com/user/status/123/video/1",
      tweetId: "123",
      videoIndex: 1,
    });
  });
});

describe("variant helpers", () => {
  test("chooses the highest bitrate mp4 variant", () => {
    expect(
      selectHighestBitrateTwitterMp4Variant([
        {
          content_type: "application/x-mpegURL",
          url: "https://video.twimg.com/ext_tw_video/123/master.m3u8?tag=14",
        },
        {
          bitrate: 320000,
          content_type: "video/mp4",
          url: "https://video.twimg.com/ext_tw_video/123/low.mp4?tag=14",
        },
        {
          bitrate: 832000,
          content_type: "video/mp4",
          url: "https://video.twimg.com/ext_tw_video/123/high.mp4?tag=14",
        },
      ])
    ).toEqual({
      bitrate: 832000,
      contentType: "video/mp4",
      url: "https://video.twimg.com/ext_tw_video/123/high.mp4?tag=14",
    });
  });

  test("strips the tag param from a chosen video URL", () => {
    expect(
      stripTagParamFromTwitterVideoUrl(
        "https://video.twimg.com/ext_tw_video/123/high.mp4?tag=14&foo=bar"
      )
    ).toBe("https://video.twimg.com/ext_tw_video/123/high.mp4?foo=bar");
  });
});

describe("extractTwitterVideoCandidatesFromMedia", () => {
  test("ignores non-video media", () => {
    expect(
      extractTwitterVideoCandidatesFromMedia([
        {
          type: "photo",
          media_url_https: "https://pbs.twimg.com/media/photo.jpg",
        },
        {
          type: "video",
          video_info: {
            variants: [
              {
                bitrate: 2176000,
                content_type: "video/mp4",
                url: "https://video.twimg.com/ext_tw_video/999/high.mp4?tag=9",
              },
            ],
          },
        },
      ])
    ).toEqual([
      {
        bitrate: 2176000,
        kind: "direct-mp4",
        mimeType: "video/mp4",
        source: "tweet-json",
        url: "https://video.twimg.com/ext_tw_video/999/high.mp4",
      },
    ]);
  });

  test("returns tweet-json candidates in direct-first order", () => {
    expect(
      extractTwitterVideoCandidatesFromMedia({
        type: "video",
        video_info: {
          variants: [
            {
              content_type: "application/x-mpegURL",
              url: "https://video.twimg.com/ext_tw_video/123/master.m3u8?tag=14",
            },
            {
              bitrate: 256000,
              content_type: "video/mp4",
              url: "https://video.twimg.com/ext_tw_video/123/low.mp4?tag=14",
            },
            {
              bitrate: 1024000,
              content_type: "video/mp4",
              url: "https://video.twimg.com/ext_tw_video/123/high.mp4?tag=14",
            },
          ],
        },
      })
    ).toEqual([
      {
        bitrate: 1024000,
        kind: "direct-mp4",
        mimeType: "video/mp4",
        source: "tweet-json",
        url: "https://video.twimg.com/ext_tw_video/123/high.mp4",
      },
      {
        kind: "hls-playlist",
        mimeType: "application/x-mpegURL",
        source: "tweet-json",
        url: "https://video.twimg.com/ext_tw_video/123/master.m3u8?tag=14",
      },
    ]);
  });
});

describe("resolveTwitterVideoCandidates", () => {
  test("prefers the playlist in the broken-container window when tweet-json exposes both playlist and direct mp4", async () => {
    const tweetId = "1732939718456246272";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url === "https://api.x.com/1.1/guest/activate.json") {
        return jsonResponse({ guest_token: "guest-token-broken-window-1" });
      }

      if (url.startsWith("https://api.x.com/graphql/4Siu98E55GquhG52zHdY5w/TweetDetail")) {
        return jsonResponse({
          data: {
            threaded_conversation_with_injections_v2: {
              instructions: [
                {
                  type: "TimelineAddEntries",
                  entries: [
                    {
                      entryId: `tweet-${tweetId}`,
                      content: {
                        itemContent: {
                          tweet_results: {
                            result: {
                              rest_id: tweetId,
                              legacy: {
                                extended_entities: {
                                  media: [
                                    {
                                      type: "video",
                                      video_info: {
                                        variants: [
                                          {
                                            bitrate: 832000,
                                            content_type: "video/mp4",
                                            url: "https://video.twimg.com/ext_tw_video/173020/pu/vid/avc1/direct.mp4?tag=14",
                                          },
                                          {
                                            content_type: "application/x-mpegURL",
                                            url: "https://video.twimg.com/ext_tw_video/173020/pl/master.m3u8?tag=14",
                                          },
                                        ],
                                      },
                                    },
                                  ],
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    await expect(resolveTwitterVideoCandidates(`https://x.com/user/status/${tweetId}`, fetchMock)).resolves.toEqual([
      {
        kind: "hls-playlist",
        mimeType: "application/x-mpegURL",
        source: "tweet-json",
        url: "https://video.twimg.com/ext_tw_video/173020/pl/master.m3u8?tag=14",
      },
      {
        bitrate: 832000,
        kind: "direct-mp4",
        mimeType: "video/mp4",
        source: "tweet-json",
        url: "https://video.twimg.com/ext_tw_video/173020/pu/vid/avc1/direct.mp4",
      },
    ]);
  });

  test("uses syndication playlist rescue in the broken-container window when TweetDetail is direct-only", async () => {
    const tweetId = "1732939718456246273";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url === "https://api.x.com/1.1/guest/activate.json") {
        return jsonResponse({ guest_token: "guest-token-broken-window-2" });
      }

      if (url.startsWith("https://api.x.com/graphql/4Siu98E55GquhG52zHdY5w/TweetDetail")) {
        return jsonResponse({
          data: {
            threaded_conversation_with_injections_v2: {
              instructions: [
                {
                  type: "TimelineAddEntries",
                  entries: [
                    {
                      entryId: `tweet-${tweetId}`,
                      content: {
                        itemContent: {
                          tweet_results: {
                            result: {
                              rest_id: tweetId,
                              legacy: {
                                extended_entities: {
                                  media: [
                                    {
                                      type: "video",
                                      video_info: {
                                        variants: [
                                          {
                                            bitrate: 832000,
                                            content_type: "video/mp4",
                                            url: "https://video.twimg.com/ext_tw_video/173020/pu/vid/avc1/direct-only.mp4?tag=14",
                                          },
                                        ],
                                      },
                                    },
                                  ],
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        });
      }

      if (url.startsWith("https://cdn.syndication.twimg.com/tweet-result")) {
        return jsonResponse({
          mediaDetails: [
            {
              type: "video",
              video_info: {
                variants: [
                  {
                    content_type: "application/x-mpegURL",
                    url: "https://video.twimg.com/ext_tw_video/173020/pl/master.m3u8?tag=14",
                  },
                  {
                    bitrate: 256000,
                    content_type: "video/mp4",
                    url: "https://video.twimg.com/ext_tw_video/173020/low.mp4?tag=14",
                  },
                ],
              },
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    await expect(resolveTwitterVideoCandidates(`https://x.com/user/status/${tweetId}`, fetchMock)).resolves.toEqual([
      {
        kind: "hls-playlist",
        mimeType: "application/x-mpegURL",
        source: "tweet-json",
        url: "https://video.twimg.com/ext_tw_video/173020/pl/master.m3u8?tag=14",
      },
      {
        bitrate: 832000,
        kind: "direct-mp4",
        mimeType: "video/mp4",
        source: "tweet-json",
        url: "https://video.twimg.com/ext_tw_video/173020/pu/vid/avc1/direct-only.mp4",
      },
      {
        bitrate: 256000,
        kind: "direct-mp4",
        mimeType: "video/mp4",
        source: "tweet-json",
        url: "https://video.twimg.com/ext_tw_video/173020/low.mp4",
      },
    ]);
  });

  test("throws an explicit broken-container error in the bad window when no playlist rescue exists from any resolver source", async () => {
    const tweetId = "1732939718456246274";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url === "https://api.x.com/1.1/guest/activate.json") {
        return jsonResponse({ guest_token: "guest-token-broken-window-3" });
      }

      if (url.startsWith("https://api.x.com/graphql/4Siu98E55GquhG52zHdY5w/TweetDetail")) {
        return jsonResponse({
          data: {
            threaded_conversation_with_injections_v2: {
              instructions: [
                {
                  type: "TimelineAddEntries",
                  entries: [
                    {
                      entryId: `tweet-${tweetId}`,
                      content: {
                        itemContent: {
                          tweet_results: {
                            result: {
                              rest_id: tweetId,
                              legacy: {
                                extended_entities: {
                                  media: [
                                    {
                                      type: "video",
                                      video_info: {
                                        variants: [
                                          {
                                            bitrate: 832000,
                                            content_type: "video/mp4",
                                            url: "https://video.twimg.com/ext_tw_video/173020/pu/vid/avc1/direct-only.mp4?tag=14",
                                          },
                                        ],
                                      },
                                    },
                                  ],
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        });
      }

      if (url.startsWith("https://cdn.syndication.twimg.com/tweet-result")) {
        return jsonResponse({
          mediaDetails: [
            {
              type: "video",
              video_info: {
                variants: [
                  {
                    bitrate: 256000,
                    content_type: "video/mp4",
                    url: "https://video.twimg.com/ext_tw_video/173020/low.mp4?tag=14",
                  },
                ],
              },
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    await expect(resolveTwitterVideoCandidates(`https://x.com/user/status/${tweetId}`, fetchMock)).rejects.toThrow(
      TWITTER_BROKEN_CONTAINER_POLICY_ERROR
    );
  });

  test("falls back to the syndication result when guest token activation fails", async () => {
    const tweetId = "135792468";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url === "https://api.x.com/1.1/guest/activate.json") {
        return new Response("guest activation failed", { status: 500 });
      }

      if (url.startsWith("https://cdn.syndication.twimg.com/tweet-result")) {
        const parsed = new URL(url);
        expect(parsed.searchParams.get("id")).toBe(tweetId);
        expect(parsed.searchParams.get("token")).toBe(buildSyndicationToken(tweetId));

        return jsonResponse({
          mediaDetails: [
            {
              type: "video",
              video_info: {
                variants: [
                  {
                    content_type: "application/x-mpegURL",
                    url: "https://video.twimg.com/ext_tw_video/135/master.m3u8?tag=14",
                  },
                  {
                    bitrate: 256000,
                    content_type: "video/mp4",
                    url: "https://video.twimg.com/ext_tw_video/135/low.mp4?tag=14",
                  },
                  {
                    bitrate: 1024000,
                    content_type: "video/mp4",
                    url: "https://video.twimg.com/ext_tw_video/135/high.mp4?tag=14",
                  },
                ],
              },
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    await expect(resolveTwitterVideoCandidates(`https://x.com/user/status/${tweetId}`, fetchMock)).resolves.toEqual([
      {
        bitrate: 1024000,
        kind: "direct-mp4",
        mimeType: "video/mp4",
        source: "tweet-json",
        url: "https://video.twimg.com/ext_tw_video/135/high.mp4",
      },
      {
        kind: "hls-playlist",
        mimeType: "application/x-mpegURL",
        source: "tweet-json",
        url: "https://video.twimg.com/ext_tw_video/135/master.m3u8?tag=14",
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("falls back to the syndication result when GraphQL fails", async () => {
    const tweetId = "987654321";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url === "https://api.x.com/1.1/guest/activate.json") {
        return jsonResponse({ guest_token: "guest-token-1" });
      }

      if (url.startsWith("https://api.x.com/graphql/4Siu98E55GquhG52zHdY5w/TweetDetail")) {
        return new Response("graphql failed", { status: 500 });
      }

      if (url.startsWith("https://cdn.syndication.twimg.com/tweet-result")) {
        const parsed = new URL(url);
        expect(parsed.searchParams.get("id")).toBe(tweetId);
        expect(parsed.searchParams.get("token")).toBe(buildSyndicationToken(tweetId));

        return jsonResponse({
          mediaDetails: [
            {
              type: "photo",
              media_url_https: "https://pbs.twimg.com/media/photo.jpg",
            },
            {
              type: "video",
              video_info: {
                variants: [
                  {
                    content_type: "application/x-mpegURL",
                    url: "https://video.twimg.com/ext_tw_video/987/master.m3u8?tag=14",
                  },
                  {
                    bitrate: 320000,
                    content_type: "video/mp4",
                    url: "https://video.twimg.com/ext_tw_video/987/low.mp4?tag=14",
                  },
                  {
                    bitrate: 832000,
                    content_type: "video/mp4",
                    url: "https://video.twimg.com/ext_tw_video/987/high.mp4?tag=14",
                  },
                ],
              },
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    await expect(resolveTwitterVideoCandidates(`https://x.com/user/status/${tweetId}`, fetchMock)).resolves.toEqual([
      {
        bitrate: 832000,
        kind: "direct-mp4",
        mimeType: "video/mp4",
        source: "tweet-json",
        url: "https://video.twimg.com/ext_tw_video/987/high.mp4",
      },
      {
        kind: "hls-playlist",
        mimeType: "application/x-mpegURL",
        source: "tweet-json",
        url: "https://video.twimg.com/ext_tw_video/987/master.m3u8?tag=14",
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("falls back to the syndication result when TweetDetail fetch rejects", async () => {
    const tweetId = "246813579";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url === "https://api.x.com/1.1/guest/activate.json") {
        return jsonResponse({ guest_token: "guest-token-2" });
      }

      if (url.startsWith("https://api.x.com/graphql/4Siu98E55GquhG52zHdY5w/TweetDetail")) {
        throw new Error("TweetDetail request failed");
      }

      if (url.startsWith("https://cdn.syndication.twimg.com/tweet-result")) {
        const parsed = new URL(url);
        expect(parsed.searchParams.get("id")).toBe(tweetId);
        expect(parsed.searchParams.get("token")).toBe(buildSyndicationToken(tweetId));

        return jsonResponse({
          mediaDetails: [
            {
              type: "video",
              video_info: {
                variants: [
                  {
                    content_type: "application/x-mpegURL",
                    url: "https://video.twimg.com/ext_tw_video/246/master.m3u8?tag=14",
                  },
                  {
                    bitrate: 320000,
                    content_type: "video/mp4",
                    url: "https://video.twimg.com/ext_tw_video/246/low.mp4?tag=14",
                  },
                  {
                    bitrate: 832000,
                    content_type: "video/mp4",
                    url: "https://video.twimg.com/ext_tw_video/246/high.mp4?tag=14",
                  },
                ],
              },
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    await expect(resolveTwitterVideoCandidates(`https://x.com/user/status/${tweetId}`, fetchMock)).resolves.toEqual([
      {
        bitrate: 832000,
        kind: "direct-mp4",
        mimeType: "video/mp4",
        source: "tweet-json",
        url: "https://video.twimg.com/ext_tw_video/246/high.mp4",
      },
      {
        kind: "hls-playlist",
        mimeType: "application/x-mpegURL",
        source: "tweet-json",
        url: "https://video.twimg.com/ext_tw_video/246/master.m3u8?tag=14",
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
