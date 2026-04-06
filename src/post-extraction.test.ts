import { expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { extractPostData } from "./post-extraction";

test("extractPostData ignores media inside quoted tweets", () => {
  const { document } = parseHTML(`
    <article>
      <a href="/user/status/111">main</a>
      <div data-testid="tweetPhoto">
        <img src="https://pbs.twimg.com/media/main.jpg" />
      </div>
      <div>
        <article>
          <a href="/quoted/status/222">quoted</a>
          <div data-testid="tweetPhoto">
            <img src="https://pbs.twimg.com/media/quoted.jpg" />
          </div>
        </article>
      </div>
    </article>
  `);

  const article = document.querySelector("article");
  expect(article).toBeTruthy();

  const data = extractPostData(article as Element);
  expect(data).toEqual({
    kind: "photo",
    mediaUrl: "https://pbs.twimg.com/media/main.jpg",
    postUrl: "https://x.com/user/status/111"
  });
});
