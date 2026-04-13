import { describe, expect, test, vi } from "vitest";
import {
  TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST,
  TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE
} from "./page-stream-video-discovery";

describe("page stream video discovery installer", () => {
  test("ensurePageStreamVideoDiscoveryInstalled injects a self-contained MAIN-world observer", async () => {
    const executeScript = vi.fn(async () => [{ result: undefined }]);
    const chromeMock = { scripting: { executeScript } } as any;

    const { ensurePageStreamVideoDiscoveryInstalled } = await import("./page-stream-video-discovery-install");
    await ensurePageStreamVideoDiscoveryInstalled(chromeMock, { tabId: 7, documentIds: ["doc-1"] });

    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 7, documentIds: ["doc-1"] },
      world: "MAIN",
      func: expect.any(Function),
      args: expect.arrayContaining([
        TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST,
        TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE
      ])
    }));
  });

  test("injected discovery observer ignores segmented artifact urls and responds with only playable candidates", async () => {
    const executeScript = vi.fn(async () => [{ result: undefined }]);
    const chromeMock = { scripting: { executeScript } } as any;

    const { ensurePageStreamVideoDiscoveryInstalled } = await import("./page-stream-video-discovery-install");
    await ensurePageStreamVideoDiscoveryInstalled(chromeMock, { tabId: 10 });

    const injection = executeScript.mock.calls[0]?.[0];
    expect(injection).toBeTruthy();
    const listeners = new Map<string, EventListener[]>();

    class FakeXMLHttpRequest {
      open(_method: string, _url: string) {}
    }

    const fakeWindow = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, [...(listeners.get(type) || []), handler]);
      }),
      postMessage: vi.fn(),
      fetch: vi.fn(async () => new Response("ok", { status: 200 })),
      XMLHttpRequest: FakeXMLHttpRequest as any,
      performance: {
        getEntriesByType: vi.fn(() => [
          { name: "https://video.twimg.com/ext_tw_video/43/pu/vid/avc1/chunk.m4s" },
          { name: "https://video.twimg.com/ext_tw_video/43/pu/vid/avc1/main.mp4" }
        ])
      },
      __tttPageStreamVideoDiscoveryInstalled: false
    } as any;

    const originalWindow = (globalThis as any).window;
    const originalLocation = (globalThis as any).location;
    const originalPerformance = (globalThis as any).performance;

    (globalThis as any).window = fakeWindow;
    (globalThis as any).location = { href: "https://x.com/user/status/43" };
    (globalThis as any).performance = fakeWindow.performance;

    injection.func(...injection.args);
    await fakeWindow.fetch("https://video.twimg.com/ext_tw_video/43/pu/vid/avc1/init.mp4");
    const xhr = new fakeWindow.XMLHttpRequest();
    xhr.open("GET", "https://video.twimg.com/ext_tw_video/43/pu/vid/avc1/main.mp4");

    await Promise.all((listeners.get("message") || []).map((handler) => handler({
      data: {
        type: TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST,
        requestId: "req-stream-2"
      },
      source: fakeWindow
    } as any)));

    (globalThis as any).window = originalWindow;
    (globalThis as any).location = originalLocation;
    (globalThis as any).performance = originalPerformance;

    expect(fakeWindow.postMessage).toHaveBeenCalledWith({
      type: TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE,
      requestId: "req-stream-2",
      ok: true,
      candidates: [
        {
          kind: "direct-mp4",
          url: "https://video.twimg.com/ext_tw_video/43/pu/vid/avc1/main.mp4",
          source: "page-xhr"
        }
      ]
    }, "*");
  });
});
