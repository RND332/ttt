import { expect, test } from "vitest";
import { parseHTML } from "linkedom";
import { extractPostData } from "./post-extraction";

test("extractPostData ignores quoted media in the same article when counting multiple photos", () => {
  const { document } = parseHTML(`
    <article>
      <a href="/user/status/333">main</a>
      <div data-testid="tweetPhoto">
        <img src="https://pbs.twimg.com/media/main-1.jpg" />
      </div>
      <div data-testid="tweetPhoto">
        <img src="https://pbs.twimg.com/media/main-2.jpg" />
      </div>
      <blockquote>
        <article>
          <a href="/quoted/status/444">quoted</a>
          <div data-testid="tweetPhoto">
            <img src="https://pbs.twimg.com/media/quoted-1.jpg" />
          </div>
          <div data-testid="tweetPhoto">
            <img src="https://pbs.twimg.com/media/quoted-2.jpg" />
          </div>
        </article>
      </blockquote>
    </article>
  `);

  const article = document.querySelector("article");
  expect(article).toBeTruthy();

  const data = extractPostData(article as Element);
  expect(data).toEqual({
    kind: "photo-album",
    mediaUrls: [
      "https://pbs.twimg.com/media/main-1.jpg",
      "https://pbs.twimg.com/media/main-2.jpg"
    ],
    postUrl: "https://x.com/user/status/333"
  });
});

test("extractPostData ignores quoted images when the main post is a video", () => {
  const { document } = parseHTML(`
    <article>
      <a href="/user/status/555">main</a>
      <video src="https://video.twimg.com/ext_tw_video/main.mp4"></video>
      <blockquote>
        <article>
          <a href="/quoted/status/666">quoted</a>
          <div data-testid="tweetPhoto">
            <img src="https://pbs.twimg.com/media/quoted-video-context.jpg" />
          </div>
        </article>
      </blockquote>
    </article>
  `);

  const article = document.querySelector("article");
  expect(article).toBeTruthy();

  const data = extractPostData(article as Element);
  expect(data).toEqual({
    kind: "video",
    postUrl: "https://x.com/user/status/555"
  });
});
