import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { sendExtensionMessage } from "./runtime-messaging";

const originalChrome = globalThis.chrome;
const originalBrowser = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser;

beforeEach(() => {
  (globalThis as typeof globalThis & { browser?: typeof chrome; chrome?: typeof chrome }).browser = undefined;
  (globalThis as typeof globalThis & { browser?: typeof chrome; chrome?: typeof chrome }).chrome = undefined;
});

afterEach(() => {
  (globalThis as typeof globalThis & { browser?: typeof chrome; chrome?: typeof chrome }).browser = originalBrowser;
  (globalThis as typeof globalThis & { browser?: typeof chrome; chrome?: typeof chrome }).chrome = originalChrome;
  vi.clearAllMocks();
});

test("sendExtensionMessage falls back to browser.runtime when chrome.runtime is missing", async () => {
  const browserSendMessage = vi.fn(async (message: { type: string }) => ({ ok: true, echoed: message.type }));

  (globalThis as typeof globalThis & { browser?: { runtime: { sendMessage: typeof browserSendMessage } } }).browser = {
    runtime: {
      sendMessage: browserSendMessage
    }
  };

  const response = await sendExtensionMessage({ type: "PING" });

  expect(browserSendMessage).toHaveBeenCalledWith({ type: "PING" });
  expect(response).toEqual({ ok: true, echoed: "PING" });
});

test("sendExtensionMessage throws a clear error when no messaging API is available", async () => {
  await expect(sendExtensionMessage({ type: "PING" })).rejects.toThrow(
    "Extension messaging API is unavailable in this context."
  );
});
