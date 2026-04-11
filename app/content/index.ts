import type { BackgroundMessage, MessageResponse, TelegramSendPayload } from "../../src/shared";
import { extractPostData } from "../../src/post-extraction";

ensureStyles();
startObserver();
scanPosts();

const BUTTON_CLASS = "ttt-send-button";
const PROCESSED_ATTR = "data-ttt-processed";
const POST_SELECTOR = "article";
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
    .${BUTTON_CLASS}:hover {
      background-color: rgba(29, 155, 240, 0.1);
      color: rgb(29, 155, 240);
    }
    .${BUTTON_CLASS}:disabled {
      opacity: 0.55;
      cursor: progress;
      transform: none;
    }
  `;
  document.head.appendChild(style);
}

function startObserver() {
  if (typeof MutationObserver === "undefined") return;
  const observer = new MutationObserver(() => scanPosts());
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function scanPosts() {
  document.querySelectorAll(POST_SELECTOR).forEach((article) => {
    if (article.hasAttribute(PROCESSED_ATTR)) return;
    const data = extractPostData(article);
    if (!data) return;
    article.setAttribute(PROCESSED_ATTR, "true");
    const footer = article.querySelector("[role='group']") || article;
    footer.appendChild(buildButton(data));
  });
}

function buildButton(data: TelegramSendPayload) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.title = data.kind === "video"
    ? "Download the video and send it to Telegram"
    : data.kind === "photo-album"
      ? "Send the images and post link to Telegram"
      : "Send the image and post link to Telegram";

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "18.75");
  icon.setAttribute("height", "18.75");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  icon.style.display = "block";

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    data.kind === "video"
      ? "M3.5 11.3 19.9 4.6c.7-.3 1.4.4 1.1 1.1l-5.7 16.4c-.2.7-1.2.9-1.7.4l-4.1-4.1-3.7 3.3c-.4.3-1 .2-1.2-.3l-1.4-4.6c-.1-.5.1-1 .5-1.2l5.6-2.7c.3-.2.4-.6.2-.8-.2-.3-.6-.4-.9-.3l-5.4 1.7c-.8.2-1.4-.6-1-1.3Z"
      : "M3.4 11.8 19.6 4.5c.7-.3 1.4.4 1.1 1.1l-5.4 15.9c-.2.7-1.2.9-1.7.4l-3.9-3.9-4.1 2.9c-.5.4-1.2.1-1.3-.5l-.9-3.8c-.1-.5.1-1 .6-1.2l4.8-2.2c.4-.2.5-.7.2-1-.2-.3-.6-.4-.9-.3l-4.4 1.1c-.8.2-1.4-.7-.9-1.3Z"
  );
  path.setAttribute("fill", "currentColor");
  icon.appendChild(path);

  const status = document.createElement("span");
  status.textContent = data.kind === "video" ? "Download video" : data.kind === "photo-album" ? "Send images" : "Send image";
  status.style.cssText = `
    position:absolute;
    width:1px;
    height:1px;
    padding:0;
    margin:-1px;
    overflow:hidden;
    clip:rect(0, 0, 0, 0);
    white-space:nowrap;
    border:0;
  `;

  button.append(icon, status);

  button.addEventListener("click", async () => {
    button.disabled = true;
    const originalStatus = status.textContent;
    status.textContent = data.kind === "video" ? "Downloading…" : "Sending…";
    try {
      const response = await chrome.runtime.sendMessage<BackgroundMessage, MessageResponse>({
        type: "SEND_TO_TELEGRAM",
        payload: data
      });
      if (!response?.ok) throw new Error("error" in response ? response.error || "Unknown error" : "Unknown error");
      status.textContent = "Sent";
      setTimeout(() => {
        status.textContent = originalStatus;
        button.disabled = false;
      }, 1300);
    } catch (error: unknown) {
      console.error("[TTT] send failed", error);
      status.textContent = "Failed";
      setTimeout(() => {
        status.textContent = originalStatus;
        button.disabled = false;
      }, 1800);
      alert(`TTT send failed: ${getErrorMessage(error)}`);
    }
  });

  if (isDebugEnabled()) {
    console.debug("[TTT] classified post", data);
  }

  return button;
}

function isDebugEnabled() {
  return typeof window !== "undefined" && window.localStorage.getItem("ttt-debug") === "1";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
