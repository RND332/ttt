import { expect, test } from "vitest";
import { parseHTML } from "linkedom";
import { extractPostData } from "./post-extraction";
import { loadMockHtml } from "./test/fixtures";

type FixtureCase = {
  name: string;
  path: string;
  expectedKinds: Array<"photo" | "photo-album" | "video" | null>;
};

const cases: FixtureCase[] = [
  {
    name: "for you scroll",
    path: "mocks/twitter/for-you-scroll.html",
    expectedKinds: ["photo", null, "photo"],
  },
  {
    name: "followed scroll",
    path: "mocks/twitter/followed-scroll.html",
    expectedKinds: ["photo", "photo", "video"],
  },
  {
    name: "tweet page",
    path: "mocks/twitter/tweet-page.html",
    expectedKinds: ["photo"],
  },
  {
    name: "opened tweet image",
    path: "mocks/twitter/tweet-photo-open.html",
    expectedKinds: ["photo"],
  },
  {
    name: "quote tweet thread",
    path: "mocks/twitter/quote-tweet-thread.html",
    expectedKinds: ["photo-album"],
  },
] as const;

test.each(cases)("extractPostData classifies %s", async ({ path, expectedKinds }) => {
  const html = await loadMockHtml(path);
  const { document } = parseHTML(html);
  const articles = Array.from(document.querySelectorAll("main article[data-testid='tweet']")).filter(
    (article) => !article.parentElement?.closest("article[data-testid='tweet']")
  );

  expect(articles.length).toBe(expectedKinds.length);

  const results = articles.map((article) => extractPostData(article as Element)?.kind ?? null);
  expect(results).toEqual(expectedKinds);
});

test("extractPostData prefers downloadable video URLs from data attributes over playlist-only candidates", () => {
  const { document } = parseHTML(`
    <main>
      <article data-testid="tweet">
        <a href="/user/status/2000">main</a>
        <div data-testid="videoComponent" data-playback-url="https://video.twimg.com/ext_tw_video/2000/pu/vid/avc1/main.mp4">
          <video>
            <source src="https://video.twimg.com/ext_tw_video/2000/master.m3u8" />
          </video>
        </div>
      </article>
    </main>
  `);

  const article = document.querySelector("article[data-testid='tweet']");
  expect(article).toBeTruthy();

  const data = extractPostData(article as Element);
  expect(data).toEqual({
    kind: "video",
    postUrl: "https://x.com/user/status/2000",
    videoUrl: "https://video.twimg.com/ext_tw_video/2000/pu/vid/avc1/main.mp4",
    playlistUrl: "https://video.twimg.com/ext_tw_video/2000/master.m3u8",
    blobUrl: undefined
  });
});
