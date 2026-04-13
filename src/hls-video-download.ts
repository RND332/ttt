import {
  downloadBrowserVideo,
  type BrowserDownloadedVideo,
} from "./browser-video-download";

export const UNSUPPORTED_SEGMENTED_HLS_ERROR =
  "Unsupported HLS playlist: segmented streams require assembly/remux.";

export interface HlsMasterPlaylistVariant {
  kind: "direct-mp4" | "hls-playlist";
  uri: string;
  url: string;
  bandwidth: number | null;
  codecs: string | null;
  resolution: {
    width: number;
    height: number;
  } | null;
}

export async function downloadHlsVideo(
  playlistUrl: string,
  preferredFilename?: string | null
): Promise<BrowserDownloadedVideo> {
  const directVideoUrl = await resolveHlsVideoDownloadUrl(playlistUrl);
  return await downloadBrowserVideo(directVideoUrl, preferredFilename);
}

export async function resolveHlsVideoDownloadUrl(
  playlistUrl: string
): Promise<string> {
  const response = await fetch(playlistUrl, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(`Failed to fetch HLS playlist: ${response.status}`);
  }

  const playlistText = await response.text();

  if (isMasterPlaylist(playlistText)) {
    const variants = parseHlsMasterPlaylist(playlistText, playlistUrl);
    const directVariant = variants
      .filter((variant) => variant.kind === "direct-mp4")
      .sort((left, right) => (right.bandwidth ?? -1) - (left.bandwidth ?? -1))[0];

    if (directVariant) {
      return directVariant.url;
    }

    throw new Error(UNSUPPORTED_SEGMENTED_HLS_ERROR);
  }

  if (isMediaPlaylist(playlistText)) {
    throw new Error(UNSUPPORTED_SEGMENTED_HLS_ERROR);
  }

  throw new Error("Failed to parse HLS playlist: no stream variants found.");
}

export function parseHlsMasterPlaylist(
  playlistText: string,
  playlistUrl: string
): HlsMasterPlaylistVariant[] {
  const lines = normalizePlaylistLines(playlistText);
  const variants: HlsMasterPlaylistVariant[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("#EXT-X-STREAM-INF:")) {
      continue;
    }

    const uri = findNextUriLine(lines, index + 1);
    if (!uri) {
      continue;
    }

    const attributes = parseAttributeList(line.slice("#EXT-X-STREAM-INF:".length));
    variants.push({
      kind: classifyVariantUri(uri),
      uri,
      url: new URL(uri, playlistUrl).toString(),
      bandwidth: parseInteger(attributes.BANDWIDTH),
      codecs: attributes.CODECS ?? null,
      resolution: parseResolution(attributes.RESOLUTION),
    });
  }

  return variants;
}

function normalizePlaylistLines(playlistText: string) {
  return playlistText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function findNextUriLine(lines: string[], startIndex: number) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("#")) {
      return line;
    }
  }

  return null;
}

function classifyVariantUri(uri: string): HlsMasterPlaylistVariant["kind"] {
  return /\.mp4(\?|$)/i.test(uri) ? "direct-mp4" : "hls-playlist";
}

function isMasterPlaylist(playlistText: string) {
  return /#EXT-X-STREAM-INF:/i.test(playlistText);
}

function isMediaPlaylist(playlistText: string) {
  if (/#EXTINF:/i.test(playlistText)) {
    return true;
  }

  const lines = normalizePlaylistLines(playlistText);
  return lines.some(
    (line) =>
      !line.startsWith("#") &&
      !/\.mp4(\?|$)/i.test(line) &&
      /\.(m3u8|ts|m4s|aac|mp4)(\?|$)/i.test(line)
  );
}

function parseInteger(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseResolution(value: string | undefined) {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d+)x(\d+)$/i);
  if (!match) {
    return null;
  }

  return {
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10),
  };
}

function parseAttributeList(input: string) {
  const attributes: Record<string, string> = {};
  const pattern = /([A-Z0-9-]+)=((?:"[^"]*")|[^,]*)/gi;

  for (const match of input.matchAll(pattern)) {
    const key = match[1];
    const rawValue = match[2] ?? "";
    attributes[key] = rawValue.replace(/^"|"$/g, "");
  }

  return attributes;
}
