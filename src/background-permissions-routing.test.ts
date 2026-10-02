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

