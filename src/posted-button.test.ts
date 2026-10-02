// @vitest-environment jsdom

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GetPostedPostsResult, MessageResponse, PostPostedMessage } from "./shared";
import { loadMockHtml } from "./test/fixtures";

const FIRST_POST_ID = "2043233348085227734";
const NativeMutationObserver = window.MutationObserver;
const liveObservers = new Set<MutationObserver>();

let postedIds: string[];
let sends: number;
let failSend: boolean;
let receive: (message: PostPostedMessage) => void;

beforeEach(async () => {
  vi.resetModules();
  document.head.innerHTML = "";
  document.body.innerHTML = await loadMockHtml("mocks/twitter/followed-scroll.html");
  Object.defineProperty(document, "readyState", { configurable: true, value: "complete" });
  Object.defineProperty(window, "localStorage", { configurable: true, value: { getItem: () => null } });
  postedIds = [];
  sends = 0;
  failSend = false;
  vi.stubGlobal("MutationObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("chrome", { runtime: {
    onMessage: { addListener: (callback: typeof receive) => { receive = callback; } },
    sendMessage: async (message: { type: string }): Promise<MessageResponse<GetPostedPostsResult | { message_id: number }>> => {
      if (message.type === "GET_POSTED_POSTS") return { ok: true, result: { postIds: postedIds } };
      if (message.type === "SEND_TO_TELEGRAM") {
        sends++;
        return failSend ? { ok: false, error: "Upload failed" } : { ok: true, result: { message_id: 1 } };
      }
      throw new Error(`Unexpected request ${message.type}`);
    }
  } });
});

afterEach(() => {
  for (const observer of liveObservers) observer.disconnect();
  liveObservers.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function startContent() {
  // The startup import must observe each test's fresh document and Chrome runtime.
  await import("../app/content/index");
  await vi.waitFor(() => expect(document.querySelectorAll("button.ttt-send-button")).toHaveLength(3));
}

function installNativeObserver() {
  vi.stubGlobal("MutationObserver", class extends NativeMutationObserver {
    constructor(callback: MutationCallback) {
      super(callback);
      liveObservers.add(this);
    }
  });
}

function button(index = 0) {
  const element = document.querySelectorAll<HTMLButtonElement>("button.ttt-send-button")[index];
  if (!element) throw new Error("Expected a post button");
  return element;
}

test("previously posted items are disabled while unposted items can still be sent", async () => {
  postedIds = [FIRST_POST_ID];
  await startContent();
  await vi.waitFor(() => expect(button(0).disabled).toBe(true));
  await vi.waitFor(() => expect(button(1).disabled).toBe(false));
  button(0).click();
  button(1).click();
  await vi.waitFor(() => expect(sends).toBe(1));
});

test("a successful send remains inactive beyond the old temporary success timeout", async () => {
  await startContent();
  await vi.waitFor(() => expect(button().disabled).toBe(false));
  vi.useFakeTimers();
  button().click();
  await vi.advanceTimersByTimeAsync(2000);
  expect(button().disabled).toBe(true);
  button().click();
  expect(sends).toBe(1);
});

test("a failed send can be retried instead of being marked posted", async () => {
  await startContent();
  await vi.waitFor(() => expect(button().disabled).toBe(false));
  failSend = true;
  vi.useFakeTimers();
  button().click();
  await vi.advanceTimersByTimeAsync(2000);
  expect(button().disabled).toBe(false);
  failSend = false;
  button().click();
  await vi.advanceTimersByTimeAsync(2000);
  expect(sends).toBe(2);
  expect(button().disabled).toBe(true);
});

test("a post sent in another tab becomes inactive without reloading the feed", async () => {
  await startContent();
  await vi.waitFor(() => expect(button().disabled).toBe(false));
  receive({ type: "POST_POSTED", postId: FIRST_POST_ID });
  expect(button().disabled).toBe(true);
  expect(button(1).disabled).toBe(false);
});

test("a peer's success wins over a late local failure", async () => {
  const pending = Promise.withResolvers<MessageResponse>();
  vi.spyOn(chrome.runtime, "sendMessage").mockImplementation(async (message: { type: string }) => {
    if (message.type === "GET_POSTED_POSTS") return { ok: true, result: { postIds: [] } };
    return pending.promise;
  });
  await startContent();
  await vi.waitFor(() => expect(button().disabled).toBe(false));
  vi.useFakeTimers();
  button().click();
  receive({ type: "POST_POSTED", postId: FIRST_POST_ID });
  pending.resolve({ ok: false, error: "Local preparation failed" });
  await vi.advanceTimersByTimeAsync(2000);
  expect(button().disabled).toBe(true);
  expect(globalThis.alert).not.toHaveBeenCalled();
});

test("a stale initial history response cannot undo a peer's posted state", async () => {
  const pending = Promise.withResolvers<MessageResponse<GetPostedPostsResult>>();
  vi.spyOn(chrome.runtime, "sendMessage").mockImplementation(() => pending.promise);
  await startContent();
  vi.useFakeTimers();
  receive({ type: "POST_POSTED", postId: FIRST_POST_ID });
  pending.resolve({ ok: true, result: { postIds: [] } });
  await vi.advanceTimersByTimeAsync(0);
  expect(button().dataset.state).toBe("sent");
  expect(button().disabled).toBe(true);
  expect(button(1).disabled).toBe(false);
});

test("a recycled sent post becomes sendable when its DOM now represents an unposted item", async () => {
  installNativeObserver();
  postedIds = [FIRST_POST_ID];
  await startContent();
  await vi.waitFor(() => expect(button().disabled).toBe(true));
  const article = document.querySelector("article")!;
  article.querySelector("a")!.setAttribute("href", "/user/status/903");
  article.querySelector("img")!.setAttribute("src", "https://pbs.twimg.com/media/903.jpg");
  await vi.waitFor(() => expect(button().disabled).toBe(false));
  button().click();
  await vi.waitFor(() => expect(sends).toBe(1));
});

test("a sent post keeps its inactive action when the feed rebuilds its footer", async () => {
  installNativeObserver();
  postedIds = [FIRST_POST_ID];
  await startContent();
  await vi.waitFor(() => expect(button().disabled).toBe(true));
  button().remove();
  await vi.waitFor(() => expect(button().disabled).toBe(true));
});

test("newly appended posts get usable actions after the initial feed scan", async () => {
  installNativeObserver();
  await startContent();
  const fresh = new DOMParser().parseFromString(
    await loadMockHtml("mocks/twitter/followed-scroll.html"), "text/html"
  ).querySelector("article")!;
  fresh.querySelector("a")!.setAttribute("href", "/user/status/903");
  document.querySelector("main")!.appendChild(fresh);
  await vi.waitFor(() => expect(fresh.querySelector<HTMLButtonElement>(".ttt-send-button")?.disabled).toBe(false));
  fresh.querySelector<HTMLButtonElement>(".ttt-send-button")!.click();
  await vi.waitFor(() => expect(sends).toBe(1));
});
