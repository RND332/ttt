import { describe, expect, test, vi } from "vitest";
import { TTT_PAGE_BLOB_REQUEST, TTT_PAGE_BLOB_RESPONSE } from "./page-blob-video-bridge";

describe("page blob video bridge installer", () => {
  test("ensurePageBlobBridgeInstalled injects the bridge in the MAIN world", async () => {
    const executeScript = vi.fn(async () => [{ result: undefined }]);
    const chromeMock = {
      scripting: { executeScript }
    } as any;

    const { ensurePageBlobBridgeInstalled } = await import("./page-blob-video-bridge-install");

    await ensurePageBlobBridgeInstalled(chromeMock, { tabId: 7, frameIds: [3] });

    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 7, frameIds: [3] },
      world: "MAIN",
      func: expect.any(Function),
      args: [TTT_PAGE_BLOB_REQUEST, TTT_PAGE_BLOB_RESPONSE]
    }));
  });

  test("ensurePageBlobBridgeInstalled uses a self-contained injected function", async () => {
    const executeScript = vi.fn(async () => [{ result: undefined }]);
    const chromeMock = {
      scripting: { executeScript }
    } as any;

    const { ensurePageBlobBridgeInstalled } = await import("./page-blob-video-bridge-install");

    await ensurePageBlobBridgeInstalled(chromeMock, { tabId: 7 });

    expect(executeScript).toHaveBeenCalledTimes(1);
    const mockCalls = executeScript.mock.calls as unknown as Array<Array<{
      func: (requestType: string, responseType: string) => void;
      args: [string, string];
    }>>;
    const firstCall = mockCalls[0];
    expect(firstCall).toBeTruthy();
    const injection = firstCall[0];
    expect(injection.func).toBeTypeOf("function");
    expect(injection.args).toEqual([TTT_PAGE_BLOB_REQUEST, TTT_PAGE_BLOB_RESPONSE]);

    const listeners = new Map<string, EventListener[]>();
    const fakeWindow = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, [...(listeners.get(type) || []), handler]);
      }),
      postMessage: vi.fn(),
      __tttPageBlobBridgeInstalled: false
    } as any;
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([4, 5, 6]), {
      status: 200,
      headers: { "Content-Type": "video/mp4" }
    }));

    const originalWindow = (globalThis as any).window;
    const originalFetch = globalThis.fetch;

    (globalThis as any).window = fakeWindow;
    globalThis.fetch = fetchMock as any;
    expect(() => injection.func(...injection.args)).not.toThrow();

    const handlers = listeners.get("message") || [];
    expect(handlers).toHaveLength(1);

    await Promise.all(handlers.map((handler) => handler({
      data: {
        type: TTT_PAGE_BLOB_REQUEST,
        requestId: "req-1",
        blobUrl: "blob:https://x.com/video"
      },
      source: fakeWindow
    } as any)));

    (globalThis as any).window = originalWindow;
    globalThis.fetch = originalFetch;

    expect(fetchMock).toHaveBeenCalledWith("blob:https://x.com/video");
    expect(fakeWindow.postMessage).toHaveBeenCalledWith({
      type: TTT_PAGE_BLOB_RESPONSE,
      requestId: "req-1",
      ok: true,
      bytes: [4, 5, 6],
      mimeType: "video/mp4"
    }, "*");
  });

  test("ensurePageBlobBridgeInstalled translates fetch failures into a stream-backed video error", async () => {
    const executeScript = vi.fn(async () => [{ result: undefined }]);
    const chromeMock = {
      scripting: { executeScript }
    } as any;

    const { ensurePageBlobBridgeInstalled } = await import("./page-blob-video-bridge-install");

    await ensurePageBlobBridgeInstalled(chromeMock, { tabId: 7 });

    const mockCalls = executeScript.mock.calls as unknown as Array<Array<{
      func: (requestType: string, responseType: string) => void;
      args: [string, string];
    }>>;
    const injection = mockCalls[0][0];

    const listeners = new Map<string, EventListener[]>();
    const fakeWindow = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, [...(listeners.get(type) || []), handler]);
      }),
      postMessage: vi.fn(),
      __tttPageBlobBridgeInstalled: false
    } as any;
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    const originalWindow = (globalThis as any).window;
    const originalFetch = globalThis.fetch;
    (globalThis as any).window = fakeWindow;
    globalThis.fetch = fetchMock as any;
    injection.func(...injection.args);

    const handlers = listeners.get("message") || [];
    await Promise.all(handlers.map((handler) => handler({
      data: {
        type: TTT_PAGE_BLOB_REQUEST,
        requestId: "req-2",
        blobUrl: "blob:https://x.com/video"
      },
      source: fakeWindow
    } as any)));

    (globalThis as any).window = originalWindow;
    globalThis.fetch = originalFetch;

    expect(fakeWindow.postMessage).toHaveBeenCalledWith({
      type: TTT_PAGE_BLOB_RESPONSE,
      requestId: "req-2",
      ok: false,
      error: "This X video appears to be stream-backed (likely MediaSource/HLS), so the browser cannot fetch it directly yet."
    }, "*");
  });

  test("installMainWorldBlobBridge registers the bridge only once", async () => {
    const addEventListener = vi.fn();
    const fakeWindow = {
      addEventListener,
      __tttPageBlobBridgeInstalled: false
    } as any;

    const { installMainWorldBlobBridge } = await import("./page-blob-video-bridge-install");

    installMainWorldBlobBridge(fakeWindow);
    installMainWorldBlobBridge(fakeWindow);

    expect(addEventListener).toHaveBeenCalledTimes(1);
    expect(fakeWindow.__tttPageBlobBridgeInstalled).toBe(true);
  });
});