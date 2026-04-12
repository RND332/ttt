import { expect, test } from "vitest";
import { parseHTML } from "linkedom";
import { extractPostData } from "./post-extraction";
import { loadMockHtml } from "./test/fixtures";

type FixtureCase = {
  name: string;
  path: string;
  expectedKinds: Array<"photo" | "video" | null>;
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
] as const;

test.each(cases)("extractPostData classifies %s", async ({ path, expectedKinds }) => {
  const html = await loadMockHtml(path);
  const { document } = parseHTML(html);
  const articles = Array.from(document.querySelectorAll("article[data-testid='tweet']"));

  expect(articles.length).toBe(expectedKinds.length);

  const results = articles.map((article) => extractPostData(article as Element)?.kind ?? null);
  expect(results).toEqual(expectedKinds);
});
