import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BROWSER_VIDEO_INVALID_FILE_ERROR } from "./browser-video-download";
import { UNSUPPORTED_SEGMENTED_HLS_ERROR } from "./hls-video-download";
import type { TelegramSendPayload } from "./shared";
import { DEFAULT_SETTINGS } from "./shared";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...init?.headers
    },
    ...init
  });
}

const originalChrome = globalThis.chrome;
const originalFetch = globalThis.fetch;
const VALID_MP4_SIZE = 24;

function createValidMp4Bytes() {
  return new Uint8Array([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d,
    0x69, 0x73, 0x6f, 0x32
  ]);
}

function isTwitterMetadataRequest(input: unknown) {
  const url = String(input);
  return url === "https://api.x.com/1.1/guest/activate.json"
    || url.startsWith("https://api.x.com/graphql/4Siu98E55GquhG52zHdY5w/TweetDetail")
    || url.startsWith("https://cdn.syndication.twimg.com/tweet-result");
}

function isTelegramRequest(input: unknown) {
  return String(input).startsWith("https://api.telegram.org/");
}

function getVideoDownloadFetchCalls(fetchMock: { mock: { calls: unknown[][] } }) {
  return fetchMock.mock.calls.filter(
    (call) => !isTwitterMetadataRequest(call[0]) && !isTelegramRequest(call[0])
  );
}

beforeEach(() => {
  vi.resetModules();
  (globalThis as any).__tttBackgroundListener = undefined;
  (globalThis as any).chrome = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn((listener: unknown) => { (globalThis as any).__tttBackgroundListener = listener; }) },
      openOptionsPage: vi.fn()
    },
    action: {
      onClicked: { addListener: vi.fn() }
    },
    storage: {
      local: {
        get: vi.fn(async () => ({ ...DEFAULT_SETTINGS, botToken: "token", channelId: "channel" })),
        set: vi.fn(async () => undefined)
      }
    }
  };
});

afterEach(() => {
  (globalThis as any).chrome = originalChrome;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

test("background maps direct video fetch failures to a clearer browser-download error", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "https://video.twimg.com/ext_tw_video/901/pu/vid/avc1/main.mp4") {
      throw new TypeError("Failed to fetch");
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/user/status/901",
    videoUrl: "https://video.twimg.com/ext_tw_video/901/pu/vid/avc1/main.mp4"
  };

  const result = listener?.({ type: "SEND_TO_TELEGRAM", payload }, {}, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sendResponse).toHaveBeenCalledWith({
    ok: false,
    error: "Failed to download the video in the browser. X/Twitter may not have exposed a directly fetchable file for this post."
  });
});

test("background falls back to a recovered playlist candidate when a payload-only direct video URL fails to fetch", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://video.twimg.com/ext_tw_video/902/pu/vid/avc1/main.mp4") {
      throw new TypeError("Failed to fetch");
    }

    if (url === "https://video.twimg.com/ext_tw_video/902/pl/master.m3u8") {
      return new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
../360p/video.mp4
`,
        { status: 200 }
      );
    }

    if (url === "https://video.twimg.com/ext_tw_video/902/360p/video.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      expect((video as Blob).size).toBe(VALID_MP4_SIZE);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 902 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const recordResponse = vi.fn();
  const recordResult = listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/902",
    candidates: [
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/902/pl/master.m3u8",
        source: "page-fetch"
      }
    ]
  }, { tab: { id: 902 } }, recordResponse);

  expect(recordResult).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/user/status/902",
    videoUrl: "https://video.twimg.com/ext_tw_video/902/pu/vid/avc1/main.mp4"
  };

  const result = listener?.({ type: "SEND_TO_TELEGRAM", payload }, { tab: { id: 902 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([
    ["https://video.twimg.com/ext_tw_video/902/pu/vid/avc1/main.mp4", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/902/pl/master.m3u8", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/902/360p/video.mp4", { credentials: "omit" }]
  ]);
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 902 } });
});

test("background uploads a directly exposed browser video URL", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "https://video.twimg.com/ext_tw_video/777/pu/vid/avc1/main.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/user/status/777",
    videoUrl: "https://video.twimg.com/ext_tw_video/777/pu/vid/avc1/main.mp4"
  };

  const result = listener?.({ type: "SEND_TO_TELEGRAM", payload }, {}, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchMock).toHaveBeenCalledWith(
    "https://video.twimg.com/ext_tw_video/777/pu/vid/avc1/main.mp4",
    { credentials: "omit" }
  );
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 1 } });
});

test("background returns no recovered video candidates when no post-scoped candidates were stored", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "GET_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/778"
  }, { tab: { id: 778 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(sendResponse).toHaveBeenCalledWith({
    ok: true,
    result: {
      candidates: []
    }
  });
});

test("background uses a playable HLS candidate when the recovered direct candidate is really an .m4s artifact", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://video.twimg.com/ext_tw_video/889/playlist/master.m3u8") {
      return new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2176000,RESOLUTION=1280x720
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
../360p/video.mp4
`,
        { status: 200 }
      );
    }

    if (url === "https://video.twimg.com/ext_tw_video/889/360p/video.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      expect((video as Blob).size).toBe(VALID_MP4_SIZE);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 89 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const recordResponse = vi.fn();
  const recordResult = listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/889",
    candidates: [
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/889/pu/vid/avc1/chunk.m4s",
        source: "page-fetch",
        mimeType: "video/mp4"
      },
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/889/playlist/master.m3u8",
        source: "page-xhr"
      }
    ]
  }, { tab: { id: 89 } }, recordResponse);

  expect(recordResult).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/user/status/889"
  };

  const result = listener?.({ type: "SEND_TO_TELEGRAM", payload }, { tab: { id: 89 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([
    ["https://video.twimg.com/ext_tw_video/889/playlist/master.m3u8", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/889/360p/video.mp4", { credentials: "omit" }]
  ]);
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 89 } });
});

