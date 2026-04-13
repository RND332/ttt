export type TelegramPhotoPayload = {
  kind: "photo";
  mediaUrl: string;
  postUrl: string;
};

export type TelegramPhotoAlbumPayload = {
  kind: "photo-album";
  mediaUrls: string[];
  postUrl: string;
};

export type TelegramVideoPayload = {
  kind: "video";
  postUrl: string;
  videoUrl?: string;
  playlistUrl?: string;
  blobUrl?: string;
};

const PHOTO_SELECTORS = [
  "div[data-testid='tweetPhoto'] img",
  "img[src*='twimg.com/media']",
  "img[src*='pbs.twimg.com/media']"
];

const VIDEO_CONTAINER_SELECTORS = [
  "div[data-testid='videoComponent']",
  "div[aria-label*='video' i]",
  "div[aria-label*='Video' i]",
  "video"
];

const VIDEO_URL_ATTRIBUTE_NAMES = [
  "data-playback-url",
  "data-video-url",
  "data-src",
  "data-url",
  "src"
];

export function extractPostData(article: Element): TelegramPhotoPayload | TelegramPhotoAlbumPayload | TelegramVideoPayload | null {
  const postUrl = getPostUrl(article);
  if (!postUrl) return null;

  if (hasVideoMedia(article)) {
    return {
      kind: "video",
      postUrl,
      videoUrl: getDirectVideoUrl(article) || undefined,
      playlistUrl: getStreamingPlaylistUrl(article) || undefined,
      blobUrl: getBlobVideoUrl(article) || undefined
    };
  }

  const photoUrls = getPhotoUrls(article);
  if (photoUrls.length === 1) {
    return { kind: "photo", mediaUrl: photoUrls[0], postUrl };
  }

  if (photoUrls.length > 1) {
    return { kind: "photo-album", mediaUrls: photoUrls, postUrl };
  }

  return null;
}

function getPhotoUrls(article: Element) {
  const urls = new Set<string>();

  for (const photo of findDirectMediaNodes(article, PHOTO_SELECTORS)) {
    const photoUrl = getElementUrl(photo);
    if (isHttpUrl(photoUrl)) urls.add(photoUrl);
  }

  return Array.from(urls);
}

function findDirectMediaNodes(root: Element, selectors: string[]) {
  const nodes = Array.from(root.querySelectorAll(selectors.join(",")));
  return nodes.filter((node) => !isInsideNestedQuote(node, root));
}

function hasVideoMedia(article: Element) {
  return findDirectMediaNodes(article, VIDEO_CONTAINER_SELECTORS).length > 0;
}

function getDirectVideoUrl(article: Element) {
  const candidates = collectVideoCandidates(article);
  return chooseBestVideoCandidate(candidates);
}

function getBlobVideoUrl(article: Element) {
  const candidates = collectVideoCandidates(article);
  return chooseBestBlobCandidate(candidates);
}

function getStreamingPlaylistUrl(article: Element) {
  const candidates = collectVideoCandidates(article);
  return chooseBestPlaylistCandidate(candidates);
}

function collectVideoCandidates(article: Element) {
  const candidates = new Set<string>();
  const directNodes = findDirectMediaNodes(article, VIDEO_CONTAINER_SELECTORS);

  for (const node of directNodes) {
    collectCandidateUrlsFromElement(node).forEach((candidate) => candidates.add(candidate));
    for (const child of Array.from(node.querySelectorAll("video, source, [data-playback-url], [data-video-url], [data-src], [data-url]"))) {
      if (isInsideNestedQuote(child, article)) continue;
      collectCandidateUrlsFromElement(child).forEach((candidate) => candidates.add(candidate));
    }
  }

  return Array.from(candidates);
}

function collectCandidateUrlsFromElement(node: Element) {
  const candidates: string[] = [];

  if (node.tagName === "VIDEO") {
    const video = node as HTMLVideoElement;
    pushCandidate(candidates, video.currentSrc);
    pushCandidate(candidates, video.src);
  }

  if (node.tagName === "SOURCE") {
    pushCandidate(candidates, node.getAttribute("src"));
    pushCandidate(candidates, node.getAttribute("data-src"));
  }

  for (const attr of VIDEO_URL_ATTRIBUTE_NAMES) {
    pushCandidate(candidates, node.getAttribute(attr));
  }

  return candidates;
}

