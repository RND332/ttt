import { afterEach, expect, test, vi } from "vitest";
import {
  BROWSER_VIDEO_FETCH_FAILED_ERROR,
  BROWSER_VIDEO_INVALID_FILE_ERROR,
  downloadBrowserVideo
} from "./browser-video-download";

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

function createNonMp4VideoBytes() {
  return new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3,
    0x9f, 0x42, 0x86, 0x81,
    0x01, 0x42, 0xf7, 0x81,
    0x01, 0x42, 0xf2, 0x81,
    0x04, 0x42, 0xf3, 0x81,
    0x08, 0x42, 0x82, 0x84,
    0x77, 0x65, 0x62, 0x6d
  ]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("downloadBrowserVideo accepts valid MP4 bytes with an ftyp signature", async () => {
  const fetchMock = vi.fn(async () => new Response(createValidMp4Bytes(), {
    status: 200,
    headers: {
      "content-type": "video/mp4"
    }
  }));
  vi.stubGlobal("fetch", fetchMock);

  const result = await downloadBrowserVideo(
    "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/example.mp4",
    "clip.mp4"
  );

  expect(fetchMock).toHaveBeenCalledWith(
    "https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/example.mp4",
    { credentials: "omit" }
  );
  expect(result.filename).toBe("clip.mp4");
  expect(result.blob).toBeInstanceOf(Blob);
  expect(result.blob.size).toBe(createValidMp4Bytes().length);
});

test("downloadBrowserVideo falls back to the filename from the URL path", async () => {
  const fetchMock = vi.fn(async () => new Response(createValidMp4Bytes(), {
    status: 200,
    headers: {
      "content-type": "video/mp4"
    }
  }));
  vi.stubGlobal("fetch", fetchMock);

  const result = await downloadBrowserVideo("https://video.twimg.com/ext_tw_video/example-video.mp4?tag=12");

  expect(result.filename).toBe("example-video.mp4");
});

test("downloadBrowserVideo rejects HTML or JSON bodies returned with status 200", async () => {
  const fetchMock = vi.fn(async () => new Response("<html>blocked</html>", {
    status: 200,
    headers: {
      "content-type": "text/html"
    }
  }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(downloadBrowserVideo("https://video.twimg.com/ext_tw_video/not-video.mp4")).rejects.toThrow(
    BROWSER_VIDEO_INVALID_FILE_ERROR
  );

  vi.restoreAllMocks();

  const jsonFetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  }));
  vi.stubGlobal("fetch", jsonFetchMock);

  await expect(downloadBrowserVideo("https://video.twimg.com/ext_tw_video/not-video.mp4")).rejects.toThrow(
    BROWSER_VIDEO_INVALID_FILE_ERROR
  );
});

test("downloadBrowserVideo rejects tiny MP4-like blobs without an ftyp signature", async () => {
  const fetchMock = vi.fn(async () => new Response(new Uint8Array([0x00, 0x00, 0x00, 0x08, 0x6d, 0x6f, 0x6f, 0x76]), {
    status: 200,
    headers: {
      "content-type": "video/mp4"
    }
  }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(downloadBrowserVideo("https://video.twimg.com/ext_tw_video/truncated.mp4")).rejects.toThrow(
    BROWSER_VIDEO_INVALID_FILE_ERROR
  );
});

test("downloadBrowserVideo accepts an extensionless URL when content-type is video/mp4 and bytes have an ftyp signature", async () => {
  const fetchMock = vi.fn(async () => new Response(createValidMp4Bytes(), {
    status: 200,
    headers: {
      "content-type": "video/mp4"
    }
  }));
  vi.stubGlobal("fetch", fetchMock);

  const result = await downloadBrowserVideo("https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/signed-download?token=abc");

  expect(result.filename).toBe("signed-download");
  expect(result.blob.size).toBe(createValidMp4Bytes().length);
});

test("downloadBrowserVideo rejects an extensionless URL when content-type is video/mp4 but bytes have no ftyp signature", async () => {
  const fetchMock = vi.fn(async () => new Response(createNonMp4VideoBytes(), {
    status: 200,
    headers: {
      "content-type": "video/mp4"
    }
  }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(downloadBrowserVideo("https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/signed-download?token=abc")).rejects.toThrow(
    BROWSER_VIDEO_INVALID_FILE_ERROR
  );
});

test("downloadBrowserVideo rejects video/webm responses for this helper", async () => {
  const fetchMock = vi.fn(async () => new Response(createNonMp4VideoBytes(), {
    status: 200,
    headers: {
      "content-type": "video/webm"
    }
  }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(downloadBrowserVideo("https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/example.mp4")).rejects.toThrow(
    BROWSER_VIDEO_INVALID_FILE_ERROR
  );
});

test("downloadBrowserVideo accepts application/octet-stream when bytes have an ftyp signature", async () => {
  const fetchMock = vi.fn(async () => new Response(createValidMp4Bytes(), {
    status: 200,
    headers: {
      "content-type": "application/octet-stream"
    }
  }));
  vi.stubGlobal("fetch", fetchMock);

  const result = await downloadBrowserVideo("https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/signed-download?token=abc");

  expect(result.blob.size).toBe(createValidMp4Bytes().length);
});

test("downloadBrowserVideo throws a useful error when the fetch returns a non-ok status", async () => {
  const fetchMock = vi.fn(async () => new Response("nope", { status: 403 }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(downloadBrowserVideo("https://video.twimg.com/ext_tw_video/blocked.mp4")).rejects.toThrow(
    "Failed to download video file: 403"
  );
});

test("downloadBrowserVideo maps raw fetch failures to a clearer browser video download error", async () => {
  const fetchMock = vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(downloadBrowserVideo("https://video.twimg.com/ext_tw_video/network-failure.mp4")).rejects.toThrow(
    BROWSER_VIDEO_FETCH_FAILED_ERROR
  );
});
