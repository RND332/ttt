import {
  TTT_PAGE_BLOB_REQUEST,
  TTT_PAGE_BLOB_RESPONSE
} from "./page-blob-video-bridge";
import { getErrorMessage } from "./error-message";

type ChromeScriptingApi = {
  executeScript: (injection: {
    target: {
      tabId: number;
      frameIds?: number[];
      documentIds?: string[];
    };
    world: "MAIN";
    func: (requestType: string, responseType: string) => void;
    args: [string, string];
  }) => Promise<unknown> | unknown;
};

type ChromeWithScripting = {
  scripting?: ChromeScriptingApi;
};

type BridgeTarget = {
  tabId: number;
  frameIds?: number[];
  documentIds?: string[];
};

function getBlobBridgeErrorMessage(error: unknown) {
  if (error instanceof TypeError && error.message === "Failed to fetch") {
    return "This X video appears to be stream-backed (likely MediaSource/HLS), so the browser cannot fetch it directly yet.";
  }

  return getErrorMessage(error);
}

export async function ensurePageBlobBridgeInstalled(chromeApi: ChromeWithScripting, target: BridgeTarget) {
  if (!chromeApi.scripting?.executeScript) {
    throw new Error("chrome.scripting.executeScript is unavailable.");
  }

  return await chromeApi.scripting.executeScript({
    target,
    world: "MAIN",
    func: (requestType: string, responseType: string) => {
      const targetWindow = window as Window & { __tttPageBlobBridgeInstalled?: boolean };
      if (targetWindow.__tttPageBlobBridgeInstalled) return;
      targetWindow.__tttPageBlobBridgeInstalled = true;

      targetWindow.addEventListener("message", async (event: Event) => {
        const message = event as MessageEvent<{ type?: string; requestId?: string; blobUrl?: string }>;
        if (message.source !== targetWindow) return;
        if (message.data?.type !== requestType) return;

        try {
          const response = await fetch(String(message.data.blobUrl || ""));
          if (!response.ok) {
            throw new Error(`Failed to read in-page video blob: ${response.status}`);
          }

          const blob = await response.blob();
          const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
          targetWindow.postMessage({
            type: responseType,
            requestId: message.data.requestId,
            ok: true,
            bytes,
            mimeType: blob.type || "video/mp4"
          }, "*");
        } catch (error: unknown) {
          targetWindow.postMessage({
            type: responseType,
            requestId: message.data.requestId,
            ok: false,
            error: getBlobBridgeErrorMessage(error)
          }, "*");
        }
      });
    },
    args: [TTT_PAGE_BLOB_REQUEST, TTT_PAGE_BLOB_RESPONSE]
  });
}

export function installMainWorldBlobBridge(targetWindow: Window & { __tttPageBlobBridgeInstalled?: boolean }) {
  if (targetWindow.__tttPageBlobBridgeInstalled) return;
  targetWindow.__tttPageBlobBridgeInstalled = true;

  targetWindow.addEventListener("message", async (event: Event) => {
    const message = event as MessageEvent<{ type?: string; requestId?: string; blobUrl?: string }>;
    if (message.source !== targetWindow) return;
    if (message.data?.type !== TTT_PAGE_BLOB_REQUEST) return;

    try {
      const response = await fetch(String(message.data.blobUrl || ""));
      if (!response.ok) {
        throw new Error(`Failed to read in-page video blob: ${response.status}`);
      }

      const blob = await response.blob();
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      targetWindow.postMessage({
        type: TTT_PAGE_BLOB_RESPONSE,
        requestId: message.data.requestId,
        ok: true,
        bytes,
        mimeType: blob.type || "video/mp4"
      }, "*");
    } catch (error: unknown) {
      targetWindow.postMessage({
        type: TTT_PAGE_BLOB_RESPONSE,
        requestId: message.data.requestId,
        ok: false,
        error: getBlobBridgeErrorMessage(error)
      }, "*");
    }
  });
}
