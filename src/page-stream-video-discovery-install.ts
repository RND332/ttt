import {
  TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST,
  TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE
} from "./page-stream-video-discovery-protocol";
import {
  RECOVERED_VIDEO_CLASSIFIERS,
  RECOVERED_VIDEO_HOSTNAME_PATTERN,
  RECOVERED_VIDEO_KIND_PRIORITY,
  RECOVERED_VIDEO_REJECT_PATTERNS,
  RECOVERED_VIDEO_SOURCE_PRIORITY
} from "./page-stream-video-discovery-shared";

type ChromeScriptingApi = {
  executeScript: (injection: {
    target: {
      tabId: number;
      frameIds?: number[];
      documentIds?: string[];
    };
    world: "MAIN";
    func: (
      requestType: string,
      responseType: string,
      hostnamePattern: string,
      classifiers: Array<{ kind: "direct-mp4" | "hls-playlist"; patterns: string[] }>,
      rejectPatterns: string[],
      kindPriority: Array<"direct-mp4" | "hls-playlist">,
      sourcePriority: Array<"page-fetch" | "page-xhr" | "performance" | "webRequest" | "tweet-json">
    ) => void;
    args: [
      string,
      string,
      string,
      Array<{ kind: "direct-mp4" | "hls-playlist"; patterns: string[] }>,
      string[],
      Array<"direct-mp4" | "hls-playlist">,
      Array<"page-fetch" | "page-xhr" | "performance" | "webRequest" | "tweet-json">
    ];
  }) => Promise<unknown> | unknown;
};

type ChromeWithScripting = {
  scripting?: ChromeScriptingApi;
};

type DiscoveryTarget = {
  tabId: number;
  frameIds?: number[];
  documentIds?: string[];
};

export async function ensurePageStreamVideoDiscoveryInstalled(chromeApi: ChromeWithScripting, target: DiscoveryTarget) {
  if (!chromeApi.scripting?.executeScript) {
    throw new Error("chrome.scripting.executeScript is unavailable.");
  }

  return await chromeApi.scripting.executeScript({
    target,
    world: "MAIN",
    func: (
      requestType,
      responseType,
      hostnamePattern,
      classifiers,
      rejectPatterns,
      kindPriority,
      sourcePriority
    ) => {
      const targetWindow = window as Window & {
        __tttPageStreamVideoDiscoveryInstalled?: boolean;
        __tttRecoveredVideoCandidates?: Map<string, { kind: "direct-mp4" | "hls-playlist"; url: string; source?: string }>;
        fetch?: typeof fetch;
        XMLHttpRequest?: typeof XMLHttpRequest;
      };
      if (targetWindow.__tttPageStreamVideoDiscoveryInstalled) return;
      targetWindow.__tttPageStreamVideoDiscoveryInstalled = true;
      targetWindow.__tttRecoveredVideoCandidates = targetWindow.__tttRecoveredVideoCandidates || new Map();

      const observeUrl = (value: unknown, source: string) => {
        const cleaned = String(value || "").trim();
        if (!cleaned) return;

        let parsed: URL;
        try {
          parsed = new URL(cleaned, location.href);
        } catch {
          return;
        }

        if (!/^https?:$/i.test(parsed.protocol)) return;
        if (!new RegExp(hostnamePattern, "i").test(parsed.hostname)) return;

        const url = parsed.toString();
        if (rejectPatterns.some((pattern) => new RegExp(pattern, "i").test(url))) return;

        const kind = classifiers.find((classifier) => classifier.patterns.some((pattern) => new RegExp(pattern, "i").test(url)))?.kind;
        if (!kind) return;

        const key = `${kind}:${url}`;
        if (!targetWindow.__tttRecoveredVideoCandidates?.has(key)) {
          targetWindow.__tttRecoveredVideoCandidates?.set(key, { kind, url, source });
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

      targetWindow.addEventListener("message", (event: Event) => {
        const message = event as MessageEvent<{ type?: string; requestId?: string }>;
        if (message.source !== targetWindow) return;
        if (message.data?.type !== requestType) return;

        const performanceEntries = performance.getEntriesByType?.("resource") || [];
        for (const entry of performanceEntries) {
          observeUrl((entry as PerformanceResourceTiming).name, "performance");
        }

        const candidates = Array.from(targetWindow.__tttRecoveredVideoCandidates?.values() || [])
          .sort((left, right) => {
            const leftKindScore = Math.max(kindPriority.indexOf(left.kind), 0);
            const rightKindScore = Math.max(kindPriority.indexOf(right.kind), 0);
            if (leftKindScore !== rightKindScore) return leftKindScore - rightKindScore;

            const leftSourceScore = left.source ? Math.max(sourcePriority.indexOf(left.source as typeof sourcePriority[number]), 0) : sourcePriority.length;
            const rightSourceScore = right.source ? Math.max(sourcePriority.indexOf(right.source as typeof sourcePriority[number]), 0) : sourcePriority.length;
            if (leftSourceScore !== rightSourceScore) return leftSourceScore - rightSourceScore;

            return left.url.localeCompare(right.url);
          });

        targetWindow.postMessage({
          type: responseType,
          requestId: message.data.requestId,
          ok: true,
          candidates
        }, "*");
      });
    },
    args: [
      TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST,
      TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE,
      RECOVERED_VIDEO_HOSTNAME_PATTERN,
      RECOVERED_VIDEO_CLASSIFIERS.map((classifier) => ({
        kind: classifier.kind,
        patterns: [...classifier.patterns]
      })),
      [...RECOVERED_VIDEO_REJECT_PATTERNS],
      [...RECOVERED_VIDEO_KIND_PRIORITY],
      [...RECOVERED_VIDEO_SOURCE_PRIORITY]
    ]
  });
}
