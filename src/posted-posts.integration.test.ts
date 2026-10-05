import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./shared";
import type { MessageResponse } from "./shared";

type Listener = (message: unknown, sender: unknown, respond: (response: MessageResponse) => void) => boolean;
let listener: Listener;
let installed: () => Promise<void>;
let stored: Record<string, unknown>;
let requests: { url: string; body: Record<string, unknown> }[];

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  stored = { ...DEFAULT_SETTINGS, botToken: "test-token", channelId: "@testchannel" };
  requests = [];
  vi.stubGlobal("chrome", {
    runtime: {
      onInstalled: { addListener: (callback: typeof installed) => { installed = callback; } },
      onMessage: { addListener: (callback: Listener) => { listener = callback; } },
      openOptionsPage: vi.fn()
    },
    action: { onClicked: { addListener: vi.fn() } },
    tabs: { query: async () => [], sendMessage: vi.fn() },
    storage: { local: {
      get: async () => ({ ...stored }),
      set: async (values: Record<string, unknown>) => { Object.assign(stored, values); },
      remove: async (key: string) => { delete stored[key]; }
    } }
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body: unknown = init.body instanceof FormData
      ? Object.fromEntries(init.body.entries())
      : JSON.parse(String(init.body));
    if (!body || typeof body !== "object") throw new Error("Expected a Telegram request body");
    requests.push({ url, body: Object.fromEntries(Object.entries(body)) });
    return Response.json({ ok: true, result: { message_id: requests.length } });
  });
  // Worker startup must happen after installing each test's isolated browser globals.
  await import("../app/background/index");
});

afterEach(() => vi.unstubAllGlobals());

function message(value: unknown): Promise<MessageResponse> {
  const { promise, resolve, reject } = Promise.withResolvers<MessageResponse>();
  if (!listener(value, { tab: { id: 1 } }, resolve)) reject(new Error("Background did not handle message"));
  return promise;
}

function photo(postUrl = "https://x.com/user/status/901") {
  return { type: "SEND_TO_TELEGRAM", payload: { kind: "photo", postUrl, mediaUrl: "https://pbs.twimg.com/media/photo.jpg" } };
}

async function history(...postIds: string[]) {
  return message({ type: "GET_POSTED_POSTS", postIds });
}

test("successful posts remain recorded after the service worker is recreated", async () => {
  expect((await message(photo())).ok).toBe(true);
  vi.resetModules();
  // Re-import intentionally exercises a restarted worker against the same database.
  await import("../app/background/index");
  expect(await history("901", "902")).toEqual({ ok: true, result: { postIds: ["901"] } });
});

test("failed Telegram sends remain retryable and are not recorded", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ ok: false, description: "Upload rejected" }));
  expect((await message(photo())).ok).toBe(false);
  expect(await history("901")).toEqual({ ok: true, result: { postIds: [] } });
});

test("the same post cannot be resent through a different X or Twitter URL", async () => {
  await message(photo());
  await message(photo("https://twitter.com/another_name/status/901?ref=feed"));
  expect(requests).toHaveLength(1);
});

test("photo routes send successfully and share posted history with the plain post URL", async () => {
  expect((await message(photo("https://x.com/user/status/901/photo/1"))).ok).toBe(true);
  expect(await history("901")).toEqual({ ok: true, result: { postIds: ["901"] } });
  expect((await message(photo())).ok).toBe(true);
  expect((await message(photo("https://twitter.com/user/status/901/photo/2"))).ok).toBe(true);
  expect(requests).toHaveLength(1);
});

test("concurrent send requests for the same post share one upload", async () => {
  await Promise.all([message(photo()), message(photo())]);
  expect(requests).toHaveLength(1);
  expect(await history("901")).toEqual({ ok: true, result: { postIds: ["901"] } });
});

test.each([
  { prefix: "Fresh <find> & save", link: true, want: "Fresh &lt;find&gt; &amp; save\nhttps://x.com/user/status/901" },
  { prefix: "Fresh <find> & save", link: false, want: "Fresh &lt;find&gt; &amp; save" },
  { prefix: "", link: true, want: "https://x.com/user/status/901" },
  { prefix: "", link: false, want: "" }
])("captions independently apply the editable prefix and original link: $prefix / $link", async ({ prefix, link, want }) => {
  stored.captionPrefix = prefix;
  stored.includePostLink = link;
  await message(photo());
  expect(requests[0].body.caption).toBe(want);
});

test.each([
  { legacy: false, prefix: undefined, want: "https://x.com/user/status/901" },
  { legacy: true, prefix: undefined, want: "New post\nhttps://x.com/user/status/901" },
  { legacy: false, prefix: "Custom", want: "Custom\nhttps://x.com/user/status/901" }
])("settings migration preserves caption preferences: $legacy / $prefix", async ({ legacy, prefix, want }) => {
  stored = { botToken: "test-token", channelId: "@testchannel", autoPrefix: legacy, ...(prefix === undefined ? {} : { captionPrefix: prefix }) };
  await installed();
  await message(photo());
  expect(requests[0].body.caption).toBe(want);
});

test("an already accepted post stays successful if notifying open tabs fails", async () => {
  vi.spyOn(chrome.tabs, "query").mockRejectedValueOnce(new Error("Tabs unavailable"));
  expect((await message(photo())).ok).toBe(true);
  expect(await history("901")).toEqual({ ok: true, result: { postIds: ["901"] } });
});

test("an album is recorded only after every media group succeeds", async () => {
  let groups = 0;
  vi.stubGlobal("fetch", async () => Response.json(++groups === 1
    ? { ok: true, result: [{ message_id: 1 }] }
    : { ok: false, description: "Second group rejected" }));
  const response = await message({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "photo-album", postUrl: "https://x.com/user/status/901",
      mediaUrls: Array.from({ length: 12 }, (_, i) => `https://pbs.twimg.com/media/${i}.jpg`)
    }
  });
  expect(response.ok).toBe(false);
  expect(groups).toBe(2);
  expect(await history("901")).toEqual({ ok: true, result: { postIds: [] } });
});

test("albums apply caption preferences and become inactive after a successful upload", async () => {
  stored.captionPrefix = "Saved & shared";
  stored.includePostLink = false;
  expect((await message({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "photo-album", postUrl: "https://x.com/user/status/901",
      mediaUrls: ["https://pbs.twimg.com/media/1.jpg", "https://pbs.twimg.com/media/2.jpg"]
    }
  })).ok).toBe(true);
  expect(requests[0].body.media).toEqual([
    { type: "photo", media: "https://pbs.twimg.com/media/1.jpg", caption: "Saved &amp; shared", parse_mode: "HTML" },
    { type: "photo", media: "https://pbs.twimg.com/media/2.jpg" }
  ]);
  expect(await history("901")).toEqual({ ok: true, result: { postIds: ["901"] } });
});

test("video uploads use escaped custom captions and are remembered", async () => {
  stored.captionPrefix = "Video <clip>";
  stored.includePostLink = false;
  expect((await message({
    type: "SEND_TO_TELEGRAM",
    payload: {
      kind: "video", postUrl: "https://x.com/user/status/901",
      videoBlobBytes: [0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 2, 0, 105, 115, 111, 109, 105, 115, 111, 50],
      videoMimeType: "video/mp4"
    }
  })).ok).toBe(true);
  expect(requests[0].body.caption).toBe("Video &lt;clip&gt;");
  expect(requests[0].body.parse_mode).toBe("HTML");
  expect(await history("901")).toEqual({ ok: true, result: { postIds: ["901"] } });
});