test("background merges later recovered playlist candidates with earlier stored direct candidates for the same post", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://video.twimg.com/ext_tw_video/777/pl/master.m3u8") {
      return new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
../360p/video.mp4
`,
        { status: 200 }
      );
    }

    if (url === "https://video.twimg.com/ext_tw_video/777/360p/video.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      expect((video as Blob).size).toBe(VALID_MP4_SIZE);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 777 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const firstRecordResponse = vi.fn();
  const firstRecordResult = listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/777",
    candidates: [
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/777/pu/vid/avc1/init.mp4",
        source: "page-fetch"
      }
    ]
  }, { tab: { id: 77 } }, firstRecordResponse);

  expect(firstRecordResult).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const secondRecordResponse = vi.fn();
  const secondRecordResult = listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/777",
    candidates: [
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/777/pl/master.m3u8",
        source: "page-xhr"
      }
    ]
  }, { tab: { id: 77 } }, secondRecordResponse);

  expect(secondRecordResult).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/777"
    }
  }, { tab: { id: 77 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([
    ["https://video.twimg.com/ext_tw_video/777/pl/master.m3u8", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/777/360p/video.mp4", { credentials: "omit" }]
  ]);
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 777 } });
});

test("background uses recovered direct video candidates when the original payload has no direct video URL", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "https://video.twimg.com/ext_tw_video/888/pu/vid/avc1/recovered.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      return new Response(JSON.stringify({ ok: true, result: { message_id: 8 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const recordResponse = vi.fn();
  const recordResult = listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/888",
    candidates: [
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/888/pu/vid/avc1/recovered.mp4",
        source: "page-fetch",
        mimeType: "video/mp4"
      }
    ]
  }, { tab: { id: 12 } }, recordResponse);

  expect(recordResult).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/user/status/888"
  };

  const result = listener?.({ type: "SEND_TO_TELEGRAM", payload }, { tab: { id: 12 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchMock).toHaveBeenCalledWith(
    "https://video.twimg.com/ext_tw_video/888/pu/vid/avc1/recovered.mp4",
    { credentials: "omit" }
  );
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 8 } });
});

test("background resolves playlistUrl to a direct mp4 variant before uploading the video", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://video.twimg.com/ext_tw_video/555/playlist/master.m3u8") {
      return new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2176000,RESOLUTION=1280x720
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
../360p/video.mp4
`,
        { status: 200 }
      );
    }

    if (url === "https://video.twimg.com/ext_tw_video/555/360p/video.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      expect((video as Blob).size).toBe(VALID_MP4_SIZE);

      return new Response(JSON.stringify({ ok: true, result: { message_id: 55 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/user/status/555",
    playlistUrl: "https://video.twimg.com/ext_tw_video/555/playlist/master.m3u8"
  };

  const result = listener?.({ type: "SEND_TO_TELEGRAM", payload }, {}, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([
    ["https://video.twimg.com/ext_tw_video/555/playlist/master.m3u8", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/555/360p/video.mp4", { credentials: "omit" }]
  ]);
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 55 } });
});

test("background returns the explicit HLS unsupported error when the only recovered candidate is a segmented playlist", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "https://video.twimg.com/ext_tw_video/557/playlist/master.m3u8") {
      return new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2176000,RESOLUTION=1280x720
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
360p/index.m3u8
`,
        { status: 200 }
      );
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const recordResponse = vi.fn();
  const recordResult = listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/557",
    candidates: [
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/557/pu/vid/avc1/init.mp4",
        source: "page-fetch"
      },
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/557/playlist/master.m3u8",
        source: "page-xhr"
      }
    ]
  }, { tab: { id: 57 } }, recordResponse);

  expect(recordResult).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/user/status/557"
  };

  const result = listener?.({ type: "SEND_TO_TELEGRAM", payload }, { tab: { id: 57 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([
    ["https://video.twimg.com/ext_tw_video/557/playlist/master.m3u8", { credentials: "omit" }]
  ]);
  expect(sendResponse).toHaveBeenCalledWith({
    ok: false,
    error: UNSUPPORTED_SEGMENTED_HLS_ERROR
  });
});

test("background returns the explicit HLS unsupported error when playlistUrl only exposes segmented streams", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "https://video.twimg.com/ext_tw_video/556/playlist/master.m3u8") {
      return new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2176000,RESOLUTION=1280x720
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
360p/index.m3u8
`,
        { status: 200 }
      );
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/user/status/556",
    playlistUrl: "https://video.twimg.com/ext_tw_video/556/playlist/master.m3u8"
  };

  const result = listener?.({ type: "SEND_TO_TELEGRAM", payload }, {}, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([
    ["https://video.twimg.com/ext_tw_video/556/playlist/master.m3u8", { credentials: "omit" }]
  ]);
  expect(sendResponse).toHaveBeenCalledWith({
    ok: false,
    error: UNSUPPORTED_SEGMENTED_HLS_ERROR
  });
});

