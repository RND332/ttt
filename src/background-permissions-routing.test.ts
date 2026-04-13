import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./shared";

beforeEach(() => {
  vi.resetModules();
  (globalThis as any).__tttBackgroundListener = undefined;
  (globalThis as any).__tttActionClickListener = undefined;
  (globalThis as any).__tttInstalledListener = undefined;
  (globalThis as any).chrome = {
    runtime: {
      onInstalled: { addListener: vi.fn((listener: unknown) => { (globalThis as any).__tttInstalledListener = listener; }) },
      onMessage: { addListener: vi.fn((listener: unknown) => { (globalThis as any).__tttBackgroundListener = listener; }) },
      openOptionsPage: vi.fn()
    },
    action: {
      onClicked: { addListener: vi.fn((listener: unknown) => { (globalThis as any).__tttActionClickListener = listener; }) }
    },
    storage: {
      local: {
        get: vi.fn(async () => DEFAULT_SETTINGS),
        set: vi.fn(async () => undefined)
      }
    }
  };
});

afterEach(() => {
  vi.clearAllMocks();
  (globalThis as any).__tttBackgroundListener = undefined;
  (globalThis as any).__tttActionClickListener = undefined;
  (globalThis as any).__tttInstalledListener = undefined;
  (globalThis as any).chrome = undefined;
});

test("background ignores unsupported message types", async () => {
  await import("../app/background/index");

  const listener = (globalThis as any).__tttBackgroundListener as
    | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown)
    | undefined;

  expect(listener).toBeTypeOf("function");

  const sendResponse = vi.fn();
  const result = listener?.(
    {
      type: "UNSUPPORTED_MESSAGE",
      payload: { anything: true }
    },
    {},
    sendResponse
  );

  expect(result).toBe(false);
  expect(sendResponse).not.toHaveBeenCalled();
});

test("background registers an action click handler that opens the options page", async () => {
  await import("../app/background/index");

  const clickListener = (globalThis as any).__tttActionClickListener as (() => void) | undefined;

  expect(clickListener).toBeTypeOf("function");

  clickListener?.();

  expect((globalThis as any).chrome.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
});

test("background seeds stored settings with defaults during install bootstrap", async () => {
  const storedSettings = {
    autoPrefix: false,
    botToken: "bot-token",
    channelId: "@channel"
  };
  (globalThis as any).chrome.storage.local.get.mockResolvedValueOnce(storedSettings);

  await import("../app/background/index");

  const installedListener = (globalThis as any).__tttInstalledListener as (() => Promise<void>) | undefined;

  expect(installedListener).toBeTypeOf("function");

  await installedListener?.();

  expect((globalThis as any).chrome.storage.local.get).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  expect((globalThis as any).chrome.storage.local.set).toHaveBeenCalledWith({
    ...DEFAULT_SETTINGS,
    ...storedSettings
  });
});
