import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { recoverStreamVideoCandidates } = vi.hoisted(() => ({
  recoverStreamVideoCandidates: vi.fn(async () => ({ reported: 0 }))
}));

const { resolveTwitterVideoCandidatesFromPage } = vi.hoisted(() => ({
  resolveTwitterVideoCandidatesFromPage: vi.fn(async () => [])
}));

vi.mock("./page-stream-video-discovery", () => ({
  recoverStreamVideoCandidates
}));

vi.mock("./page-twitter-video-resolver", () => ({
  resolveTwitterVideoCandidatesFromPage
}));

import { createSendHandler } from "./content-send";
import type { TelegramSendPayload } from "./shared";

const originalChrome = globalThis.chrome;
const originalBrowser = (globalThis as any).browser;

beforeEach(() => {
  (globalThis as any).chrome = undefined;
  (globalThis as any).browser = undefined;
  recoverStreamVideoCandidates.mockReset();
  recoverStreamVideoCandidates.mockResolvedValue({ reported: 0 });
  resolveTwitterVideoCandidatesFromPage.mockReset();
  resolveTwitterVideoCandidatesFromPage.mockResolvedValue([]);
});

afterEach(() => {
  (globalThis as any).chrome = originalChrome;
  (globalThis as any).browser = originalBrowser;
  vi.clearAllMocks();
});

function makeSettings() {
  return {
    botToken: "token",
    channelId: "channel",
    autoPrefix: true
  };
}

test("createSendHandler forwards video payloads directly to the background script", async () => {
  const sendMessage = vi.fn(async (message: any) => {
    if (message.type === "SEND_TO_TELEGRAM") return { ok: true, result: {} };
    throw new Error(`unexpected message ${message.type}`);
  });

  (globalThis as any).chrome = {
    permissions: { request: vi.fn(async () => true) },
    storage: { local: { get: vi.fn(async () => makeSettings()) } },
    runtime: { sendMessage }
  };

  const handler = createSendHandler();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/u/status/1",
    videoUrl: "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/example.mp4"
  };

  await expect(handler(payload)).resolves.toEqual({ ok: true, result: {} });
  expect(sendMessage).toHaveBeenCalledWith({ type: "SEND_TO_TELEGRAM", payload });
  expect(sendMessage).toHaveBeenCalledTimes(1);
});

test("createSendHandler forwards photo payloads unchanged", async () => {
  const sendMessage = vi.fn(async () => ({ ok: true, result: {} }));

  (globalThis as any).chrome = {
    storage: { local: { get: vi.fn(async () => makeSettings()) } },
    runtime: { sendMessage }
  };

  const handler = createSendHandler();
  const payload: TelegramSendPayload = {
    kind: "photo",
    mediaUrl: "https://pbs.twimg.com/media/x.jpg",
    postUrl: "https://x.com/u/status/1"
  };
  await handler(payload);

  expect(sendMessage).toHaveBeenCalledWith({ type: "SEND_TO_TELEGRAM", payload });
});

test("createSendHandler resolves blob-backed videos through the page bridge before messaging background", async () => {
  const sendMessage = vi.fn(async (message: any) => {
    if (message.type === "ENSURE_PAGE_BLOB_BRIDGE") return { ok: true, result: undefined };
    if (message.type === "SEND_TO_TELEGRAM") return { ok: true, result: {} };
    throw new Error(`unexpected message ${message.type}`);
  });
  const fetchMock = vi.fn();
  const resolveBlobUrl = vi.fn(async () => ({
    bytes: [7, 8, 9],
    mimeType: "video/mp4"
  }));

  vi.stubGlobal("fetch", fetchMock);
  (globalThis as any).chrome = {
    storage: { local: { get: vi.fn(async () => makeSettings()) } },
    runtime: { sendMessage }
  };

  const handler = createSendHandler({
    blobBridgeClient: { resolveBlobUrl }
  });
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/u/status/2043460152318406656",
    blobUrl: "blob:https://x.com/d7115a17-e355-42fa-9827-3769e2daed43"
  };

  await expect(handler(payload)).resolves.toEqual({ ok: true, result: {} });

  expect(fetchMock).not.toHaveBeenCalled();
  expect(sendMessage).toHaveBeenNthCalledWith(1, { type: "ENSURE_PAGE_BLOB_BRIDGE" });
  expect(resolveBlobUrl).toHaveBeenCalledWith("blob:https://x.com/d7115a17-e355-42fa-9827-3769e2daed43");
  expect(sendMessage).toHaveBeenNthCalledWith(2, {
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/u/status/2043460152318406656",
      videoBlobBytes: [7, 8, 9],
      videoFilename: "video.mp4",
      videoMimeType: "video/mp4"
    }
  });
});