test("background fails clearly when a video post has no trustworthy downloadable candidates", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/user/status/999"
  };

  const result = listener?.({ type: "SEND_TO_TELEGRAM", payload }, {}, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([]);
  expect(sendResponse).toHaveBeenCalledWith({
    ok: false,
    error: "Could not find a trustworthy downloadable video URL for this post. To avoid sending the wrong video, TTT stopped instead."
  });
});

test("background returns only recovered video candidates stored for the same sender tab and post URL", async () => {
  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const recordResponse = vi.fn();
  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/321",
    candidates: [
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/321/pu/vid/avc1/main.mp4",
        source: "page-fetch",
        mimeType: "video/mp4"
      }
    ]
  }, { tab: { id: 44 } }, recordResponse);
  await new Promise((resolve) => setTimeout(resolve, 0));

  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/321",
    candidates: [
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/321/pl/other-tab.m3u8",
        source: "page-xhr"
      }
    ]
  }, { tab: { id: 45 } }, vi.fn());
  await new Promise((resolve) => setTimeout(resolve, 0));

  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/999321",
    candidates: [
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/999321/pl/other-post.m3u8",
        source: "page-xhr"
      }
    ]
  }, { tab: { id: 44 } }, vi.fn());
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "GET_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/321"
  }, { tab: { id: 44 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sendResponse).toHaveBeenCalledWith({
    ok: true,
    result: {
      candidates: [
        {
          kind: "direct-mp4",
          url: "https://video.twimg.com/ext_tw_video/321/pu/vid/avc1/main.mp4",
          source: "page-fetch",
          mimeType: "video/mp4"
        }
      ]
    }
  });
});

test("background returns no recovered video candidates when the same post was only stored for another tab", async () => {
  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/333",
    candidates: [
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/333/pl/master.m3u8",
        source: "page-xhr"
      }
    ]
  }, { tab: { id: 999 } }, vi.fn());
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "GET_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/333"
  }, { tab: { id: 333 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sendResponse).toHaveBeenCalledWith({
    ok: true,
    result: {
      candidates: []
    }
  });
});

test("background fails clearly instead of using same-post candidates stored for another tab when current-tab candidates are unusable", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const recordResponse = vi.fn();
  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/322",
    candidates: [
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/322/pu/vid/avc1/init.mp4",
        source: "page-fetch"
      }
    ]
  }, { tab: { id: 322 } }, recordResponse);
  await new Promise((resolve) => setTimeout(resolve, 0));

  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/322",
    candidates: [
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/322/pl/master.m3u8",
        source: "page-xhr"
      }
    ]
  }, { tab: { id: 999 } }, vi.fn());
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/322"
    }
  }, { tab: { id: 322 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([]);
  expect(sendResponse).toHaveBeenCalledWith({
    ok: false,
    error: "Could not find a trustworthy downloadable video URL for this post. To avoid sending the wrong video, TTT stopped instead."
  });
});

test("background fails clearly instead of using same-post candidates stored for another tab when the sender tab has none", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/334",
    candidates: [
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/334/pl/master.m3u8",
        source: "page-xhr"
      }
    ]
  }, { tab: { id: 1000 } }, vi.fn());
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/334"
    }
  }, { tab: { id: 334 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([]);
  expect(sendResponse).toHaveBeenCalledWith({
    ok: false,
    error: "Could not find a trustworthy downloadable video URL for this post. To avoid sending the wrong video, TTT stopped instead."
  });
});

