import { getErrorMessage } from "./error-message";

function getBlobBridgeErrorMessage(error: unknown) {
  if (error instanceof TypeError && error.message === "Failed to fetch") {
    return "This X video appears to be stream-backed (likely MediaSource/HLS), so the browser cannot fetch it directly yet.";
  }

  return getErrorMessage(error);
}

export const TTT_PAGE_BLOB_REQUEST = "TTT_PAGE_BLOB_VIDEO_REQUEST";
export const TTT_PAGE_BLOB_RESPONSE = "TTT_PAGE_BLOB_VIDEO_RESPONSE";

export type BlobBridgeSuccess = {
  bytes: number[];
  mimeType: string;
};

type BridgeRequest = {
  type: typeof TTT_PAGE_BLOB_REQUEST;
  requestId: string;
  blobUrl: string;
};

type BridgeSuccessResponse = {
  type: typeof TTT_PAGE_BLOB_RESPONSE;
  requestId: string;
  ok: true;
  bytes: number[];
  mimeType: string;
};

type BridgeErrorResponse = {
  type: typeof TTT_PAGE_BLOB_RESPONSE;
  requestId: string;
  ok: false;
  error: string;
};

type BridgeResponse = BridgeSuccessResponse | BridgeErrorResponse;

type ClientOptions = {
  timeoutMs?: number;
  targetWindow?: Window;
};

export function createBlobBridgeClient(options: ClientOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const targetWindow = options.targetWindow ?? window;

  return {
    async resolveBlobUrl(blobUrl: string): Promise<BlobBridgeSuccess> {
      const requestId = `ttt-${Math.random().toString(36).slice(2)}`;

      return await new Promise<BlobBridgeSuccess>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("Timed out while reading X video blob."));
        }, timeoutMs);

        const onMessage = (event: Event) => {
          const message = event as MessageEvent<BridgeResponse>;
          if (message.source !== targetWindow) return;
          if (message.data?.type !== TTT_PAGE_BLOB_RESPONSE) return;
          if (message.data.requestId !== requestId) return;
          const data = message.data;

          cleanup();
          if (data.ok === false) {
            reject(new Error(data.error || "Failed to read in-page video blob."));
            return;
          }

          resolve({
            bytes: data.bytes,
            mimeType: data.mimeType
          });
        };

        function cleanup() {
          clearTimeout(timeout);
          targetWindow.removeEventListener("message", onMessage as EventListener);
        }

        targetWindow.addEventListener("message", onMessage as EventListener);
        targetWindow.postMessage({
          type: TTT_PAGE_BLOB_REQUEST,
          requestId,
          blobUrl
        } satisfies BridgeRequest, "*");
      });
    }
  };
}

export function installBlobBridgeRuntime(targetWindow: Window = window) {
  const handler = async (event: Event) => {
    const message = event as MessageEvent<BridgeRequest>;
    if (message.source !== targetWindow) return;
    if (message.data?.type !== TTT_PAGE_BLOB_REQUEST) return;

    try {
      const response = await fetch(message.data.blobUrl);
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
      } satisfies BridgeSuccessResponse, "*");
    } catch (error: unknown) {
      targetWindow.postMessage({
        type: TTT_PAGE_BLOB_RESPONSE,
        requestId: message.data.requestId,
        ok: false,
        error: getBlobBridgeErrorMessage(error)
      } satisfies BridgeErrorResponse, "*");
    }
  };

  targetWindow.addEventListener("message", handler as EventListener);
  return () => targetWindow.removeEventListener("message", handler as EventListener);
}
