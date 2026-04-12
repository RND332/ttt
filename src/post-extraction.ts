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
  return findDirectMediaNodes(article, [
    "div[data-testid='videoComponent']",
    "div[aria-label*='video' i]",
    "div[aria-label*='Video' i]",
    "video"
  ]).length > 0;
}

function isInsideNestedQuote(node: Element, rootArticle: Element) {
  let current = node.parentElement;
  while (current && current !== rootArticle) {
    if (current.tagName === "ARTICLE" || current.tagName === "BLOCKQUOTE") return true;
    current = current.parentElement;
  }
  return false;
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
  const anchor = anchors.find((node) => {
    const href = node.getAttribute("href") || "";
    return /\/status\/\d+/.test(href) && !isInsideNestedQuote(node, article);
  });

  if (!anchor) return null;
  const href = anchor.getAttribute("href") || "";
  return href.startsWith("http") ? href : `https://x.com${href}`;
}