test("background falls back to playlistUrl when a direct videoUrl fetch fails", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://video.twimg.com/ext_tw_video/336/pu/vid/avc1/main.mp4") {
      throw new TypeError("Failed to fetch");
    }

    if (url === "https://video.twimg.com/ext_tw_video/336/pl/master.m3u8") {
      return new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
../360p/video.mp4
`,
        { status: 200 }
      );
    }

    if (url === "https://video.twimg.com/ext_tw_video/336/360p/video.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 336 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/user/status/336",
    videoUrl: "https://video.twimg.com/ext_tw_video/336/pu/vid/avc1/main.mp4",
    playlistUrl: "https://video.twimg.com/ext_tw_video/336/pl/master.m3u8"
  };

  const result = listener?.({ type: "SEND_TO_TELEGRAM", payload }, {}, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([
    ["https://video.twimg.com/ext_tw_video/336/pu/vid/avc1/main.mp4", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/336/pl/master.m3u8", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/336/360p/video.mp4", { credentials: "omit" }]
  ]);
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 336 } });
});

test("background falls back to playlistUrl when a direct videoUrl returns 403", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://video.twimg.com/ext_tw_video/3361/pu/vid/avc1/main.mp4") {
      return new Response("denied", { status: 403 });
    }

    if (url === "https://video.twimg.com/ext_tw_video/3361/pl/master.m3u8") {
      return new Response(
        `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360\n../360p/video.mp4\n`,
        { status: 200 }
      );
    }

    if (url === "https://video.twimg.com/ext_tw_video/3361/360p/video.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 3361 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/user/status/3361",
    videoUrl: "https://video.twimg.com/ext_tw_video/3361/pu/vid/avc1/main.mp4",
    playlistUrl: "https://video.twimg.com/ext_tw_video/3361/pl/master.m3u8"
  };

  const result = listener?.({ type: "SEND_TO_TELEGRAM", payload }, {}, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([
    ["https://video.twimg.com/ext_tw_video/3361/pu/vid/avc1/main.mp4", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/3361/pl/master.m3u8", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/3361/360p/video.mp4", { credentials: "omit" }]
  ]);
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 3361 } });
});

test("background retries through a recovered playlist when recovered direct video bytes are invalid", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://video.twimg.com/ext_tw_video/341/pu/vid/avc1/main.mp4") {
      return new Response(new Uint8Array([3, 4, 1]), { status: 200 });
    }

    if (url === "https://video.twimg.com/ext_tw_video/341/pl/master.m3u8") {
      return new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
../360p/video.mp4
`,
        { status: 200 }
      );
    }

    if (url === "https://video.twimg.com/ext_tw_video/341/360p/video.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      expect((video as Blob).size).toBe(VALID_MP4_SIZE);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 341 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const recordResponse = vi.fn();
  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/341",
    candidates: [
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/341/pu/vid/avc1/main.mp4",
        source: "page-fetch"
      },
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/341/pl/master.m3u8",
        source: "page-xhr"
      }
    ]
  }, { tab: { id: 341 } }, recordResponse);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/341"
    }
  }, { tab: { id: 341 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([
    ["https://video.twimg.com/ext_tw_video/341/pu/vid/avc1/main.mp4", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/341/pl/master.m3u8", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/341/360p/video.mp4", { credentials: "omit" }]
  ]);
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 341 } });
});

test("background surfaces the explicit invalid-file error when direct video bytes are invalid and no playlist is available", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "https://video.twimg.com/ext_tw_video/342/pu/vid/avc1/main.mp4") {
      return new Response(new Uint8Array([3, 4, 2]), { status: 200 });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/342",
      videoUrl: "https://video.twimg.com/ext_tw_video/342/pu/vid/avc1/main.mp4"
    }
  }, {}, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([
    ["https://video.twimg.com/ext_tw_video/342/pu/vid/avc1/main.mp4", { credentials: "omit" }]
  ]);
  expect(sendResponse).toHaveBeenCalledWith({
    ok: false,
    error: BROWSER_VIDEO_INVALID_FILE_ERROR
  });
});

