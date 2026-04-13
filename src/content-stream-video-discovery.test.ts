// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { sendExtensionMessage } = vi.hoisted(() => ({
  sendExtensionMessage: vi.fn()
}));

vi.mock("./runtime-messaging", () => ({
  sendExtensionMessage
}));

describe("content stream video discovery relay", () => {
  const originalPostMessage = window.postMessage;

  beforeEach(() => {
    vi.resetModules();
    sendExtensionMessage.mockReset();
  });

  afterEach(() => {
    window.postMessage = originalPostMessage;
  });

  test("recoverStreamVideoCandidates ensures MAIN-world discovery and reports collected candidates", async () => {
    sendExtensionMessage
      .mockResolvedValueOnce({ ok: true, result: undefined })
      .mockResolvedValueOnce({ ok: true, result: { stored: 1 } });

    const postMessageMock = vi.fn((message: unknown) => {
      const data = message as { type?: string; requestId?: string };
      if (data.type !== "TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST") return;

      window.dispatchEvent(new MessageEvent("message", {
        source: window,
        data: {
          type: "TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE",
          requestId: data.requestId,
          ok: true,
          candidates: [
            {
              kind: "direct-mp4",
              url: "https://video.twimg.com/ext_tw_video/777/pu/vid/avc1/recovered.mp4",
              source: "page-fetch"
            }
          ]
        }
      }));
    });
    window.postMessage = postMessageMock as typeof window.postMessage;

    const { recoverStreamVideoCandidates } = await import("./page-stream-video-discovery");
    await expect(recoverStreamVideoCandidates("https://x.com/user/status/777")).resolves.toEqual({ stored: 1 });

    expect(sendExtensionMessage).toHaveBeenNthCalledWith(1, {
      type: "ENSURE_PAGE_STREAM_VIDEO_DISCOVERY"
    });
    expect(sendExtensionMessage).toHaveBeenNthCalledWith(2, {
      type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
      postUrl: "https://x.com/user/status/777",
      candidates: [
        {
          kind: "direct-mp4",
          url: "https://video.twimg.com/ext_tw_video/777/pu/vid/avc1/recovered.mp4",
          source: "page-fetch"
        }
      ]
    });
  });
});
