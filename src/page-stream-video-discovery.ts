import { sendExtensionMessage } from "./runtime-messaging";
import type { BackgroundMessage, MessageResponse, RecoveredVideoCandidate } from "./shared";
import {
  type DiscoveryRequest,
  type DiscoveryResponse,
  TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST,
  TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE
} from "./page-stream-video-discovery-protocol";
import {
  rankRecoveredVideoCandidates,
  toRecoveredVideoCandidate
} from "./page-stream-video-discovery-shared";

export {
  TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST,
  TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE
} from "./page-stream-video-discovery-protocol";

type ClientOptions = {
  timeoutMs?: number;
  targetWindow?: Window;
};

type DiscoveryWindow = Window & {
  __tttPageStreamVideoDiscoveryInstalled?: boolean;
  fetch?: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
  performance?: Performance;
};

export function createPageStreamVideoDiscoveryClient(options: ClientOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 1500;
  const targetWindow = options.targetWindow ?? window;

  return {
    async collectCandidates(): Promise<RecoveredVideoCandidate[]> {
      const requestId = `ttt-stream-${Math.random().toString(36).slice(2)}`;

      return await new Promise<RecoveredVideoCandidate[]>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          targetWindow.removeEventListener("message", onMessage);
          reject(new Error("Timed out while collecting recovered X video candidates."));
        }, timeoutMs);

        const onMessage = (event: Event) => {
          const message = event as MessageEvent<DiscoveryResponse>;
          if (message.source !== targetWindow) return;
          if (message.data?.type !== TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE) return;
          if (message.data?.requestId !== requestId) return;

          clearTimeout(timeoutId);
          targetWindow.removeEventListener("message", onMessage);

          if (message.data.ok) {
            resolve(message.data.candidates || []);
            return;
          }

          reject(new Error("error" in message.data ? message.data.error || "Failed to collect recovered X video candidates." : "Failed to collect recovered X video candidates."));
        };

        targetWindow.addEventListener("message", onMessage);
        targetWindow.postMessage({
          type: TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST,
          requestId
        } satisfies DiscoveryRequest, "*");
      });
    }
  };
}

export async function recoverStreamVideoCandidates(postUrl: string) {
  const installResponse = await sendExtensionMessage<MessageResponse<unknown>>({
    type: "ENSURE_PAGE_STREAM_VIDEO_DISCOVERY"
  } satisfies BackgroundMessage);
  if (installResponse.ok === false) {
    throw new Error(installResponse.error || "Failed to install page stream video discovery.");
  }

  const candidates = await createPageStreamVideoDiscoveryClient().collectCandidates();
  if (candidates.length === 0) {
    return { reported: 0 };
  }

  const reportResponse = await sendExtensionMessage<MessageResponse<{ stored: number }>>({
    type: "REPORT_RECOVERED_VIDEO_CANDIDATES",
    postUrl,
    candidates
  } satisfies BackgroundMessage);
  if (reportResponse.ok === false) {
    throw new Error(reportResponse.error || "Failed to report recovered X video candidates.");
  }

  return reportResponse.result;
}

export function installPageStreamVideoDiscoveryRuntime(targetWindow: DiscoveryWindow) {
  if (targetWindow.__tttPageStreamVideoDiscoveryInstalled) {
    return () => undefined;
  }

  targetWindow.__tttPageStreamVideoDiscoveryInstalled = true;
  const observedCandidates = new Map<string, RecoveredVideoCandidate>();

  const observeUrl = (value: unknown, source: RecoveredVideoCandidate["source"]) => {
    const candidate = toRecoveredVideoCandidate(value, source);
    if (!candidate) return;

    const key = `${candidate.kind}:${candidate.url}`;
    if (!observedCandidates.has(key)) {
      observedCandidates.set(key, candidate);
    }
  };

  const originalFetch = targetWindow.fetch?.bind(targetWindow);
  if (originalFetch) {
    targetWindow.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      observeUrl(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, "page-fetch");
      return await originalFetch(input, init);
    }) as typeof fetch;
  }

  const xhrPrototype = targetWindow.XMLHttpRequest?.prototype as XMLHttpRequest | undefined;
  const originalXhrOpen = xhrPrototype?.open;
  if (xhrPrototype && originalXhrOpen) {
    xhrPrototype.open = function patchedOpen(this: XMLHttpRequest, method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
      observeUrl(typeof url === "string" ? url : url.toString(), "page-xhr");
      return originalXhrOpen.call(this, method, url as string, async as boolean, username as string, password as string);
    } as typeof xhrPrototype.open;
  }

  const onMessage = (event: Event) => {
    const message = event as MessageEvent<DiscoveryRequest>;
    if (message.source !== targetWindow) return;
    if (message.data?.type !== TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST) return;

    try {
      const performanceEntries = targetWindow.performance?.getEntriesByType?.("resource") || [];
      for (const entry of performanceEntries) {
        observeUrl((entry as PerformanceResourceTiming).name, "performance");
      }

      targetWindow.postMessage({
        type: TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE,
        requestId: message.data.requestId,
        ok: true,
        candidates: rankRecoveredVideoCandidates(Array.from(observedCandidates.values()))
      } satisfies DiscoveryResponse, "*");
    } catch (error: unknown) {
      targetWindow.postMessage({
        type: TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE,
        requestId: message.data.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      } satisfies DiscoveryResponse, "*");
    }
  };

  targetWindow.addEventListener("message", onMessage);

  return () => {
    targetWindow.removeEventListener("message", onMessage);
    if (originalFetch) {
      targetWindow.fetch = originalFetch;
    }
    if (xhrPrototype && originalXhrOpen) {
      xhrPrototype.open = originalXhrOpen;
    }
    targetWindow.__tttPageStreamVideoDiscoveryInstalled = false;
  };
}