test("background falls back to a recovered playlist when the recovered direct video fetch fails", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://video.twimg.com/ext_tw_video/338/pu/vid/avc1/main.mp4") {
      throw new TypeError("Failed to fetch");
    }

    if (url === "https://video.twimg.com/ext_tw_video/338/pl/master.m3u8") {
      return new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
../360p/video.mp4
`,
        { status: 200 }
      );
    }

    if (url === "https://video.twimg.com/ext_tw_video/338/360p/video.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 338 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const recordResponse = vi.fn();
  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/338",
    candidates: [
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/338/pu/vid/avc1/main.mp4",
        source: "page-fetch"
      },
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/338/pl/master.m3u8",
        source: "page-xhr"
      }
    ]
  }, { tab: { id: 338 } }, recordResponse);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/338"
    }
  }, { tab: { id: 338 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([
    ["https://video.twimg.com/ext_tw_video/338/pu/vid/avc1/main.mp4", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/338/pl/master.m3u8", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/338/360p/video.mp4", { credentials: "omit" }]
  ]);
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 338 } });
});

test("background falls back to a recovered playlist when the recovered direct video returns 404", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://video.twimg.com/ext_tw_video/3381/pu/vid/avc1/main.mp4") {
      return new Response("missing", { status: 404 });
    }

    if (url === "https://video.twimg.com/ext_tw_video/3381/pl/master.m3u8") {
      return new Response(
        `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360\n../360p/video.mp4\n`,
        { status: 200 }
      );
    }

    if (url === "https://video.twimg.com/ext_tw_video/3381/360p/video.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 3381 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const recordResponse = vi.fn();
  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/3381",
    candidates: [
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/3381/pu/vid/avc1/main.mp4",
        source: "page-fetch"
      },
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/3381/pl/master.m3u8",
        source: "page-xhr"
      }
    ]
  }, { tab: { id: 3381 } }, recordResponse);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/3381"
    }
  }, { tab: { id: 3381 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([
    ["https://video.twimg.com/ext_tw_video/3381/pu/vid/avc1/main.mp4", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/3381/pl/master.m3u8", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/3381/360p/video.mp4", { credentials: "omit" }]
  ]);
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 3381 } });
});

test("background surfaces the direct fetch failure instead of using same-post playlist candidates stored for another tab", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "https://video.twimg.com/ext_tw_video/339/pu/vid/avc1/main.mp4") {
      throw new TypeError("Failed to fetch");
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const recordResponse = vi.fn();
  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/339",
    candidates: [
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/339/pu/vid/avc1/main.mp4",
        source: "page-fetch"
      }
    ]
  }, { tab: { id: 339 } }, recordResponse);
  await new Promise((resolve) => setTimeout(resolve, 0));

  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/339",
    candidates: [
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/339/pl/master.m3u8",
        source: "page-xhr"
      }
    ]
  }, { tab: { id: 1001 } }, vi.fn());
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/339"
    }
  }, { tab: { id: 339 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([
    ["https://video.twimg.com/ext_tw_video/339/pu/vid/avc1/main.mp4", { credentials: "omit" }]
  ]);
  expect(sendResponse).toHaveBeenCalledWith({
    ok: false,
    error: "Failed to download the video in the browser. X/Twitter may not have exposed a directly fetchable file for this post."
  });
});

test("background prefers the later tied stored playlist candidate after direct recovery fetch fails", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://video.twimg.com/ext_tw_video/340/pu/vid/avc1/main.mp4") {
      throw new TypeError("Failed to fetch");
    }

    if (url === "https://video.twimg.com/ext_tw_video/340/pl/stale-master.m3u8") {
      throw new Error("stale playlist should not be used");
    }

    if (url === "https://video.twimg.com/ext_tw_video/340/pl/fresh-master.m3u8") {
      return new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2176000,RESOLUTION=1280x720
../720p/video.mp4
`,
        { status: 200 }
      );
    }

    if (url === "https://video.twimg.com/ext_tw_video/340/720p/video.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      expect((video as Blob).size).toBe(VALID_MP4_SIZE);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 340 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const recordResponse = vi.fn();
  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/340",
    candidates: [
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/340/pu/vid/avc1/main.mp4",
        source: "page-fetch"
      }
    ]
  }, { tab: { id: 340 } }, recordResponse);
  await new Promise((resolve) => setTimeout(resolve, 0));

  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/340",
    candidates: [
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/340/pl/stale-master.m3u8",
        source: "performance"
      },
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/340/pl/fresh-master.m3u8",
        source: "performance"
      }
    ]
  }, { tab: { id: 340 } }, vi.fn());
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/340"
    }
  }, { tab: { id: 340 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(getVideoDownloadFetchCalls(fetchMock)).toEqual([
    ["https://video.twimg.com/ext_tw_video/340/pu/vid/avc1/main.mp4", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/340/pl/fresh-master.m3u8", { credentials: "omit" }],
    ["https://video.twimg.com/ext_tw_video/340/720p/video.mp4", { credentials: "omit" }]
  ]);
  expect(getVideoDownloadFetchCalls(fetchMock)).not.toContainEqual([
    "https://video.twimg.com/ext_tw_video/340/pl/stale-master.m3u8",
    { credentials: "omit" }
  ]);
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 340 } });
});

