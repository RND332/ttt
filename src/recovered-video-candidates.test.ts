import { expect, test } from "vitest";
import type { RecoveredVideoCandidate } from "./shared";
import {
  createRecoveredVideoCandidateStore,
  getBestRecoveredVideoCandidate,
  mergeRecoveredVideoCandidates
} from "./recovered-video-candidates";

test("recovered video candidate store records and returns candidates by tab and normalized post URL", () => {
  const store = createRecoveredVideoCandidateStore();
  const candidates: RecoveredVideoCandidate[] = [
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/main.mp4",
      bitrate: 832000,
      source: "page-fetch",
      mimeType: "video/mp4"
    },
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/main.mp4",
      bitrate: 832000,
      source: "page-fetch",
      mimeType: "video/mp4"
    },
    {
      kind: "hls-playlist",
      url: "https://video.twimg.com/ext_tw_video/123/pl/main.m3u8",
      source: "page-xhr",
      mimeType: "application/x-mpegURL"
    }
  ];

  const stored = store.record(44, "https://x.com/user/status/123?src=foo#bar", candidates);

  expect(stored).toBe(2);
  expect(store.get(44, "https://x.com/user/status/123")).toEqual([
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/main.mp4",
      bitrate: 832000,
      source: "page-fetch",
      mimeType: "video/mp4"
    },
    {
      kind: "hls-playlist",
      url: "https://video.twimg.com/ext_tw_video/123/pl/main.m3u8",
      source: "page-xhr",
      mimeType: "application/x-mpegURL"
    }
  ]);
});

test("recovered video candidate store can merge candidates for the same post without dropping existing playable URLs", () => {
  const store = createRecoveredVideoCandidateStore();

  store.record(44, "https://x.com/user/status/123", [
    {
      kind: "hls-playlist",
      url: "https://video.twimg.com/ext_tw_video/123/pl/master.m3u8",
      source: "webRequest"
    }
  ]);

  const stored = store.record(44, "https://x.com/user/status/123", [
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/main.mp4",
      source: "page-fetch"
    }
  ], { merge: true });

  expect(stored).toBe(2);
  expect(store.get(44, "https://x.com/user/status/123")).toEqual([
    {
      kind: "hls-playlist",
      url: "https://video.twimg.com/ext_tw_video/123/pl/master.m3u8",
      source: "webRequest"
    },
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/main.mp4",
      source: "page-fetch"
    }
  ]);
});

test("recovered video candidate store preserves video media-route indexes while normalizing domain and query noise", () => {
  const store = createRecoveredVideoCandidateStore();

  store.record(44, "https://twitter.com/user/status/123/video/1?src=share", [
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/main.mp4",
      source: "page-fetch"
    }
  ]);

  expect(store.get(44, "https://x.com/user/status/123/video/1")).toEqual([
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/main.mp4",
      source: "page-fetch"
    }
  ]);
  expect(store.get(44, "https://x.com/user/status/123")).toEqual([]);
  expect(store.get(44, "https://x.com/user/status/123/video/2")).toEqual([]);
});

test("recovered video candidate store isolates records by tab", () => {
  const store = createRecoveredVideoCandidateStore();

  store.record(1, "https://x.com/user/status/999", [
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/999/pu/vid/avc1/tab-1.mp4"
    }
  ]);

  store.record(2, "https://x.com/user/status/999", [
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/999/pu/vid/avc1/tab-2.mp4"
    }
  ]);

  expect(store.get(1, "https://x.com/user/status/999")).toEqual([
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/999/pu/vid/avc1/tab-1.mp4"
    }
  ]);
  expect(store.get(2, "https://x.com/user/status/999")).toEqual([
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/999/pu/vid/avc1/tab-2.mp4"
    }
  ]);
  expect(store.get(3, "https://x.com/user/status/999")).toEqual([]);
});

test("mergeRecoveredVideoCandidates dedupes duplicate URLs across sources while preserving order", () => {
  const merged = mergeRecoveredVideoCandidates(
    [
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/555/pu/vid/avc1/main.mp4",
        source: "page-fetch"
      },
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/555/pl/master.m3u8",
        source: "webRequest"
      }
    ],
    [
      {
        kind: "hls-playlist",
        url: "https://video.twimg.com/ext_tw_video/555/pl/master.m3u8",
        source: "page-xhr"
      },
      {
        kind: "direct-mp4",
        url: "https://video.twimg.com/ext_tw_video/555/pu/vid/avc1/backup.mp4",
        source: "webRequest"
      }
    ]
  );

  expect(merged).toEqual([
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/555/pu/vid/avc1/main.mp4",
      source: "page-fetch"
    },
    {
      kind: "hls-playlist",
      url: "https://video.twimg.com/ext_tw_video/555/pl/master.m3u8",
      source: "webRequest"
    },
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/555/pu/vid/avc1/backup.mp4",
      source: "webRequest"
    }
  ]);
});

test("getBestRecoveredVideoCandidate prefers direct mp4 candidates over HLS and higher bitrates", () => {
  const best = getBestRecoveredVideoCandidate([
    {
      kind: "hls-playlist",
      url: "https://video.twimg.com/ext_tw_video/777/pl/main.m3u8",
      bitrate: 500000
    },
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/777/pu/vid/avc1/low.mp4",
      bitrate: 320000
    },
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/777/pu/vid/avc1/high.mp4",
      bitrate: 832000
    }
  ]);

  expect(best).toEqual({
    kind: "direct-mp4",
    url: "https://video.twimg.com/ext_tw_video/777/pu/vid/avc1/high.mp4",
    bitrate: 832000
  });
});

test("getBestRecoveredVideoCandidate prefers tweet-json direct mp4 over higher-bitrate heuristic direct candidates", () => {
  const best = getBestRecoveredVideoCandidate([
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/778/pu/vid/avc1/heuristic-high.mp4",
      bitrate: 2176000,
      source: "page-fetch"
    },
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/778/pu/vid/avc1/authoritative.mp4",
      bitrate: 832000,
      source: "tweet-json"
    }
  ]);

  expect(best).toEqual({
    kind: "direct-mp4",
    url: "https://video.twimg.com/ext_tw_video/778/pu/vid/avc1/authoritative.mp4",
    bitrate: 832000,
    source: "tweet-json"
  });
});

test("getBestRecoveredVideoCandidate ignores likely init fragments and segment artifacts", () => {
  const best = getBestRecoveredVideoCandidate([
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/777/pu/vid/avc1/init.mp4",
      bitrate: 999999
    },
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/777/pu/vid/avc1/high.mp4",
      bitrate: 832000
    },
    {
      kind: "direct-mp4",
      url: "https://video.twimg.com/ext_tw_video/777/pu/vid/avc1/chunk.m4s",
      bitrate: 2000000
    }
  ]);

  expect(best).toEqual({
    kind: "direct-mp4",
    url: "https://video.twimg.com/ext_tw_video/777/pu/vid/avc1/high.mp4",
    bitrate: 832000
  });
});

test("getBestRecoveredVideoCandidate returns null when there are no candidates", () => {
  expect(getBestRecoveredVideoCandidate([])).toBeNull();
});
