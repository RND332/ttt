// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  TTT_PAGE_BLOB_REQUEST,
  TTT_PAGE_BLOB_RESPONSE
} from "./page-blob-video-bridge";
import {
  TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST,
  TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE
} from "./page-stream-video-discovery";

const extractPostData = vi.fn();

vi.mock("./post-extraction", () => ({
  extractPostData
}));

const originalChrome = globalThis.chrome;
const originalMutationObserver = globalThis.MutationObserver;
const originalAlert = globalThis.alert;
const originalPostMessage = window.postMessage;

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
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    }
  });
  vi.stubGlobal("alert", vi.fn());
  extractPostData.mockReset();
});

afterEach(() => {
  (globalThis as any).chrome = originalChrome;
  (globalThis as any).MutationObserver = originalMutationObserver;
  globalThis.alert = originalAlert;
  window.postMessage = originalPostMessage;
  vi.restoreAllMocks();
});

function installChromeRuntime() {
  const storedCandidates = new Map<string, unknown[]>();
  const messages: any[] = [];

  const sendMessage = vi.fn(async (message: any) => {
    messages.push(message);

    if (message.type === "ENSURE_PAGE_STREAM_VIDEO_DISCOVERY") {
      return { ok: true, result: undefined };
    }

    if (message.type === "REPORT_RECOVERED_VIDEO_CANDIDATES") {
      storedCandidates.set(message.postUrl, message.candidates);
      return { ok: true, result: { stored: message.candidates.length } };
    }

    if (message.type === "GET_RECOVERED_VIDEO_CANDIDATES") {
      return {
        ok: true,
        result: {
          candidates: storedCandidates.get(message.postUrl) || []
        }
      };
    }

    if (message.type === "ENSURE_PAGE_BLOB_BRIDGE") {
      return { ok: true, result: undefined };
    }

    if (message.type === "SEND_TO_TELEGRAM") {
      return { ok: true, result: { message_id: 1 } };
    }

    throw new Error(`unexpected message ${message.type}`);
  });

  (globalThis as any).chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({
          botToken: "token",
          channelId: "channel",
          autoPrefix: true
        })),
        set: vi.fn(async () => undefined)
      }
    },
    runtime: {
      sendMessage
    }
  };

  return { messages, sendMessage };
}

function installPageMessageRuntime(options: {
  discoveryCandidates: unknown[];
  blobError?: string;
}) {
  const postMessageMock = vi.fn((message: unknown) => {
    const data = message as { type?: string; requestId?: string };

    if (data.type === TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST) {
      window.dispatchEvent(new MessageEvent("message", {
        source: window,
        data: {
          type: TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE,
          requestId: data.requestId,
          ok: true,
          candidates: options.discoveryCandidates
        }
      }));
      return;
    }

    if (data.type === TTT_PAGE_BLOB_REQUEST) {
      window.dispatchEvent(new MessageEvent("message", {
        source: window,
        data: {
          type: TTT_PAGE_BLOB_RESPONSE,
          requestId: data.requestId,
          ok: false,
          error: options.blobError || "This X video appears to be stream-backed (likely MediaSource/HLS), so the browser cannot fetch it directly yet."
        }
      }));
    }
  });

  window.postMessage = postMessageMock as typeof window.postMessage;
  return postMessageMock;
}

async function flushTasks(rounds = 3) {
  for (let index = 0; index < rounds; index++) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test("content integration does not report page-global recovered candidates before sending unresolved video posts", async () => {
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

  const { messages } = installChromeRuntime();
  installPageMessageRuntime({
    discoveryCandidates: []
  });

  await import("../app/content/index");
  await flushTasks();

  const button = document.querySelector("button.ttt-send-button") as HTMLButtonElement | null;
  expect(button).toBeTruthy();

  button?.click();
  await flushTasks();

  const sendCall = messages.find((message) => message.type === "SEND_TO_TELEGRAM");

  expect(sendCall).toEqual({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/777"
    }
  });
  expect(messages.find((message) => message.type === "REPORT_RECOVERED_VIDEO_CANDIDATES")).toBeUndefined();
  expect(messages.find((message) => message.type === "ENSURE_PAGE_STREAM_VIDEO_DISCOVERY")).toBeUndefined();
  expect(globalThis.alert).not.toHaveBeenCalled();
});