test("background attempts tweet-json direct mp4 before heuristic direct mp4 for the same post", async () => {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === "https://api.x.com/1.1/guest/activate.json") {
      return jsonResponse({ guest_token: "guest-token-345" });
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
                    entryId: "tweet-345",
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            rest_id: "345",
                            legacy: {
                              extended_entities: {
                                media: [
                                  {
                                    type: "video",
                                    video_info: {
                                      variants: [
                                        {
                                          content_type: "application/x-mpegURL",
                                          url: "https://video.twimg.com/ext_tw_video/345/pl/master.m3u8?tag=14"
                                        },
                                        {
                                          bitrate: 832000,
                                          content_type: "video/mp4",
                                          url: "https://video.twimg.com/ext_tw_video/345/pu/vid/avc1/tweet-json.mp4?tag=14"
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
                ]
              }
            ]
          }
        }
      });
    }

    if (url === "https://video.twimg.com/ext_tw_video/345/pu/vid/avc1/tweet-json.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      expect((video as Blob).size).toBe(VALID_MP4_SIZE);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 345 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url === "https://video.twimg.com/ext_tw_video/345/pu/vid/avc1/heuristic-first.mp4") {
      throw new Error("heuristic direct should not be attempted first");
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const recordResponse = vi.fn();
  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/345",
    candidates: [
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/345/pu/vid/avc1/heuristic-first.mp4",
        source: "page-fetch",
        bitrate: 2176000
      }
    ]
  }, { tab: { id: 345 } }, recordResponse);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/345"
    }
  }, { tab: { id: 345 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "https://api.x.com/1.1/guest/activate.json",
    expect.objectContaining({ method: "POST" })
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining("https://api.x.com/graphql/4Siu98E55GquhG52zHdY5w/TweetDetail"),
    expect.objectContaining({ headers: expect.objectContaining({ "x-guest-token": "guest-token-345" }) })
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    3,
    "https://video.twimg.com/ext_tw_video/345/pu/vid/avc1/tweet-json.mp4",
    { credentials: "omit" }
  );
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 345 } });
});

test("background prefers tweet-json playlist rescue over direct mp4 in the broken-container window", async () => {
  const tweetId = "1732939718456246272";
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === "https://api.x.com/1.1/guest/activate.json") {
      return jsonResponse({ guest_token: "guest-token-broken-window-bg-1" });
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
                                          url: "https://video.twimg.com/ext_tw_video/173020/pu/vid/avc1/direct.mp4?tag=14"
                                        },
                                        {
                                          content_type: "application/x-mpegURL",
                                          url: "https://video.twimg.com/ext_tw_video/173020/pl/master.m3u8?tag=14"
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
                ]
              }
            ]
          }
        }
      });
    }

    if (url === "https://video.twimg.com/ext_tw_video/173020/pl/master.m3u8?tag=14") {
      return new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
../360p/video.mp4
`,
        { status: 200 }
      );
    }

    if (url === "https://video.twimg.com/ext_tw_video/173020/360p/video.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      expect((video as Blob).size).toBe(VALID_MP4_SIZE);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 173020 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url === "https://video.twimg.com/ext_tw_video/173020/pu/vid/avc1/direct.mp4") {
      throw new Error("broken-window direct mp4 should not be attempted before playlist rescue");
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: `https://x.com/user/status/${tweetId}`,
      videoUrl: "https://video.twimg.com/ext_tw_video/173020/pu/vid/avc1/heuristic.mp4"
    }
  }, { tab: { id: 173020 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchMock).toHaveBeenNthCalledWith(
    3,
    "https://video.twimg.com/ext_tw_video/173020/pl/master.m3u8?tag=14",
    { credentials: "omit" }
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    4,
    "https://video.twimg.com/ext_tw_video/173020/360p/video.mp4",
    { credentials: "omit" }
  );
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 173020 } });
});

test("background prefers an available playlist rescue over broken-window TweetDetail direct-only candidates", async () => {
  const tweetId = "1732939718456246273";
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === "https://api.x.com/1.1/guest/activate.json") {
      return jsonResponse({ guest_token: "guest-token-broken-window-bg-3" });
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
                                          url: "https://video.twimg.com/ext_tw_video/173020/pu/vid/avc1/direct-only.mp4?tag=14"
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
                ]
              }
            ]
          }
        }
      });
    }

    if (url === "https://video.twimg.com/ext_tw_video/173020/pl/payload-master.m3u8") {
      return new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
../360p/video.mp4
`,
        { status: 200 }
      );
    }

    if (url === "https://video.twimg.com/ext_tw_video/173020/360p/video.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      expect((video as Blob).size).toBe(VALID_MP4_SIZE);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 173022 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
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
                  url: "https://video.twimg.com/ext_tw_video/173020/low.mp4?tag=14"
                }
              ]
            }
          }
        ]
      });
    }

    if (url === "https://video.twimg.com/ext_tw_video/173020/pu/vid/avc1/direct-only.mp4") {
      throw new Error("broken-window direct-only mp4 should not be attempted before playlist rescue");
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: `https://x.com/user/status/${tweetId}`,
      playlistUrl: "https://video.twimg.com/ext_tw_video/173020/pl/payload-master.m3u8"
    }
  }, { tab: { id: 173022 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchMock).toHaveBeenNthCalledWith(
    3,
    expect.stringContaining("https://cdn.syndication.twimg.com/tweet-result"),
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    4,
    "https://video.twimg.com/ext_tw_video/173020/pl/payload-master.m3u8",
    { credentials: "omit" }
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    5,
    "https://video.twimg.com/ext_tw_video/173020/360p/video.mp4",
    { credentials: "omit" }
  );
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 173022 } });
});


