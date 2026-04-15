// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const sendMock = vi.fn(async () => ({ ok: true, result: {} }));
const sendHandler = sendMock;
const createSendHandler = vi.fn(() => sendHandler);
const extractPostData = vi.fn(() => null);

vi.mock("../src/content-send", () => ({
  createSendHandler
}));

vi.mock("../src/post-extraction", () => ({
  extractPostData
}));

const originalChrome = globalThis.chrome;
const originalMutationObserver = globalThis.MutationObserver;

beforeEach(() => {
  vi.resetModules();
  document.head.innerHTML = "";
  document.body.innerHTML = "<main></main>";
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete"
  });
  vi.stubGlobal("MutationObserver", class {
    observe() {}
    disconnect() {}
  } as any);
  (globalThis as any).chrome = {
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://abc/${path}`)
    }
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    }
  });
  sendMock.mockClear();
  sendMock.mockResolvedValue({ ok: true, result: {} });
  createSendHandler.mockClear();
  createSendHandler.mockImplementation(() => sendHandler);
  extractPostData.mockClear();
  extractPostData.mockReturnValue(null);
});

afterEach(() => {
  vi.resetModules();
  (globalThis as any).chrome = originalChrome;
  (globalThis as any).MutationObserver = originalMutationObserver;
});

test("content bootstrap no longer injects a chrome-extension script tag for the blob bridge or depend on settings loading", async () => {
  await import("../app/content/index");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(document.querySelector('script[src^="chrome-extension://"]')).toBeNull();
  expect(createSendHandler).toHaveBeenCalledTimes(0);
});

test("content reuses one send handler across multiple injected post buttons", async () => {
  document.body.innerHTML = `
    <article>
      <a href="/user/status/101">main</a>
      <div role="group"></div>
    </article>
    <article>
      <a href="/user/status/102">main</a>
      <div role="group"></div>
    </article>
  `;

  extractPostData
    .mockReturnValueOnce({
      kind: "photo",
      mediaUrl: "https://pbs.twimg.com/media/101.jpg",
      postUrl: "https://x.com/user/status/101"
    })
    .mockReturnValueOnce({
      kind: "photo",
      mediaUrl: "https://pbs.twimg.com/media/102.jpg",
      postUrl: "https://x.com/user/status/102"
    });

  await import("../app/content/index");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(document.querySelectorAll("button.ttt-send-button")).toHaveLength(2);
  expect(createSendHandler).toHaveBeenCalledTimes(1);
});

test("content click re-extracts video payload so late blob sources are used instead of stale empty video payloads", async () => {
  document.body.innerHTML = `
    <article>
      <a href="/user/status/2043434125407948800">main</a>
      <div role="group"></div>
    </article>
  `;

  extractPostData
    .mockReturnValueOnce({
      kind: "video",
      postUrl: "https://x.com/user/status/2043434125407948800"
    })
    .mockReturnValueOnce({
      kind: "video",
      postUrl: "https://x.com/user/status/2043434125407948800",
      blobUrl: "blob:https://x.com/87e0712a-56b4-4b7b-8f21-7aefdcdc5cb6"
    });

  await import("../app/content/index");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const button = document.querySelector("button.ttt-send-button") as HTMLButtonElement | null;
  expect(button).toBeTruthy();

  button?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(extractPostData).toHaveBeenCalledTimes(2);
  expect(createSendHandler).toHaveBeenCalledTimes(1);
  expect(sendMock).toHaveBeenCalledWith({
    kind: "video",
    postUrl: "https://x.com/user/status/2043434125407948800",
    blobUrl: "blob:https://x.com/87e0712a-56b4-4b7b-8f21-7aefdcdc5cb6"
  });
});

test("content click forwards unresolved video posts to the centralized send handler without pre-recovery", async () => {
  document.body.innerHTML = `
    <article>
      <a href="/user/status/777">main</a>
      <div role="group"></div>
    </article>
  `;

  extractPostData.mockReturnValue({
    kind: "video",
    postUrl: "https://x.com/user/status/777"
  });

  await import("../app/content/index");
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(createSendHandler).toHaveBeenCalledTimes(1);
  const button = document.querySelector("button.ttt-send-button") as HTMLButtonElement | null;
  expect(button).toBeTruthy();

  button?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(createSendHandler).toHaveBeenCalledTimes(1);
  expect(sendMock).toHaveBeenCalledWith({
    kind: "video",
    postUrl: "https://x.com/user/status/777"
  });
});
