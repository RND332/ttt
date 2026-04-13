import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createBlobBridgeClient,
  installBlobBridgeRuntime,
  TTT_PAGE_BLOB_REQUEST,
  TTT_PAGE_BLOB_RESPONSE
} from "./page-blob-video-bridge";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

describe("page blob video bridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  });

  test("createBlobBridgeClient posts a request and resolves page bridge bytes", async () => {
    const listeners = new Map<string, EventListener[]>();
    const postMessage = vi.fn((message: any) => {
      if (message?.type !== TTT_PAGE_BLOB_REQUEST) return;
      const handlers = listeners.get("message") || [];
      const response = {
        data: {
          type: TTT_PAGE_BLOB_RESPONSE,
          requestId: message.requestId,
          ok: true,
          bytes: [1, 2, 3],
          mimeType: "video/mp4"
        },
        source: fakeWindow as any
      } as any;
      handlers.forEach((handler) => handler(response));
    });

    const fakeWindow = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, [...(listeners.get(type) || []), handler]);
      }),
      removeEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, (listeners.get(type) || []).filter((item) => item !== handler));
      }),
      postMessage
    } as any;

    globalThis.window = fakeWindow;

    const client = createBlobBridgeClient({ timeoutMs: 50, targetWindow: fakeWindow });
    await expect(client.resolveBlobUrl("blob:https://x.com/example")).resolves.toEqual({
      bytes: [1, 2, 3],
      mimeType: "video/mp4"
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toMatchObject({
      type: TTT_PAGE_BLOB_REQUEST,
      blobUrl: "blob:https://x.com/example"
    });
  });

  test("createBlobBridgeClient rejects when the page bridge reports an error", async () => {
    const listeners = new Map<string, EventListener[]>();
    const fakeWindow = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, [...(listeners.get(type) || []), handler]);
      }),
      removeEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, (listeners.get(type) || []).filter((item) => item !== handler));
      }),
      postMessage: vi.fn((message: any) => {
        const handlers = listeners.get("message") || [];
        const response = {
          data: {
            type: TTT_PAGE_BLOB_RESPONSE,
            requestId: message.requestId,
            ok: false,
            error: "bridge failed"
          },
          source: fakeWindow as any
        } as any;
        handlers.forEach((handler) => handler(response));
      })
    } as any;

    globalThis.window = fakeWindow;

    const client = createBlobBridgeClient({ timeoutMs: 50, targetWindow: fakeWindow });
    await expect(client.resolveBlobUrl("blob:https://x.com/example")).rejects.toThrow("bridge failed");
  });

  test("page bridge runtime maps fetch failures to a stream-backed video error", async () => {
    const listeners = new Map<string, EventListener[]>();
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const postMessage = vi.fn();

    globalThis.fetch = fetchMock;
    globalThis.window = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, [...(listeners.get(type) || []), handler]);
      }),
      removeEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, (listeners.get(type) || []).filter((item) => item !== handler));
      }),
      postMessage
    } as any;

    const dispose = installBlobBridgeRuntime(globalThis.window as any);
    const handlers = listeners.get("message") || [];

    await Promise.all(handlers.map((handler) => handler({
      data: {
        type: TTT_PAGE_BLOB_REQUEST,
        requestId: "req-stream",
        blobUrl: "blob:https://x.com/video"
      },
      source: globalThis.window as any
    } as any)));

    expect(postMessage).toHaveBeenCalledWith({
      type: TTT_PAGE_BLOB_RESPONSE,
      requestId: "req-stream",
      ok: false,
      error: "This X video appears to be stream-backed (likely MediaSource/HLS), so the browser cannot fetch it directly yet."
    }, "*");

    dispose();
  });

  test("page bridge runtime reads a blob URL and posts bytes back", async () => {
    const listeners = new Map<string, EventListener[]>();
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([9, 8, 7]), {
      status: 200,
      headers: { "Content-Type": "video/mp4" }
    }));
    const postMessage = vi.fn();

    globalThis.fetch = fetchMock;
    globalThis.window = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, [...(listeners.get(type) || []), handler]);
      }),
      removeEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, (listeners.get(type) || []).filter((item) => item !== handler));
      }),
      postMessage
    } as any;

    const dispose = installBlobBridgeRuntime(globalThis.window as any);
    const handlers = listeners.get("message") || [];

    const event = {
      data: {
        type: TTT_PAGE_BLOB_REQUEST,
        requestId: "req-1",
        blobUrl: "blob:https://x.com/video"
      },
      source: globalThis.window as any
    } as any;

    await Promise.all(handlers.map((handler) => handler(event)));

    expect(fetchMock).toHaveBeenCalledWith("blob:https://x.com/video");
    expect(postMessage).toHaveBeenCalledWith({
      type: TTT_PAGE_BLOB_RESPONSE,
      requestId: "req-1",
      ok: true,
      bytes: [9, 8, 7],
      mimeType: "video/mp4"
    }, "*");

    dispose();
  });
});
