import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { loadSettings } from "./content-send";
import { DEFAULT_SETTINGS } from "./shared";

const originalChrome = globalThis.chrome;
const originalBrowser = (globalThis as any).browser;

beforeEach(() => {
  (globalThis as any).chrome = undefined;
  (globalThis as any).browser = undefined;
});

afterEach(() => {
  (globalThis as any).chrome = originalChrome;
  (globalThis as any).browser = originalBrowser;
  vi.clearAllMocks();
});

test("loadSettings reads from chrome.storage.local when available", async () => {
  const get = vi.fn(async () => ({ ...DEFAULT_SETTINGS, botToken: "abc" }));
  (globalThis as any).chrome = { storage: { local: { get } } };

  await expect(loadSettings()).resolves.toMatchObject({ botToken: "abc" });
  expect(get).toHaveBeenCalledWith(DEFAULT_SETTINGS);
});

test("loadSettings falls back to browser.storage.local when chrome.storage is unavailable", async () => {
  const get = vi.fn(async () => ({ ...DEFAULT_SETTINGS, channelId: "channel" }));
  (globalThis as any).browser = { storage: { local: { get } } };

  await expect(loadSettings()).resolves.toMatchObject({ channelId: "channel" });
  expect(get).toHaveBeenCalledWith(DEFAULT_SETTINGS);
});

test("loadSettings throws a clear error when no storage API is available", async () => {
  await expect(loadSettings()).rejects.toThrow("Extension storage API is unavailable in this context.");
});
