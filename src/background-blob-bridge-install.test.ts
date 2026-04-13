import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./shared";

vi.mock("./page-stream-video-discovery-install", () => ({
  ensurePageStreamVideoDiscoveryInstalled: vi.fn(async () => [{ result: undefined }])
}));

vi.mock("./page-twitter-video-resolver-install", () => ({
  ensurePageTwitterVideoResolverInstalled: vi.fn(async () => undefined)
}));

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
        get: vi.fn(async () => DEFAULT_SETTINGS),
        set: vi.fn(async () => undefined)
      }
    },
    scripting: {
      executeScript: vi.fn(async () => [{ result: undefined }])
    }
  };
});

afterEach(() => {
  vi.clearAllMocks();
  (globalThis as any).chrome = undefined;
});

test("background installs the page stream discovery observer in MAIN world on demand", async () => {
  await import("../app/background/index");
  const { ensurePageStreamVideoDiscoveryInstalled } = await import("./page-stream-video-discovery-install");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const result = listener?.(
    { type: "ENSURE_PAGE_STREAM_VIDEO_DISCOVERY" },
    { tab: { id: 12 }, documentId: "doc-99" },
    sendResponse
  );

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ensurePageStreamVideoDiscoveryInstalled).toHaveBeenCalledWith((globalThis as any).chrome, {
    tabId: 12,
    documentIds: ["doc-99"]
  });
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: [{ result: undefined }] });
});

test("background installs the page blob bridge in MAIN world on demand", async () => {
  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const result = listener?.(
    { type: "ENSURE_PAGE_BLOB_BRIDGE" },
    { tab: { id: 12 }, frameId: 4 },
    sendResponse
  );

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect((globalThis as any).chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
    target: { tabId: 12, frameIds: [4] },
    world: "MAIN",
    func: expect.any(Function)
  }));
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: undefined });
});

test("background installs the page twitter video resolver in MAIN world on demand", async () => {
  await import("../app/background/index");
  const { ensurePageTwitterVideoResolverInstalled } = await import("./page-twitter-video-resolver-install");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const result = listener?.(
    { type: "ENSURE_PAGE_TWITTER_VIDEO_RESOLVER" },
    { tab: { id: 12 }, frameId: 4 },
    sendResponse
  );

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ensurePageTwitterVideoResolverInstalled).toHaveBeenCalledWith((globalThis as any).chrome, {
    tabId: 12,
    frameIds: [4]
  });
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: undefined });
});

test("background prefers documentIds over frameIds when both are present on the sender", async () => {
  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const result = listener?.(
    { type: "ENSURE_PAGE_BLOB_BRIDGE" },
    { tab: { id: 12 }, frameId: 4, documentId: "doc-7" },
    sendResponse
  );

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect((globalThis as any).chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
    target: { tabId: 12, documentIds: ["doc-7"] },
    world: "MAIN",
    func: expect.any(Function)
  }));
  expect(sendResponse).toHaveBeenCalledWith({ ok: true, result: undefined });
});

test("background fails clearly when bridge installation lacks a sender tab", async () => {
  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  const sendResponse = vi.fn();
  const result = listener?.(
    { type: "ENSURE_PAGE_BLOB_BRIDGE" },
    { frameId: 4 },
    sendResponse
  );

  expect(result).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect((globalThis as any).chrome.scripting.executeScript).not.toHaveBeenCalled();
  expect(sendResponse).toHaveBeenCalledWith({
    ok: false,
    error: "Cannot install page blob bridge without a sender tab ID."
  });
});
