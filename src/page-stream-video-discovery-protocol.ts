import type { RecoveredVideoCandidate } from "./shared";

export const TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST = "TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST";
export const TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE = "TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE";

export type DiscoveryRequest = {
  type: typeof TTT_PAGE_STREAM_VIDEO_DISCOVERY_REQUEST;
  requestId: string;
};

export type DiscoveryResponse = {
  type: typeof TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE;
  requestId: string;
  ok: true;
  candidates: RecoveredVideoCandidate[];
} | {
  type: typeof TTT_PAGE_STREAM_VIDEO_DISCOVERY_RESPONSE;
  requestId: string;
  ok: false;
  error: string;
};
