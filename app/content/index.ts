import { createSendHandler } from "../../src/content-send";
import type { SendHandler } from "../../src/content-send";
import { getErrorMessage } from "../../src/error-message";
import { extractPostData } from "../../src/post-extraction";
import { sendExtensionMessage } from "../../src/runtime-messaging";
import { parseTwitterPostRef } from "../../src/twitter-video-metadata-resolver";
import type { BackgroundMessage, GetPostedPostsResult, MessageResponse, TelegramSendPayload } from "../../src/shared";

const BUTTON_CLASS = "ttt-send-button";
const POST_SELECTOR = "article";
let sendHandler: SendHandler | null = null;

function bootstrap() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
    return;
  }

  initialize();
}

function initialize() {
  ensureStyles();
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (message && typeof message === "object" && "type" in message && message.type === "POST_POSTED"
      && "postId" in message && typeof message.postId === "string") {
      markPostPosted(message.postId);
    }
  });
  startObserver();
  scanPosts();
}

function ensureStyles() {
  if (document.getElementById("ttt-style")) return;
  const style = document.createElement("style");
  style.id = "ttt-style";
  style.textContent = `
    .${BUTTON_CLASS} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 9999px;
      background: transparent;
      color: rgb(83, 100, 113);
      cursor: pointer;
      line-height: 0;
      transition: background-color 0.15s ease, color 0.15s ease;
      overflow: hidden;
    }
    .${BUTTON_CLASS}:hover:not(:disabled) {
      background-color: rgba(29, 155, 240, 0.1);
      color: rgb(29, 155, 240);
    }
    .${BUTTON_CLASS}:disabled {
      opacity: 0.55;
      cursor: progress;
      transform: none;
    }
    .${BUTTON_CLASS}[data-state="sent"],
    .${BUTTON_CLASS}[data-state="unavailable"] {
      cursor: default;
    }
    .${BUTTON_CLASS}:focus-visible {
      outline: 2px solid rgb(29, 155, 240);
      outline-offset: 2px;
    }
  `;
  document.head.appendChild(style);
}

function startObserver() {
  if (typeof MutationObserver === "undefined") return;
  const observer = new MutationObserver((records) => {
    const articles = new Set<Element>();
    for (const record of records) {
      if (!(record.target instanceof Element) || record.target.closest(`.${BUTTON_CLASS}`)) continue;
      const added = record.addedNodes[0];
      if (!record.removedNodes.length && record.addedNodes.length === 1
        && added instanceof HTMLButtonElement && added.classList.contains(BUTTON_CLASS)) continue;
      const parent = record.target.closest(POST_SELECTOR);
      if (parent) articles.add(parent);
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(POST_SELECTOR)) articles.add(node);
        for (const article of node.querySelectorAll(POST_SELECTOR)) articles.add(article);
      }
    }
    if (articles.size) scanPosts(articles);
  });
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["href", "src"]
  });
}

function scanPosts(articles: Iterable<Element> = document.querySelectorAll(POST_SELECTOR)) {
  const buttons: HTMLButtonElement[] = [];
  for (const article of articles) {
    if (!article.isConnected) continue;
    let currentButton: HTMLButtonElement | undefined;
    for (const button of article.querySelectorAll<HTMLButtonElement>(`.${BUTTON_CLASS}`)) {
      if (button.closest(POST_SELECTOR) === article) {
        currentButton = button;
        break;
      }
    }
    const data = extractPostData(article);
    const postId = data && parseTwitterPostRef(data.postUrl)?.tweetId;
    if (postId && currentButton?.dataset.postId === postId) continue;
    currentButton?.remove();
    if (!data || !postId) continue;
    const footer = article.querySelector("[role='group']") || article;
    const button = buildButton(article, data, postId);
    footer.appendChild(button);
    buttons.push(button);
  }
  if (!buttons.length) return;

  void sendExtensionMessage<MessageResponse<GetPostedPostsResult>>({
    type: "GET_POSTED_POSTS",
    postIds: buttons.map((button) => button.dataset.postId!)
  } satisfies BackgroundMessage).then((response) => {
    if (!response.ok) throw new Error(response.error);
    const posted = new Set(response.result.postIds);
    for (const button of buttons) {
      if (button.dataset.state === "checking") {
        setButtonState(button, posted.has(button.dataset.postId!) ? "sent" : "ready");
      }
    }
  }).catch((error: unknown) => {
    console.error("[TTT] could not read posted history", error);
    for (const button of buttons) {
      if (button.dataset.state === "checking") setButtonState(button, "unavailable");
    }
  });
}

function buildButton(article: Element, data: TelegramSendPayload, postId: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.dataset.postId = postId;
  setButtonState(button, "checking");
  const send = sendHandler ?? (sendHandler = createSendHandler());

  button.addEventListener("click", async () => {
    if (button.dataset.state !== "ready") return;
    setButtonState(button, "sending");
    try {
      const payload = extractPostData(article) || data;
      button.dataset.postId = parseTwitterPostRef(payload.postUrl)?.tweetId || postId;
      const response = await send(payload);
      if (!response.ok) throw new Error(response.error || "Unknown error");
      markPostPosted(button.dataset.postId);
    } catch (error: unknown) {
      if (button.getAttribute("data-state") === "sent") return;
      console.error("[TTT] send failed", error);
      setButtonState(button, "failed");
      setTimeout(() => {
        if (button.dataset.state === "failed") setButtonState(button, "ready");
      }, 1800);
      alert(`TTT send failed: ${getErrorMessage(error)}`);
    }
  });

  if (isDebugEnabled()) console.debug("[TTT] classified post", data);
  return button;
}

function markPostPosted(postId: string) {
  for (const button of document.querySelectorAll<HTMLButtonElement>(`.${BUTTON_CLASS}`)) {
    if (button.dataset.postId === postId) setButtonState(button, "sent");
  }
}

type ButtonState = "checking" | "ready" | "sending" | "sent" | "failed" | "unavailable";

const BUTTON_LABELS: Record<ButtonState, string> = {
  checking: "Checking posted history…",
  ready: "Send to Telegram",
  sending: "Sending to Telegram…",
  sent: "Already posted to Telegram",
  failed: "Send failed",
  unavailable: "Cannot check posted history. Reload the page."
};

function setButtonState(button: HTMLButtonElement, state: ButtonState) {
  const sent = state === "sent";
  if (!button.firstElementChild || sent !== (button.dataset.state === "sent")) {
    // Lucide send and circle-check, ISC. License included in public/icons/LICENSE-lucide.txt.
    button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none"
      stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true" focusable="false">${sent
        ? '<circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/>'
        : '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>'}</svg>`;
  }
  button.dataset.state = state;
  button.disabled = state !== "ready";
  button.title = BUTTON_LABELS[state];
  button.setAttribute("aria-label", BUTTON_LABELS[state]);
}

function isDebugEnabled() {
  return typeof window !== "undefined" && window.localStorage.getItem("ttt-debug") === "1";
}

bootstrap();