test("background attempts tweet-json direct mp4 before tweet-json HLS when both are available", async () => {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === "https://api.x.com/1.1/guest/activate.json") {
      return jsonResponse({ guest_token: "guest-token-346" });
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
                    entryId: "tweet-346",
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            rest_id: "346",
                            legacy: {
                              extended_entities: {
                                media: [
                                  {
                                    type: "video",
                                    video_info: {
                                      variants: [
                                        {
                                          content_type: "application/x-mpegURL",
                                          url: "https://video.twimg.com/ext_tw_video/346/pl/master.m3u8?tag=14"
                                        },
                                        {
                                          bitrate: 832000,
                                          content_type: "video/mp4",
                                          url: "https://video.twimg.com/ext_tw_video/346/pu/vid/avc1/direct.mp4?tag=14"
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
                ]
              }
            ]
          }
        }
      });
    }

    if (url === "https://video.twimg.com/ext_tw_video/346/pu/vid/avc1/direct.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      expect((video as Blob).size).toBe(VALID_MP4_SIZE);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 346 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url === "https://video.twimg.com/ext_tw_video/346/pl/master.m3u8?tag=14") {
      throw new Error("playlist should not be attempted before tweet-json direct mp4");
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/346",
      videoUrl: "https://video.twimg.com/ext_tw_video/346/pu/vid/avc1/heuristic.mp4"
    }
  }, { tab: { id: 346 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchMock).toHaveBeenNthCalledWith(
    3,
    "https://video.twimg.com/ext_tw_video/346/pu/vid/avc1/direct.mp4",
    { credentials: "omit" }
  );
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 346 } });
});

test("background attempts tweet-json direct mp4 before payload playlistUrl when both are available", async () => {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === "https://api.x.com/1.1/guest/activate.json") {
      return jsonResponse({ guest_token: "guest-token-346b" });
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
                    entryId: "tweet-3461",
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            rest_id: "3461",
                            legacy: {
                              extended_entities: {
                                media: [
                                  {
                                    type: "video",
                                    video_info: {
                                      variants: [
                                        {
                                          content_type: "application/x-mpegURL",
                                          url: "https://video.twimg.com/ext_tw_video/3461/pl/tweet-json-master.m3u8?tag=14"
                                        },
                                        {
                                          bitrate: 832000,
                                          content_type: "video/mp4",
                                          url: "https://video.twimg.com/ext_tw_video/3461/pu/vid/avc1/direct.mp4?tag=14"
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
                ]
              }
            ]
          }
        }
      });
    }

    if (url === "https://video.twimg.com/ext_tw_video/3461/pu/vid/avc1/direct.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      expect((video as Blob).size).toBe(VALID_MP4_SIZE);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 3461 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url === "https://video.twimg.com/ext_tw_video/3461/pl/payload-master.m3u8") {
      throw new Error("payload playlist should not be attempted before tweet-json direct mp4");
    }

    if (url === "https://video.twimg.com/ext_tw_video/3461/pl/tweet-json-master.m3u8?tag=14") {
      throw new Error("tweet-json playlist should not be attempted before tweet-json direct mp4");
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/3461",
      playlistUrl: "https://video.twimg.com/ext_tw_video/3461/pl/payload-master.m3u8"
    }
  }, { tab: { id: 3461 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchMock).toHaveBeenNthCalledWith(
    1,
    "https://api.x.com/1.1/guest/activate.json",
    expect.objectContaining({ method: "POST" })
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining("https://api.x.com/graphql/4Siu98E55GquhG52zHdY5w/TweetDetail"),
    expect.objectContaining({ headers: expect.objectContaining({ "x-guest-token": "guest-token-346b" }) })
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    3,
    "https://video.twimg.com/ext_tw_video/3461/pu/vid/avc1/direct.mp4",
    { credentials: "omit" }
  );
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 3461 } });
});

