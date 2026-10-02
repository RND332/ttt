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
      getURL: vi.fn((path: string) => `chrome-extension://abc/${path}`),
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn(async () => ({ ok: true, result: { postIds: [] } }))
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

  expect(sendMock).toHaveBeenCalledWith({
    kind: "video",
    postUrl: "https://x.com/user/status/2043434125407948800",
    blobUrl: "blob:https://x.com/87e0712a-56b4-4b7b-8f21-7aefdcdc5cb6"
  });
});

