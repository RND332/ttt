import type { RecoveredVideoCandidate } from "./shared";
import { classifyRecoveredVideoUrl } from "./page-stream-video-discovery-shared";

export interface RecoveredVideoCandidateStore {
  record(tabId: number, postUrl: string, candidates: RecoveredVideoCandidate[], options?: { merge?: boolean }): number;
  get(tabId: number, postUrl: string): RecoveredVideoCandidate[];
}

export function mergeRecoveredVideoCandidates(...candidateLists: RecoveredVideoCandidate[][]) {
  return dedupeRecoveredVideoCandidates(candidateLists.flat());
}

export function createRecoveredVideoCandidateStore(): RecoveredVideoCandidateStore {
  const recoveredVideoCandidatesByTab = new Map<number, Map<string, RecoveredVideoCandidate[]>>();

  return {
    record(tabId, postUrl, candidates, options) {
      const normalizedPostUrl = normalizePostUrl(postUrl);
      const existingByPostUrl = recoveredVideoCandidatesByTab.get(tabId) ?? new Map<string, RecoveredVideoCandidate[]>();
      const existingCandidates = options?.merge ? existingByPostUrl.get(normalizedPostUrl) || [] : [];
      const sanitizedCandidates = mergeRecoveredVideoCandidates(existingCandidates, candidates);
      existingByPostUrl.set(normalizedPostUrl, sanitizedCandidates);
      recoveredVideoCandidatesByTab.set(tabId, existingByPostUrl);
      return sanitizedCandidates.length;
    },
    get(tabId, postUrl) {
      return recoveredVideoCandidatesByTab.get(tabId)?.get(normalizePostUrl(postUrl)) || [];
    }
  };
}

export function getBestRecoveredVideoCandidate(candidates: RecoveredVideoCandidate[]) {
  return [...candidates]
    .filter((candidate) => classifyRecoveredVideoUrl(candidate.url) === candidate.kind)
    .sort((left, right) => rankRecoveredVideoCandidate(left) - rankRecoveredVideoCandidate(right))
    [0] || null;
}

const DIRECT_MP4_SOURCE_PRIORITY = [
  "tweet-json",
  "page-fetch",
  "page-xhr",
  "performance",
  "webRequest"
] as const satisfies Array<NonNullable<RecoveredVideoCandidate["source"]>>;

function rankRecoveredVideoCandidate(candidate: RecoveredVideoCandidate) {
  if (candidate.kind !== "direct-mp4") {
    return Number.MAX_SAFE_INTEGER;
  }

  return (scoreDirectMp4Source(candidate.source) * 1_000_000_000_000) - (candidate.bitrate || 0);
}

function scoreDirectMp4Source(source: RecoveredVideoCandidate["source"]) {
  if (!source) {
    return DIRECT_MP4_SOURCE_PRIORITY.length;
  }

  const index = DIRECT_MP4_SOURCE_PRIORITY.indexOf(source);
  return index === -1 ? DIRECT_MP4_SOURCE_PRIORITY.length : index;
}

function dedupeRecoveredVideoCandidates(candidates: RecoveredVideoCandidate[]) {
  const seen = new Set<string>();
  const deduped: RecoveredVideoCandidate[] = [];

  for (const candidate of candidates) {
    if (!candidate?.url) continue;
    const key = `${candidate.kind}:${candidate.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function normalizePostUrl(postUrl: string) {
  try {
    const parsed = new URL(postUrl);
    const statusMatch = parsed.pathname.match(/^\/([^/]+)\/status\/(\d+)(?:\/(video|photo)\/(\d+))?/i);
    if (statusMatch) {
      const username = statusMatch[1];
      const tweetId = statusMatch[2];
      const mediaKind = statusMatch[3]?.toLowerCase();
      const mediaIndex = statusMatch[4];
      const canonicalMediaPath = mediaKind === "video" && mediaIndex
        ? `/video/${mediaIndex}`
        : "";
      return `https://x.com/${username}/status/${tweetId}${canonicalMediaPath}`;
    }

    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    const statusMatch = String(postUrl).match(/(?:^|\/)([^/]+)\/status\/(\d+)(?:\/(video|photo)\/(\d+))?/i);
    if (statusMatch) {
      const username = statusMatch[1];
      const tweetId = statusMatch[2];
      const mediaKind = statusMatch[3]?.toLowerCase();
      const mediaIndex = statusMatch[4];
      const canonicalMediaPath = mediaKind === "video" && mediaIndex
        ? `/video/${mediaIndex}`
        : "";
      return `https://x.com/${username}/status/${tweetId}${canonicalMediaPath}`;
    }

    return postUrl;
  }
}
