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
};

const PHOTO_SELECTORS = [
  "div[data-testid='tweetPhoto'] img",
  "img[src*='twimg.com/media']",
  "img[src*='pbs.twimg.com/media']"
];

export function extractPostData(article: Element): TelegramPhotoPayload | TelegramPhotoAlbumPayload | TelegramVideoPayload | null {
  const postUrl = getPostUrl(article);
  if (!postUrl) return null;

  if (hasVideoMedia(article)) {
    return {
      kind: "video",
      postUrl
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
  const photos = Array.from(article.querySelectorAll(PHOTO_SELECTORS.join(",")));
  const urls = new Set<string>();

  for (const photo of photos) {
    if (getOwningArticle(photo as Element) !== article) continue;
    if (isInsideVideoContainer(photo as Element)) continue;
    const photoUrl = getElementUrl(photo as Element);
    if (isHttpUrl(photoUrl)) urls.add(photoUrl);
  }

  return Array.from(urls);
}

function hasVideoMedia(article: Element) {
  const videoContainer = article.querySelector(
    "div[data-testid='videoComponent'], div[aria-label*='video' i], div[aria-label*='Video' i], video"
  );
  return Boolean(videoContainer && getOwningArticle(videoContainer) === article);
}

function isInsideVideoContainer(node: Element) {
  return Boolean(node.closest("div[data-testid='videoComponent'], div[aria-label*='video' i], div[aria-label*='Video' i], video"));
}

function getOwningArticle(node: Element) {
  return node.closest("article");
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
  const anchors = Array.from(article.querySelectorAll("a[href]"));
  const anchor = anchors
    .map((a) => a.getAttribute("href") || "")
    .find((href, index) => {
      if (!/\/status\/\d+/.test(href)) return false;
      const node = anchors[index];
      return getOwningArticle(node) === article;
    });

  if (!anchor) return null;
  return anchor.startsWith("http") ? anchor : `https://x.com${anchor}`;
}
