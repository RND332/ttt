import { expect, test } from "vitest";
import {
  normalizeRecoveredVideoUrl,
  rankRecoveredVideoCandidates,
  toRecoveredVideoCandidate
} from "./page-stream-video-discovery-shared";

test("normalizeRecoveredVideoUrl only accepts http video.twimg.com URLs", () => {
  expect(normalizeRecoveredVideoUrl(" https://video.twimg.com/ext_tw_video/42/pu/vid/avc1/main.mp4?tag=12 ")).toBe(
    "https://video.twimg.com/ext_tw_video/42/pu/vid/avc1/main.mp4?tag=12"
  );
  expect(normalizeRecoveredVideoUrl("https://pbs.twimg.com/media/not-video.jpg")).toBeNull();
  expect(normalizeRecoveredVideoUrl("javascript:alert(1)")).toBeNull();
});

test("toRecoveredVideoCandidate classifies direct and hls stream URLs", () => {
  expect(toRecoveredVideoCandidate("https://video.twimg.com/ext_tw_video/42/master.m3u8", "page-xhr")).toEqual({
    kind: "hls-playlist",
    url: "https://video.twimg.com/ext_tw_video/42/master.m3u8",
    source: "page-xhr"
  });

  expect(toRecoveredVideoCandidate("https://video.twimg.com/ext_tw_video/42/pu/vid/avc1/main.mp4", "page-fetch")).toEqual({
    kind: "direct-mp4",
    url: "https://video.twimg.com/ext_tw_video/42/pu/vid/avc1/main.mp4",
    source: "page-fetch"
  });

  expect(toRecoveredVideoCandidate("https://video.twimg.com/ext_tw_video/42/thumb.jpg", "performance")).toBeNull();
});

test("toRecoveredVideoCandidate rejects likely init fragments and segment artifacts", () => {
  expect(toRecoveredVideoCandidate("https://video.twimg.com/ext_tw_video/42/pu/vid/avc1/init.mp4", "page-fetch")).toBeNull();
  expect(toRecoveredVideoCandidate("https://video.twimg.com/ext_tw_video/42/pu/vid/avc1/chunk.m4s", "page-fetch")).toBeNull();
  expect(toRecoveredVideoCandidate("https://video.twimg.com/ext_tw_video/42/pu/vid/avc1/segment.ts", "page-fetch")).toBeNull();
});

test("rankRecoveredVideoCandidates prioritizes kind, then source, then url", () => {
  expect(rankRecoveredVideoCandidates([
    {
      kind: "hls-playlist",
      url: "https://video.twimg.com/ext_tw_video/42/z-playlist.m3u8",
      source: "page-fetch"
    },
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/42/z-fetch.mp4",
      source: "page-fetch"
    },
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/42/a-xhr.mp4",
      source: "page-xhr"
    },
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/42/b-performance.mp4",
      source: "performance"
    }
  ])).toEqual([
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/42/z-fetch.mp4",
      source: "page-fetch"
    },
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/42/a-xhr.mp4",
      source: "page-xhr"
    },
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/42/b-performance.mp4",
      source: "performance"
    },
    {
      kind: "hls-playlist",
      url: "https://video.twimg.com/ext_tw_video/42/z-playlist.m3u8",
      source: "page-fetch"
    }
  ]);
});
