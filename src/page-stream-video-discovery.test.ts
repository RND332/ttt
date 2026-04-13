import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createPageStreamVideoDiscoveryClient,
  installPageStreamVideoDiscoveryRuntime
} from "./page-stream-video-discovery";

describe("page stream video discovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("runtime collects direct mp4 and HLS candidates from fetch, xhr, and performance entries", async () => {
    const listeners = new Map<string, EventListener[]>();

    class FakeXMLHttpRequest {
      open(_method: string, _url: string) {}
    }

    const fakeWindow = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, [...(listeners.get(type) || []), handler]);
      }),
      removeEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, (listeners.get(type) || []).filter((item) => item !== handler));
      }),
      postMessage: vi.fn((message: unknown) => {
        for (const handler of listeners.get("message") || []) {
          handler({ data: message, source: fakeWindow } as any);
        }
      }),
      fetch: vi.fn(async () => new Response("ok", { status: 200 })),
      XMLHttpRequest: FakeXMLHttpRequest as any,
      performance: {
        getEntriesByType: vi.fn(() => [
          { name: "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/main.mp4" },
          { name: "https://video.twimg.com/ext_tw_video/123/master.m3u8" },
          { name: "https://pbs.twimg.com/media/not-video.jpg" }
        ])
      }
    } as any;

    const dispose = installPageStreamVideoDiscoveryRuntime(fakeWindow);
    await fakeWindow.fetch("https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/main.mp4");
    const xhr = new fakeWindow.XMLHttpRequest();
    xhr.open("GET", "https://video.twimg.com/ext_tw_video/123/master.m3u8");

    const client = createPageStreamVideoDiscoveryClient({ targetWindow: fakeWindow, timeoutMs: 50 });
    await expect(client.collectCandidates()).resolves.toEqual([
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/main.mp4",
        source: "page-fetch"
      },
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/123/master.m3u8",
        source: "page-xhr"
      }
    ]);

    dispose();
  });

  test("runtime ranks candidates by kind, then source, then url", async () => {
    const listeners = new Map<string, EventListener[]>();

    class FakeXMLHttpRequest {
      open(_method: string, _url: string) {}
    }

    const fakeWindow = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, [...(listeners.get(type) || []), handler]);
      }),
      removeEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, (listeners.get(type) || []).filter((item) => item !== handler));
      }),
      postMessage: vi.fn((message: unknown) => {
        for (const handler of listeners.get("message") || []) {
          handler({ data: message, source: fakeWindow } as any);
        }
      }),
      fetch: vi.fn(async () => new Response("ok", { status: 200 })),
      XMLHttpRequest: FakeXMLHttpRequest as any,
      performance: {
        getEntriesByType: vi.fn(() => [
          { name: "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/b-performance.mp4" }
        ])
      }
    } as any;

    const dispose = installPageStreamVideoDiscoveryRuntime(fakeWindow);
    await fakeWindow.fetch("https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/z-fetch.mp4");
    const xhr = new fakeWindow.XMLHttpRequest();
    xhr.open("GET", "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/a-xhr.mp4");

    const client = createPageStreamVideoDiscoveryClient({ targetWindow: fakeWindow, timeoutMs: 50 });
    await expect(client.collectCandidates()).resolves.toEqual([
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/z-fetch.mp4",
        source: "page-fetch"
      },
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/a-xhr.mp4",
        source: "page-xhr"
      },
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/b-performance.mp4",
        source: "performance"
      }
    ]);

    dispose();
  });

  test("client times out cleanly when the runtime is unavailable", async () => {
    const listeners = new Map<string, EventListener[]>();
    const fakeWindow = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, [...(listeners.get(type) || []), handler]);
      }),
      removeEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, (listeners.get(type) || []).filter((item) => item !== handler));
      }),
      postMessage: vi.fn()
    } as any;

    const client = createPageStreamVideoDiscoveryClient({ targetWindow: fakeWindow, timeoutMs: 10 });
    await expect(client.collectCandidates()).rejects.toThrow("Timed out while collecting recovered X video candidates.");
  });
});