test("content integration sends an extracted playlistUrl directly to background when a post exposes only HLS in the DOM", async () => {
  document.body.innerHTML = `
    <article>
      <a href="/user/status/3001">main</a>
      <div role="group"></div>
    </article>
  `;

  extractPostData.mockReturnValue({
    kind: "video",
    postUrl: "https://x.com/user/status/3001",
    playlistUrl: "https://video.twimg.com/ext_tw_video/3001/master.m3u8"
  });

  const { messages } = installChromeRuntime();
  installPageMessageRuntime({
    discoveryCandidates: []
  });

  await import("../app/content/index");
  await flushTasks();

  const button = document.querySelector("button.ttt-send-button") as HTMLButtonElement | null;
  expect(button).toBeTruthy();

  button?.click();
  await flushTasks();

  expect(messages.find((message) => message.type === "REPORT_RECOVERED_VIDEO_CANDIDATES")).toBeUndefined();
  expect(messages.find((message) => message.type === "SEND_TO_TELEGRAM")).toEqual({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/3001",
      playlistUrl: "https://video.twimg.com/ext_tw_video/3001/master.m3u8"
    }
  });
  expect(globalThis.alert).not.toHaveBeenCalled();
});

test("content integration forwards a stream-backed blob payload to background when it has no trustworthy stored recovery", async () => {
  document.body.innerHTML = `
    <article>
      <a href="/user/status/2043">main</a>
      <div role="group"></div>
    </article>
  `;


  extractPostData.mockReturnValue({
    kind: "video",
    postUrl: "https://x.com/user/status/2043",
    blobUrl: "blob:https://x.com/stream-backed"
  });

  const { messages } = installChromeRuntime();
  const postMessageMock = installPageMessageRuntime({
    discoveryCandidates: [],
    blobError: "This X video appears to be stream-backed (likely MediaSource/HLS), so the browser cannot fetch it directly yet."
  });

  await import("../app/content/index");
  await flushTasks();

  const button = document.querySelector("button.ttt-send-button") as HTMLButtonElement | null;
  expect(button).toBeTruthy();

  button?.click();
  await flushTasks(4);

  const sendCall = messages.find((message) => message.type === "SEND_TO_TELEGRAM");

  expect(messages).toContainEqual({ type: "ENSURE_PAGE_BLOB_BRIDGE" });
  expect(postMessageMock.mock.calls.some(([message]) => (message as { type?: string }).type === TTT_PAGE_BLOB_REQUEST)).toBe(true);
  expect(postMessageMock.mock.calls.some(([message]) => (message as { type?: string }).type === TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST)).toBe(false);
  expect(sendCall).toEqual({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/2043",
      blobUrl: "blob:https://x.com/stream-backed"
    }
  });
  expect((sendCall as { payload: Record<string, unknown> }).payload).not.toHaveProperty("videoBlobBytes");
  expect(messages.findIndex((message) => message.type === "ENSURE_PAGE_BLOB_BRIDGE")).toBeLessThan(
    messages.findIndex((message) => message.type === "SEND_TO_TELEGRAM")
  );
  expect(messages.find((message) => message.type === "REPORT_RECOVERED_VIDEO_CANDIDATES")).toBeUndefined();
  expect(globalThis.alert).not.toHaveBeenCalled();
});

test("content integration alerts the explicit background ambiguity error when no trustworthy video candidate can be recovered", async () => {
  document.body.innerHTML = `
    <article>
      <a href="/user/status/999">main</a>
      <div role="group"></div>
    </article>
  `;

  extractPostData.mockReturnValue({
    kind: "video",
    postUrl: "https://x.com/user/status/999"
  });

  const { messages } = installChromeRuntime();
  installPageMessageRuntime({
    discoveryCandidates: []
  });
  const consoleErrorMock = vi.spyOn(console, "error").mockImplementation(() => undefined);

  const sendMessage = (globalThis as any).chrome.runtime.sendMessage;
  sendMessage.mockImplementation(async (message: any) => {
    messages.push(message);

    if (message.type === "GET_RECOVERED_VIDEO_CANDIDATES") {
      return {
        ok: true,
        result: {
          candidates: []
        }
      };
    }

    if (message.type === "SEND_TO_TELEGRAM") {
      return {
        ok: false,
        error: "Could not find a trustworthy downloadable video URL for this post. To avoid sending the wrong video, TTT stopped instead."
      };
    }

    throw new Error(`unexpected message ${message.type}`);
  });

  await import("../app/content/index");
  await flushTasks();

  const button = document.querySelector("button.ttt-send-button") as HTMLButtonElement | null;
  expect(button).toBeTruthy();

  button?.click();
  await flushTasks(4);

  expect(messages.find((message) => message.type === "REPORT_RECOVERED_VIDEO_CANDIDATES")).toBeUndefined();
  expect(messages.find((message) => message.type === "SEND_TO_TELEGRAM")).toEqual({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video",
      postUrl: "https://x.com/user/status/999"
    }
  });
  expect(messages.filter((message) => message.type === "ENSURE_PAGE_STREAM_VIDEO_DISCOVERY")).toHaveLength(0);
  expect(globalThis.alert).toHaveBeenCalledWith(
    "TTT send failed: Could not find a trustworthy downloadable video URL for this post. To avoid sending the wrong video, TTT stopped instead."
  );
  expect(consoleErrorMock).toHaveBeenCalledOnce();
});