test("background rescues with playlist when tweet-json direct mp4 fails validation", async () => {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === "https://api.x.com/1.1/guest/activate.json") {
      return jsonResponse({ guest_token: "guest-token-347" });
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
                    entryId: "tweet-347",
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            rest_id: "347",
                            legacy: {
                              extended_entities: {
                                media: [
                                  {
                                    type: "video",
                                    video_info: {
                                      variants: [
                                        {
                                          content_type: "application/x-mpegURL",
                                          url: "https://video.twimg.com/ext_tw_video/347/pl/master.m3u8?tag=14"
                                        },
                                        {
                                          bitrate: 832000,
                                          content_type: "video/mp4",
                                          url: "https://video.twimg.com/ext_tw_video/347/pu/vid/avc1/direct.mp4?tag=14"
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
                ]
              }
            ]
          }
        }
      });
    }

    if (url === "https://video.twimg.com/ext_tw_video/347/pu/vid/avc1/direct.mp4") {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "Content-Type": "video/mp4" }
      });
    }

    if (url === "https://video.twimg.com/ext_tw_video/347/pl/master.m3u8?tag=14") {
      return new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
../360p/video.mp4
`,
        { status: 200 }
      );
    }

    if (url === "https://video.twimg.com/ext_tw_video/347/360p/video.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      expect((video as Blob).size).toBe(VALID_MP4_SIZE);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 347 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/347",
      videoUrl: "https://video.twimg.com/ext_tw_video/347/pu/vid/avc1/heuristic.mp4"
    }
  }, { tab: { id: 347 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchMock).toHaveBeenNthCalledWith(
    3,
    "https://video.twimg.com/ext_tw_video/347/pu/vid/avc1/direct.mp4",
    { credentials: "omit" }
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    4,
    "https://video.twimg.com/ext_tw_video/347/pl/master.m3u8?tag=14",
    { credentials: "omit" }
  );
  expect(fetchMock).toHaveBeenNthCalledWith(
    5,
    "https://video.twimg.com/ext_tw_video/347/360p/video.mp4",
    { credentials: "omit" }
  );
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 347 } });
});

test("background succeeds with tweet-json direct mp4 when heuristics would otherwise pick a bad direct first", async () => {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === "https://api.x.com/1.1/guest/activate.json") {
      return jsonResponse({ guest_token: "guest-token-348" });
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
                    entryId: "tweet-348",
                    content: {
                      itemContent: {
                        tweet_results: {
                          result: {
                            rest_id: "348",
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
                                          url: "https://video.twimg.com/ext_tw_video/348/pu/vid/avc1/good.mp4?tag=14"
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
                ]
              }
            ]
          }
        }
      });
    }

    if (url === "https://video.twimg.com/ext_tw_video/348/pu/vid/avc1/good.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      expect((video as Blob).size).toBe(VALID_MP4_SIZE);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 348 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (url === "https://video.twimg.com/ext_tw_video/348/pu/vid/avc1/bad-heuristic.mp4") {
      throw new Error("bad heuristic direct should not be used first");
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const recordResponse = vi.fn();
  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/348",
    candidates: [
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/348/pu/vid/avc1/bad-heuristic.mp4",
        source: "page-fetch",
        bitrate: 2176000
      }
    ]
  }, { tab: { id: 348 } }, recordResponse);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/348"
    }
  }, { tab: { id: 348 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchMock).toHaveBeenNthCalledWith(
    3,
    "https://video.twimg.com/ext_tw_video/348/pu/vid/avc1/good.mp4",
    { credentials: "omit" }
  );
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 348 } });
});

test("background returns the Telegram API error after post-scoped playlist rescue succeeds but upload is rejected", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "https://video.twimg.com/ext_tw_video/337/pl/master.m3u8") {
      return new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
../360p/video.mp4
`,
        { status: 200 }
      );
    }

    if (url === "https://video.twimg.com/ext_tw_video/337/360p/video.mp4") {
      return new Response(createValidMp4Bytes(), { status: 200 });
    }

    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      return new Response(JSON.stringify({ ok: false, description: "Bad Request: file is too big" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const recordResponse = vi.fn();
  listener?.({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/user/status/337",
    candidates: [
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/337/pl/master.m3u8",
        source: "page-xhr"
      }
    ]
  }, { tab: { id: 337 } }, recordResponse);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const sendResponse = vi.fn();
  const result = listener?.({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/337"
    }
  }, { tab: { id: 337 } }, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sendResponse).toHaveBeenCalledWith({
    ok: false,
    error: "Bad Request: file is too big"
  });
});

test("background uploads transferred blob-backed video bytes without re-fetching a remote video URL", async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://api.telegram.org/bottoken/sendVideo") {
      const formData = init?.body as FormData;
      const video = formData.get("video");
      expect(video).toBeInstanceOf(Blob);
      expect((video as Blob).size).toBe(3);

      return new Response(JSON.stringify({ ok: true, result: { message_id: 2 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/user/status/2043460152318406656",
    videoBlobBytes: [7, 8, 9],
    videoFilename: "video.mp4",
    videoMimeType: "video/mp4"
  };

  const result = listener?.({ type: "SEND_TO_TELEGRAM", payload }, {}, sendResponse);

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: { message_id: 2 } });
});