function pushCandidate(candidates: string[], value: string | null | undefined) {
  const normalized = normalizeCandidateUrl(value);
  if (normalized) candidates.push(normalized);
}

function normalizeCandidateUrl(value: string | null | undefined) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return null;
  if (isBlobUrl(cleaned)) return cleaned;
  if (!isHttpUrl(cleaned)) return null;
  if (isClearlyNotVideo(cleaned)) return null;
  if (isLikelySegmentArtifact(cleaned)) return null;
  return cleaned;
}

function chooseBestVideoCandidate(candidates: string[]) {
  const ranked = candidates
    .filter((candidate) => isHttpUrl(candidate))
    .filter((candidate) => !isStreamingPlaylist(candidate))
    .sort((left, right) => scoreVideoCandidate(right) - scoreVideoCandidate(left));

  return ranked[0] || null;
}

function chooseBestBlobCandidate(candidates: string[]) {
  const blobs = candidates.filter((candidate) => /^blob:/i.test(candidate));
  return blobs[0] || null;
}

function chooseBestPlaylistCandidate(candidates: string[]) {
  const playlists = candidates
    .filter((candidate) => isHttpUrl(candidate))
    .filter((candidate) => isStreamingPlaylist(candidate));

  return playlists[0] || null;
}

function scoreVideoCandidate(url: string) {
  let score = 0;
  if (/^https:\/\//i.test(url)) score += 20;
  if (/video\.twimg\.com/i.test(url)) score += 10;
  if (/\.(mp4|mov|webm)(\?|$)/i.test(url)) score += 30;
  if (/\/vid\//i.test(url)) score += 5;
  return score;
}

function isStreamingPlaylist(url: string) {
  return /\.m3u8(\?|$)/i.test(url);
}

function isClearlyNotVideo(url: string) {
  return /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url);
}

function isLikelySegmentArtifact(url: string) {
  return /(?:^|\/)init\.(?:mp4|m4s)(?:\?|$)/i.test(url)
    || /(?:^|\/)(?:chunk|segment|frag|fragment)[^/]*\.(?:m4s|ts|aac)(?:\?|$)/i.test(url)
    || /\.(?:m4s|ts|aac)(\?|$)/i.test(url);
}

function isBlobUrl(value: string) {
  return /^blob:/i.test(value);
}

function isInsideNestedQuote(node: Element, rootArticle: Element) {
  let current = node.parentElement;
  while (current && current !== rootArticle) {
    if (current.tagName === "ARTICLE" || current.tagName === "BLOCKQUOTE") return true;
    current = current.parentElement;
  }
  return false;
}

function getElementUrl(el: Element) {
  if (!el) return "";
  if (el.tagName === "IMG") return (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src || el.getAttribute("src") || "";
  if (el.tagName === "VIDEO") return (el as HTMLVideoElement).currentSrc || (el as HTMLVideoElement).src || el.getAttribute("src") || "";
  return el.getAttribute("src") || "";
}

function isHttpUrl(value: string) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    try {
      const parsed = new URL(value, "https://x.com");
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }
}

function getPostUrl(article: Element) {
  const anchors = Array.from(article.querySelectorAll("a[href]"))
    .filter((node) => !isInsideNestedQuote(node, article));
  const mediaRouteAnchor = anchors.find((node) => {
    const href = node.getAttribute("href") || "";
    return /\/status\/\d+\/video\/\d+/i.test(href);
  });
  const anchor = mediaRouteAnchor || anchors.find((node) => {
    const href = node.getAttribute("href") || "";
    return /\/status\/\d+/i.test(href);
  });

  if (!anchor) return null;
  const href = anchor.getAttribute("href") || "";
  return href.startsWith("http") ? href : `https://x.com${href}`;
}
