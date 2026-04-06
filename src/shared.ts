export type MediaKind = "photo" | "video";

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

export interface TelegramVideoPayload extends TelegramPayloadBase {
  kind: "video";
}

export type TelegramSendPayload = TelegramPhotoPayload | TelegramPhotoAlbumPayload | TelegramVideoPayload;

export interface ExtensionSettings {
  botToken: string;
  channelId: string;
  cobaltUrl: string;
  cobaltAuthToken: string;
  cobaltAuthScheme: string;
  cobaltQuality: string;
  autoPrefix: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  botToken: "",
  channelId: "",
  cobaltUrl: "https://api.cobalt.tools",
  cobaltAuthToken: "",
  cobaltAuthScheme: "Api-Key",
  cobaltQuality: "1080",
  autoPrefix: true
};

export interface SendToTelegramMessage {
  type: "SEND_TO_TELEGRAM";
  payload: TelegramSendPayload;
}

export interface TestCobaltAuthMessage {
  type: "TEST_COBALT_AUTH";
  payload: Pick<ExtensionSettings, "cobaltUrl" | "cobaltAuthToken" | "cobaltAuthScheme" | "cobaltQuality">;
}

export type BackgroundMessage = SendToTelegramMessage | TestCobaltAuthMessage;

export interface MessageOkResponse<T = unknown> {
  ok: true;
  result: T;
}

export interface MessageErrorResponse {
  ok: false;
  error: string;
}

export type MessageResponse<T = unknown> = MessageOkResponse<T> | MessageErrorResponse;

export interface CobaltResolution {
  url: string | null;
  filename: string | null;
}
