import { afterEach, describe, expect, test, vi } from "vitest";

describe("page twitter video resolver installer", () => {
  const originalWindow = (globalThis as any).window;
  const originalFetch = globalThis.fetch;
  const originalDocument = (globalThis as any).document;
  const originalLocation = (globalThis as any).location;

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    globalThis.fetch = originalFetch;
    (globalThis as any).document = originalDocument;
    (globalThis as any).location = originalLocation;
    vi.restoreAllMocks();
  });

  test("ensurePageTwitterVideoResolverInstalled injects the resolver in the MAIN world", async () => {
    const executeScript = vi.fn(async () => [{ result: undefined }]);
    const chromeMock = {
      scripting: { executeScript }
    } as any;

    const {
      ensurePageTwitterVideoResolverInstalled,
      TTT_PAGE_TWITTER_VIDEO_REQUEST,
      TTT_PAGE_TWITTER_VIDEO_RESPONSE
    } = await import("./page-twitter-video-resolver-install");

    await ensurePageTwitterVideoResolverInstalled(chromeMock, { tabId: 7, frameIds: [3] });

    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 7, frameIds: [3] },
      world: "MAIN",
      func: expect.any(Function),
      args: expect.arrayContaining([TTT_PAGE_TWITTER_VIDEO_REQUEST, TTT_PAGE_TWITTER_VIDEO_RESPONSE])
    }));
  });

  test("ensurePageTwitterVideoResolverInstalled uses authenticated page fetch headers for tweet results", async () => {
    const executeScript = vi.fn(async () => [{ result: undefined }]);
    const chromeMock = {
      scripting: { executeScript }
    } as any;

    const {
      ensurePageTwitterVideoResolverInstalled,
      TTT_PAGE_TWITTER_VIDEO_REQUEST,
      TTT_PAGE_TWITTER_VIDEO_RESPONSE
    } = await import("./page-twitter-video-resolver-install");

    await ensurePageTwitterVideoResolverInstalled(chromeMock, { tabId: 7 });

    const injection = executeScript.mock.calls[0][0];
    const listeners = new Map<string, EventListener[]>();
    const fakeWindow = {
      addEventListener: vi.fn((type: string, handler: EventListener) => {
        listeners.set(type, [...(listeners.get(type) || []), handler]);
      }),
      postMessage: vi.fn(),
      __tttPageTwitterVideoResolverInstalled: false
    } as any;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: {
        tweetResult: {
          result: {
            rest_id: "2013426523601019141"
          }
        }
      }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    (globalThis as any).window = fakeWindow;
    globalThis.fetch = fetchMock as any;
    (globalThis as any).document = {
      cookie: "ct0=csrf-token; auth_token=session-token",
      documentElement: { lang: "en" }
    };
    (globalThis as any).location = { origin: "https://x.com" };

    injection.func(...injection.args);

    const handlers = listeners.get("message") || [];
    await Promise.all(handlers.map((handler) => handler({
      data: {
        type: TTT_PAGE_TWITTER_VIDEO_REQUEST,
        requestId: "req-1",
        tweetId: "2013426523601019141"
      },
      source: fakeWindow
    } as any)));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/i/api/graphql/tmhPpO5sDermwYmq3h034A/TweetResultByRestId"),
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({
          authorization: expect.stringContaining("Bearer "),
          "x-csrf-token": "csrf-token",
          "x-twitter-auth-type": "OAuth2Session",
          "x-twitter-active-user": "yes",
          "x-twitter-client-language": "en"
        })
      })
    );
    expect(fakeWindow.postMessage).toHaveBeenCalledWith({
      type: TTT_PAGE_TWITTER_VIDEO_RESPONSE,
      requestId: "req-1",
      ok: true,
      payload: {
        data: {
          tweetResult: {
            result: {
              rest_id: "2013426523601019141"
            }
          }
        }
      }
    }, "*");
  });
});
