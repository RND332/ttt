import { afterEach, describe, expect, test, vi } from "vitest";
import {
  downloadHlsVideo,
  parseHlsMasterPlaylist,
  resolveHlsVideoDownloadUrl,
  UNSUPPORTED_SEGMENTED_HLS_ERROR,
} from "./hls-video-download";

afterEach(() => {
  vi.restoreAllMocks();
});

function createValidMp4Bytes() {
  return new Uint8Array([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x00, 0x01,
    0x69, 0x73, 0x6f, 0x6d,
    0x61, 0x76, 0x63, 0x31
  ]);
}

describe("parseHlsMasterPlaylist", () => {
  test("parses stream variants and resolves relative URLs against the master playlist", () => {
    const variants = parseHlsMasterPlaylist(
      `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360,CODECS="avc1.4d001f,mp4a.40.2"
../360p/video.mp4?tag=9
#EXT-X-STREAM-INF:BANDWIDTH=2176000,RESOLUTION=1280x720
720p/index.m3u8
`,
      "https://video.twimg.com/ext_tw_video/123/playlist/master.m3u8?token=abc"
    );

    expect(variants).toEqual([
      {
        kind: "direct-mp4",
        uri: "../360p/video.mp4?tag=9",
        url: "https://video.twimg.com/ext_tw_video/123/360p/video.mp4?tag=9",
        bandwidth: 832000,
        codecs: "avc1.4d001f,mp4a.40.2",
        resolution: { width: 640, height: 360 },
      },
      {
        kind: "hls-playlist",
        uri: "720p/index.m3u8",
        url: "https://video.twimg.com/ext_tw_video/123/playlist/720p/index.m3u8",
        bandwidth: 2176000,
        codecs: null,
        resolution: { width: 1280, height: 720 },
      },
    ]);
  });
});

describe("resolveHlsVideoDownloadUrl", () => {
  test("prefers a direct mp4 variant exposed by the master playlist", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2176000,RESOLUTION=1280x720
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
../360p/video.mp4
`,
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveHlsVideoDownloadUrl("https://video.twimg.com/ext_tw_video/555/playlist/master.m3u8")
    ).resolves.toBe("https://video.twimg.com/ext_tw_video/555/360p/video.mp4");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://video.twimg.com/ext_tw_video/555/playlist/master.m3u8",
      { credentials: "omit" }
    );
  });

  test("fails clearly when the playlist only exposes segmented stream variants", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2176000,RESOLUTION=1280x720
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
360p/index.m3u8
`,
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveHlsVideoDownloadUrl("https://video.twimg.com/ext_tw_video/555/playlist/master.m3u8")
    ).rejects.toThrow(UNSUPPORTED_SEGMENTED_HLS_ERROR);
  });

  test("fails clearly for a segmented media playlist that would require assembly or remux", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6,
chunk-00001.ts
#EXTINF:6,
chunk-00002.ts
#EXT-X-ENDLIST
`,
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveHlsVideoDownloadUrl("https://video.twimg.com/ext_tw_video/555/playlist/video.m3u8")
    ).rejects.toThrow(UNSUPPORTED_SEGMENTED_HLS_ERROR);
  });
});

describe("downloadHlsVideo", () => {
  test("downloads the resolved direct mp4 variant", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("master.m3u8")) {
        return new Response(
          `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=832000,RESOLUTION=640x360
../360p/video.mp4
`,
          { status: 200 }
        );
      }

      return new Response(createValidMp4Bytes(), {
        status: 200,
        headers: {
          "content-type": "video/mp4"
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadHlsVideo(
      "https://video.twimg.com/ext_tw_video/999/playlist/master.m3u8",
      "tweet-video.mp4"
    );

    expect(result.filename).toBe("tweet-video.mp4");
    expect(result.blob.size).toBe(createValidMp4Bytes().length);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://video.twimg.com/ext_tw_video/999/playlist/master.m3u8",
      { credentials: "omit" }
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://video.twimg.com/ext_tw_video/999/360p/video.mp4",
      { credentials: "omit" }
    );
  });
});