test("createSendHandler forwards an extracted playlistUrl without forcing blob recovery", async () => {
  const sendMessage = vi.fn(async (message: any) => {
    if (message.type === "SEND_TO_TELEGRAM") return { ok: true, result: { message_id: 31 } };
    throw new Error(`unexpected message ${message.type}`);
  });

  (globalThis as any).chrome = {
    storage: { local: { get: vi.fn(async () => makeSettings()) } },
    runtime: { sendMessage }
  };

  const handler = createSendHandler();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/u/status/3001",
    playlistUrl: "https://video.twimg.com/ext_tw_video/3001/master.m3u8"
  };

  await expect(handler(payload)).resolves.toEqual({ ok: true, result: { message_id: 31 } });
  expect(recoverStreamVideoCandidates).not.toHaveBeenCalled();
  expect(sendMessage).toHaveBeenCalledWith({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/u/status/3001",
      playlistUrl: "https://video.twimg.com/ext_tw_video/3001/master.m3u8"
    }
  });
});

test("createSendHandler ignores recovered direct candidates that still point to .m4s artifacts and falls back to HLS playlists", async () => {
  const sendMessage = vi.fn(async (message: any) => {
    if (message.type === "GET_RECOVERED_VIDEO_CANDIDATES") {
      return {
        ok: true,
        result: {
          candidates: [
            {
              kind: "direct-mp4",
              url: "https://video.twimg.com/ext_tw_video/555/pu/vid/avc1/chunk.m4s",
              mimeType: "video/mp4",
              source: "page-fetch"
            },
            {
              kind: "hls-playlist",
              url: "https://video.twimg.com/ext_tw_video/555/playlist/master.m3u8",
              mimeType: "application/x-mpegURL",
              source: "page-xhr"
            }
          ]
        }
      };
    }

    if (message.type === "SEND_TO_TELEGRAM") return { ok: true, result: {} };
    throw new Error(`unexpected message ${message.type}`);
  });

  (globalThis as any).chrome = {
    storage: { local: { get: vi.fn(async () => makeSettings()) } },
    runtime: { sendMessage }
  };

  const handler = createSendHandler();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/u/status/555"
  };

  await expect(handler(payload)).resolves.toEqual({ ok: true, result: {} });

  expect(recoverStreamVideoCandidates).not.toHaveBeenCalled();
  expect(sendMessage).toHaveBeenNthCalledWith(1, {
    type: "GET_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/u/status/555"
  });
  expect(sendMessage).toHaveBeenNthCalledWith(2, {
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/u/status/555",
      playlistUrl: "https://video.twimg.com/ext_tw_video/555/playlist/master.m3u8"
    }
  });
});

test("createSendHandler uses only already-stored recovered direct video candidates for unresolved videos", async () => {
  const sendMessage = vi.fn(async (message: any) => {
    if (message.type === "GET_RECOVERED_VIDEO_CANDIDATES") {
      return {
        ok: true,
        result: {
          candidates: [
            {
              kind: "direct-mp4",
              url: "https://video.twimg.com/ext_tw_video/555/pu/vid/avc1/recovered.mp4",
              mimeType: "video/mp4",
              source: "page-fetch"
            }
          ]
        }
      };
    }

    if (message.type === "SEND_TO_TELEGRAM") return { ok: true, result: {} };
    throw new Error(`unexpected message ${message.type}`);
  });

  (globalThis as any).chrome = {
    storage: { local: { get: vi.fn(async () => makeSettings()) } },
    runtime: { sendMessage }
  };

  const handler = createSendHandler();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/u/status/555"
  };

  await expect(handler(payload)).resolves.toEqual({ ok: true, result: {} });

  expect(recoverStreamVideoCandidates).not.toHaveBeenCalled();
  expect(sendMessage).toHaveBeenNthCalledWith(1, {
    type: "GET_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/u/status/555"
  });
  expect(sendMessage).toHaveBeenNthCalledWith(2, {
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/u/status/555",
      videoUrl: "https://video.twimg.com/ext_tw_video/555/pu/vid/avc1/recovered.mp4"
    }
  });
});

