import { expect, test } from "vitest";
import { parseHTML } from "linkedom";
import { extractPostData } from "./post-extraction";

test("extractPostData ignores media inside quoted tweets", () => {
  const { document } = parseHTML(`
    <article>
      <a href="/user/status/111">main</a>
      <div data-testid="tweetPhoto">
        <img src="https://pbs.twimg.com/media/main.jpg" />
      </div>
      <blockquote>
        <div>
          <a href="/quoted/status/222">quoted</a>
          <div data-testid="tweetPhoto">
            <img src="https://pbs.twimg.com/media/quoted.jpg" />
          </div>
        </div>
      </blockquote>
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

test("extractPostData includes a direct video URL when the post exposes one", () => {
  const { document } = parseHTML(`
    <article>
      <a href="/user/status/777">main</a>
      <video src="https://video.twimg.com/ext_tw_video/777/pu/vid/avc1/main.mp4"></video>
    </article>
  `);

  const article = document.querySelector("article");
  expect(article).toBeTruthy();

  const data = extractPostData(article as Element);
  expect(data).toEqual({
    kind: "video",
    postUrl: "https://x.com/user/status/777",
    videoUrl: "https://video.twimg.com/ext_tw_video/777/pu/vid/avc1/main.mp4"
  });
});

test("extractPostData prefers the explicit video media route when the article exposes both status and video links", () => {
  const { document } = parseHTML(`
    <article>
      <a href="/user/status/778">status</a>
      <a href="/user/status/778/video/2">video route</a>
      <video src="https://video.twimg.com/ext_tw_video/778/pu/vid/avc1/main.mp4"></video>
    </article>
  `);

  const article = document.querySelector("article");
  expect(article).toBeTruthy();

  const data = extractPostData(article as Element);
  expect(data).toEqual({
    kind: "video",
    postUrl: "https://x.com/user/status/778/video/2",
    videoUrl: "https://video.twimg.com/ext_tw_video/778/pu/vid/avc1/main.mp4"
  });
});

test("extractPostData prefers mp4 source candidates over m3u8 playlists", () => {
  const { document } = parseHTML(`
    <article>
      <a href="/user/status/888">main</a>
      <video>
        <source src="https://video.twimg.com/ext_tw_video/888/master.m3u8" type="application/x-mpegURL" />
        <source src="https://video.twimg.com/ext_tw_video/888/pu/vid/avc1/main.mp4" type="video/mp4" />
      </video>
    </article>
  `);

  const article = document.querySelector("article");
  expect(article).toBeTruthy();

  const data = extractPostData(article as Element);
  expect(data).toEqual({
    kind: "video",
    postUrl: "https://x.com/user/status/888",
    videoUrl: "https://video.twimg.com/ext_tw_video/888/pu/vid/avc1/main.mp4",
    playlistUrl: "https://video.twimg.com/ext_tw_video/888/master.m3u8",
    blobUrl: undefined
  });
});

test("extractPostData falls back to data-playback-url on the media container", () => {
  const { document } = parseHTML(`
    <article>
      <a href="/user/status/999">main</a>
      <div data-testid="videoComponent" data-playback-url="https://video.twimg.com/ext_tw_video/999/pu/vid/avc1/main.mp4">
        <video></video>
      </div>
    </article>
  `);

  const article = document.querySelector("article");
  expect(article).toBeTruthy();

  const data = extractPostData(article as Element);
  expect(data).toEqual({
    kind: "video",
    postUrl: "https://x.com/user/status/999",
    videoUrl: "https://video.twimg.com/ext_tw_video/999/pu/vid/avc1/main.mp4"
  });
});

test("extractPostData ignores likely init fragments and segmented artifact urls when choosing a direct video candidate", () => {
  const { document } = parseHTML(`
    <article>
      <a href="/user/status/1001">main</a>
      <video>
        <source src="https://video.twimg.com/ext_tw_video/1001/pu/vid/avc1/init.mp4" type="video/mp4" />
        <source src="https://video.twimg.com/ext_tw_video/1001/pu/vid/avc1/chunk.m4s" type="video/mp4" />
        <source src="https://video.twimg.com/ext_tw_video/1001/pu/vid/avc1/main.mp4" type="video/mp4" />
      </video>
    </article>
  `);

  const article = document.querySelector("article");
  expect(article).toBeTruthy();

  const data = extractPostData(article as Element);
  expect(data).toEqual({
    kind: "video",
    postUrl: "https://x.com/user/status/1001",
    videoUrl: "https://video.twimg.com/ext_tw_video/1001/pu/vid/avc1/main.mp4"
  });
});

test("extractPostData leaves videoUrl undefined and preserves playlistUrl when only an HLS playlist is exposed", () => {
  const { document } = parseHTML(`
    <article>
      <a href="/user/status/1000">main</a>
      <video src="https://video.twimg.com/ext_tw_video/1000/master.m3u8"></video>
    </article>
  `);

  const article = document.querySelector("article");
  expect(article).toBeTruthy();

  const data = extractPostData(article as Element);
  expect(data).toEqual({
    kind: "video",
    postUrl: "https://x.com/user/status/1000",
    videoUrl: undefined,
    playlistUrl: "https://video.twimg.com/ext_tw_video/1000/master.m3u8"
  });
});

test("extractPostData preserves blob-backed video sources for content-side materialization", () => {
  const { document } = parseHTML(`
    <article>
      <a href="/user/status/2043460152318406656">main</a>
      <video>
        <source type="video/mp4" src="blob:https://x.com/d7115a17-e355-42fa-9827-3769e2daed43" />
      </video>
    </article>
  `);

  const article = document.querySelector("article");
  expect(article).toBeTruthy();

  const data = extractPostData(article as Element);
  expect(data).toEqual({
    kind: "video",
    postUrl: "https://x.com/user/status/2043460152318406656",
    videoUrl: undefined,
    blobUrl: "blob:https://x.com/d7115a17-e355-42fa-9827-3769e2daed43"
  });
});
