export interface TelegramPayloadBase {
  postUrl: string;
}

export interface TelegramPhotoPayload extends TelegramPayloadBase {
  kind: "photo";
  mediaUrl: string;
}

export interface TelegramPhotoAlbumPayload extends TelegramPayloadBase {
  kind: "photo-album";
  mediaUrls: string[];
}

export interface RecoveredVideoCandidate {
  kind: "direct-mp4" | "hls-playlist";
  url: string;
  mimeType?: string;
  bitrate?: number;
  source?: "page-fetch" | "page-xhr" | "performance" | "webRequest" | "tweet-json";
}

export interface TelegramVideoPayload extends TelegramPayloadBase {
  kind: "video";
  videoUrl?: string;
  blobUrl?: string;
  videoBlobBytes?: number[];
  videoFilename?: string;
  videoMimeType?: string;
  playlistUrl?: string;
}

export type TelegramSendPayload = TelegramPhotoPayload | TelegramPhotoAlbumPayload | TelegramVideoPayload;

export interface ExtensionSettings {
  botToken: string;
  channelId: string;
  autoPrefix: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  botToken: "",
  channelId: "",
  autoPrefix: true
};

export interface SendToTelegramMessage {
  type: "SEND_TO_TELEGRAM";
  payload: TelegramSendPayload;
}

export interface EnsurePageBlobBridgeMessage {
  type: "ENSURE_PAGE_BLOB_BRIDGE";
}

export interface EnsurePageStreamVideoDiscoveryMessage {
  type: "ENSURE_PAGE_STREAM_VIDEO_DISCOVERY";
}

export interface EnsurePageTwitterVideoResolverMessage {
  type: "ENSURE_PAGE_TWITTER_VIDEO_RESOLVER";
}

export interface ReportRecoveredVideoCandidatesMessage {
  type: "REPORT_RECOVERED_VIDEO_CANDIDATES";
  postUrl: string;
  candidates: RecoveredVideoCandidate[];
}

export interface GetRecoveredVideoCandidatesMessage {
  type: "GET_RECOVERED_VIDEO_CANDIDATES";
  postUrl: string;
}

export interface GetRecoveredVideoCandidatesResult {
  candidates: RecoveredVideoCandidate[];
}

export type BackgroundMessage =
  | SendToTelegramMessage
  | EnsurePageBlobBridgeMessage
  | EnsurePageStreamVideoDiscoveryMessage
  | EnsurePageTwitterVideoResolverMessage
  | ReportRecoveredVideoCandidatesMessage
  | GetRecoveredVideoCandidatesMessage;

export interface MessageOkResponse<T = unknown> {
  ok: true;
  result: T;
}

export interface MessageErrorResponse {
  ok: false;
  error: string;
}

export type MessageResponse<T = unknown> = MessageOkResponse<T> | MessageErrorResponse;