test("createSendHandler uses page-auth tweet-json candidates for unresolved videos when stored recovery is empty", async () => {
  const sendMessage = vi.fn(async (message: any) => {
    if (message.type === "GET_RECOVERED_VIDEO_CANDIDATES") {
      return {
        ok: true,
        result: {
          candidates: []
        }
      };
    }

    if (message.type === "SEND_TO_TELEGRAM") return { ok: true, result: {} };
    throw new Error(`unexpected message ${message.type}`);
  });

  resolveTwitterVideoCandidatesFromPage.mockResolvedValue([
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/amplify_video/2013425991624876032/vid/avc1/1188x992/sN6YkOgo-EF3XUHD.mp4",
      mimeType: "video/mp4",
      source: "tweet-json",
      bitrate: 832000
    }
  ]);

  (globalThis as any).chrome = {
    storage: { local: { get: vi.fn(async () => makeSettings()) } },
    runtime: { sendMessage }
  };

  const handler = createSendHandler();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/torinyannyan1/status/2013426523601019141"
  };

  await expect(handler(payload)).resolves.toEqual({ ok: true, result: {} });

  expect(resolveTwitterVideoCandidatesFromPage).toHaveBeenCalledWith(
    "https://x.com/torinyannyan1/status/2013426523601019141"
  );
  expect(sendMessage).toHaveBeenNthCalledWith(1, {
    type: "GET_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/torinyannyan1/status/2013426523601019141"
  });
  expect(sendMessage).toHaveBeenNthCalledWith(2, {
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/torinyannyan1/status/2013426523601019141",
      videoUrl: "https://video.twimg.com/amplify_video/2013425991624876032/vid/avc1/1188x992/sN6YkOgo-EF3XUHD.mp4"
    }
  });
});

test("createSendHandler prefers page-auth tweet-json direct candidates over higher-bitrate stored heuristic direct candidates", async () => {
  const sendMessage = vi.fn(async (message: any) => {
    if (message.type === "GET_RECOVERED_VIDEO_CANDIDATES") {
      return {
        ok: true,
        result: {
          candidates: [
            {
              kind: "direct-mp4",
              url: "https://video.twimg.com/ext_tw_video/778/pu/vid/avc1/heuristic-high.mp4",
              mimeType: "video/mp4",
              source: "page-fetch",
              bitrate: 2176000
            }
          ]
        }
      };
    }

    if (message.type === "SEND_TO_TELEGRAM") return { ok: true, result: {} };
    throw new Error(`unexpected message ${message.type}`);
  });

  resolveTwitterVideoCandidatesFromPage.mockResolvedValue([
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/amplify_video/2013425991624876032/vid/avc1/1188x992/sN6YkOgo-EF3XUHD.mp4",
      mimeType: "video/mp4",
      source: "tweet-json",
      bitrate: 832000
    }
  ]);

  (globalThis as any).chrome = {
    storage: { local: { get: vi.fn(async () => makeSettings()) } },
    runtime: { sendMessage }
  };

  const handler = createSendHandler();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/torinyannyan1/status/2013426523601019141"
  };

  await expect(handler(payload)).resolves.toEqual({ ok: true, result: {} });

  expect(resolveTwitterVideoCandidatesFromPage).toHaveBeenCalledWith(
    "https://x.com/torinyannyan1/status/2013426523601019141"
  );
  expect(sendMessage).toHaveBeenNthCalledWith(2, {
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/torinyannyan1/status/2013426523601019141",
      videoUrl: "https://video.twimg.com/amplify_video/2013425991624876032/vid/avc1/1188x992/sN6YkOgo-EF3XUHD.mp4"
    }
  });
});

test("createSendHandler still uses stored recovered candidates when page-auth tweet-json resolution fails", async () => {
  const sendMessage = vi.fn(async (message: any) => {
    if (message.type === "GET_RECOVERED_VIDEO_CANDIDATES") {
      return {
        ok: true,
        result: {
          candidates: [
            {
              kind: "direct-mp4",
              url: "https://video.twimg.com/ext_tw_video/2013/pu/vid/avc1/stored-fallback.mp4",
              mimeType: "video/mp4",
              source: "page-fetch",
              bitrate: 832000
            }
          ]
        }
      };
    }

    if (message.type === "SEND_TO_TELEGRAM") return { ok: true, result: {} };
    throw new Error(`unexpected message ${message.type}`);
  });

  resolveTwitterVideoCandidatesFromPage.mockRejectedValue(
    new Error("Timed out while resolving authenticated Twitter/X video metadata from the page.")
  );

  (globalThis as any).chrome = {
    storage: { local: { get: vi.fn(async () => makeSettings()) } },
    runtime: { sendMessage }
  };

  const handler = createSendHandler();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/torinyannyan1/status/2013426523601019141"
  };

  await expect(handler(payload)).resolves.toEqual({ ok: true, result: {} });

  expect(resolveTwitterVideoCandidatesFromPage).toHaveBeenCalledWith(
    "https://x.com/torinyannyan1/status/2013426523601019141"
  );
  expect(sendMessage).toHaveBeenNthCalledWith(2, {
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/torinyannyan1/status/2013426523601019141",
      videoUrl: "https://video.twimg.com/ext_tw_video/2013/pu/vid/avc1/stored-fallback.mp4"
    }
  });
});

