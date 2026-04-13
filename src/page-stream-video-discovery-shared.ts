import type { RecoveredVideoCandidate } from "./shared";

export const RECOVERED_VIDEO_URL_BASE = "https://x.com";
export const RECOVERED_VIDEO_HOSTNAME_PATTERN = "video\\.twimg\\.com$";
export const RECOVERED_VIDEO_KIND_PRIORITY = ["direct-mp4", "hls-playlist"] as const satisfies RecoveredVideoCandidate["kind"][];
export const RECOVERED_VIDEO_SOURCE_PRIORITY = [
  "page-fetch",
  "page-xhr",
  "performance",
  "webRequest",
  "tweet-json"
] as const satisfies NonNullable<RecoveredVideoCandidate["source"]>[];
export const RECOVERED_VIDEO_CLASSIFIERS = [
  {
    kind: "hls-playlist",
    patterns: ["\\.m3u8(\\?|$)"]
  },
  {
    kind: "direct-mp4",
    patterns: ["\\.(mp4|mov|webm)(\\?|$)", "\\/vid\\/"]
  }
] as const satisfies Array<{
  kind: RecoveredVideoCandidate["kind"];
  patterns: readonly string[];
}>;

export const RECOVERED_VIDEO_REJECT_PATTERNS = [
  "(?:^|\\/)init\\.(?:mp4|m4s)(?:\\?|$)",
  "(?:^|\\/)(?:chunk|segment|frag|fragment)[^/]*\\.(?:m4s|ts|aac)(?:\\?|$)",
  "\\.(?:m4s|ts|aac)(?:\\?|$)"
] as const;

export function normalizeRecoveredVideoUrl(
  value: unknown,
  options: { baseUrl?: string } = {}
) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return null;

  try {
    const parsed = new URL(cleaned, options.baseUrl ?? RECOVERED_VIDEO_URL_BASE);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    if (!new RegExp(RECOVERED_VIDEO_HOSTNAME_PATTERN, "i").test(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function classifyRecoveredVideoUrl(url: string) {
  if (RECOVERED_VIDEO_REJECT_PATTERNS.some((pattern) => new RegExp(pattern, "i").test(url))) {
    return null;
  }

  for (const classifier of RECOVERED_VIDEO_CLASSIFIERS) {
    if (classifier.patterns.some((pattern) => new RegExp(pattern, "i").test(url))) {
      return classifier.kind;
    }
  }

  return null;
}

export function toRecoveredVideoCandidate(
  value: unknown,
  source: RecoveredVideoCandidate["source"],
  options: { baseUrl?: string } = {}
) {
  const normalizedUrl = normalizeRecoveredVideoUrl(value, options);
  if (!normalizedUrl) return null;

  const kind = classifyRecoveredVideoUrl(normalizedUrl);
  if (!kind) return null;

  return {
    kind,
    url: normalizedUrl,
    source
  } satisfies RecoveredVideoCandidate;
}

export function rankRecoveredVideoCandidates(candidates: RecoveredVideoCandidate[]) {
  return [...candidates].sort((left, right) => {
    const kindScore = scoreCandidateKind(left.kind) - scoreCandidateKind(right.kind);
    if (kindScore !== 0) return kindScore;

    const sourceScore = scoreCandidateSource(left.source) - scoreCandidateSource(right.source);
    if (sourceScore !== 0) return sourceScore;

    return left.url.localeCompare(right.url);
  });
}

function scoreCandidateKind(kind: RecoveredVideoCandidate["kind"]) {
  const index = RECOVERED_VIDEO_KIND_PRIORITY.indexOf(kind);
  return index === -1 ? RECOVERED_VIDEO_KIND_PRIORITY.length : index;
}

function scoreCandidateSource(source: RecoveredVideoCandidate["source"]) {
  if (!source) return RECOVERED_VIDEO_SOURCE_PRIORITY.length;
  const index = RECOVERED_VIDEO_SOURCE_PRIORITY.indexOf(source);
  return index === -1 ? RECOVERED_VIDEO_SOURCE_PRIORITY.length : index;
}
