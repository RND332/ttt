export interface BrowserDownloadedVideo {
  blob: Blob;
  filename: string;
}

export const BROWSER_VIDEO_FETCH_FAILED_ERROR =
  "Failed to download the video in the browser. X/Twitter may not have exposed a directly fetchable file for this post.";
export const BROWSER_VIDEO_INVALID_FILE_ERROR =
  "Downloaded video file is not a complete playable MP4.";

const MIN_VIDEO_FILE_SIZE_BYTES = 16;
const MP4_FTYP_SIGNATURE = [0x66, 0x74, 0x79, 0x70] as const;

export async function downloadBrowserVideo(url: string, preferredFilename?: string | null): Promise<BrowserDownloadedVideo> {
  let response: Response;

  try {
    response = await fetch(url, { credentials: "omit" });
  } catch (error: unknown) {
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new Error(BROWSER_VIDEO_FETCH_FAILED_ERROR);
    }

    throw error;
  }

  if (!response.ok) {
    throw new Error(`Failed to download video file: ${response.status}`);
  }

  const blob = await response.blob();
  const filename = inferFilename(url, preferredFilename);

  await validateBrowserVideoDownload({
    url,
    filenameHint: preferredFilename,
    blob,
    contentType: response.headers.get("content-type") || blob.type
  });

  return {
    blob,
    filename
  };
}

async function validateBrowserVideoDownload({
  url,
  filenameHint,
  blob,
  contentType
}: {
  url: string;
  filenameHint?: string | null;
  blob: Blob;
  contentType: string;
}) {
  const normalizedContentType = normalizeContentType(contentType);

  if (!isAcceptedVideoContentType(normalizedContentType)) {
    throw new Error(BROWSER_VIDEO_INVALID_FILE_ERROR);
  }

  if (blob.size < MIN_VIDEO_FILE_SIZE_BYTES) {
    throw new Error(BROWSER_VIDEO_INVALID_FILE_ERROR);
  }

  if (!shouldValidateMp4Signature({
    url,
    filenameHint,
    contentType: normalizedContentType
  })) {
    return;
  }

  const headerBytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  if (!hasMp4FtypSignatureNearStart(headerBytes)) {
    throw new Error(BROWSER_VIDEO_INVALID_FILE_ERROR);
  }
}

function normalizeContentType(contentType: string) {
  return contentType.split(";")[0]?.trim().toLowerCase() || "";
}

function isAcceptedVideoContentType(contentType: string) {
  return contentType === "video/mp4" || contentType === "application/octet-stream" || contentType === "";
}

function shouldValidateMp4Signature({
  url,
  filenameHint,
  contentType
}: {
  url: string;
  filenameHint?: string | null;
  contentType: string;
}) {
  return contentType === "video/mp4"
    || contentType === "application/octet-stream"
    || contentType === ""
    || looksLikeMp4Target(url, filenameHint);
}

function looksLikeMp4Target(url: string, filenameHint?: string | null) {
  const cleanedFilenameHint = String(filenameHint || "").trim();
  return hasMp4Extension(url) || hasMp4Extension(cleanedFilenameHint);
}

function hasMp4Extension(value: string) {
  return /\.mp4(?:$|[?#])/i.test(value);
}

function hasMp4FtypSignatureNearStart(bytes: Uint8Array) {
  const maxStartIndex = Math.min(bytes.length - MP4_FTYP_SIGNATURE.length, 16);

  for (let index = 0; index <= maxStartIndex; index += 1) {
    if (MP4_FTYP_SIGNATURE.every((byte, offset) => bytes[index + offset] === byte)) {
      return true;
    }
  }

  return false;
}

function inferFilename(url: string, preferredFilename?: string | null) {
  const cleaned = String(preferredFilename || "").trim();
  if (cleaned) return cleaned;

  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const lastSegment = parts.length ? parts[parts.length - 1] : undefined;
    if (lastSegment) return decodeURIComponent(lastSegment);
  } catch {
    // ignore and fall through to default
  }

  return "video.mp4";
}