test("createSendHandler checks only already-stored recovered candidates when a blob-backed X video is actually stream-backed", async () => {
  const sendMessage = vi.fn(async (message: any) => {
    if (message.type === "ENSURE_PAGE_BLOB_BRIDGE") return { ok: true, result: undefined };
    if (message.type === "GET_RECOVERED_VIDEO_CANDIDATES") {
      return {
        ok: true,
        result: {
          candidates: [
            {
              kind: "direct-mp4",
              url: "https://video.twimg.com/ext_tw_video/2043/pu/vid/avc1/recovered-after-blob-failure.mp4",
              mimeType: "video/mp4",
              source: "page-fetch"
            }
          ]
        }
      };
    }
    if (message.type === "SEND_TO_TELEGRAM") return { ok: true, result: {} };
    throw new Error(`unexpected message ${message.type}`);
  });
  const resolveBlobUrl = vi.fn(async () => {
    throw new Error("This X video appears to be stream-backed (likely MediaSource/HLS), so the browser cannot fetch it directly yet.");
  });

  (globalThis as any).chrome = {
    storage: { local: { get: vi.fn(async () => makeSettings()) } },
    runtime: { sendMessage }
  };

  const handler = createSendHandler({
    blobBridgeClient: { resolveBlobUrl }
  });
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/u/status/2043",
    blobUrl: "blob:https://x.com/stream-backed"
  };

  await expect(handler(payload)).resolves.toEqual({ ok: true, result: {} });

  expect(recoverStreamVideoCandidates).not.toHaveBeenCalled();
  expect(sendMessage).toHaveBeenNthCalledWith(1, { type: "ENSURE_PAGE_BLOB_BRIDGE" });
  expect(resolveBlobUrl).toHaveBeenCalledWith("blob:https://x.com/stream-backed");
  expect(sendMessage).toHaveBeenNthCalledWith(2, {
    type: "GET_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/u/status/2043"
  });
  expect(sendMessage).toHaveBeenNthCalledWith(3, {
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/u/status/2043",
      videoUrl: "https://video.twimg.com/ext_tw_video/2043/pu/vid/avc1/recovered-after-blob-failure.mp4",
      blobUrl: "blob:https://x.com/stream-backed"
    }
  });
});

test("createSendHandler forwards unresolved videos to background so explicit ambiguity errors can reach the user", async () => {
  const sendMessage = vi.fn(async (message: any) => {
    if (message.type === "GET_RECOVERED_VIDEO_CANDIDATES") {
      return {
        ok: true,
        result: {
          candidates: []
        }
      };
    }

    if (message.type === "SEND_TO_TELEGRAM") {
      return {
        ok: false,
        error: "Could not find a trustworthy downloadable video URL for this post. To avoid sending the wrong video, TTT stopped instead."
      };
    }

    throw new Error(`unexpected message ${message.type}`);
  });

  (globalThis as any).chrome = {
    storage: { local: { get: vi.fn(async () => makeSettings()) } },
    runtime: { sendMessage }
  };

  const handler = createSendHandler();
  const payload: TelegramSendPayload = {
    kind: "video",
    postUrl: "https://x.com/u/status/999"
  };

  await expect(handler(payload)).resolves.toEqual({
    ok: false,
    error: "Could not find a trustworthy downloadable video URL for this post. To avoid sending the wrong video, TTT stopped instead."
  });

  expect(recoverStreamVideoCandidates).not.toHaveBeenCalled();
  expect(sendMessage).toHaveBeenNthCalledWith(1, {
    type: "GET_RECOVERED_VIDEO_CANDIDATES",
    postUrl: "https://x.com/u/status/999"
  });
  expect(sendMessage).toHaveBeenNthCalledWith(2, {
    type: "SEND_TO_TELEGRAM",
    payload
  });
});
