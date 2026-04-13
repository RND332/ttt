# TTT Browser Extension

A Chrome/Chromium extension that adds a button to X posts with media. Clicking it sends the post image or video and link to a Telegram channel.

## What it does
- Injects a media-aware button only on posts that contain media
- Detects video posts by real video containers, not preview frames
- Sends images directly to Telegram using `sendPhoto`
- Sends videos by either downloading a direct X/Twitter video file URL or materializing an in-page blob-backed video in the browser, then uploading that file to Telegram with `sendVideo`
- For stream-backed MediaSource/HLS X videos, installs a MAIN-world discovery hook, recovers `video.twimg.com` MP4/HLS candidates from page/network state, and prefers recovered direct MP4 URLs before failing
- Resolves HLS playlists to direct MP4 variants when possible, and rejects unrecoverable stream-only / playlist-only cases with a clear error instead of routing through an external downloader
- Stores settings locally in the browser using `chrome.storage.local`
- Provides an options page for bot token, channel ID, and caption behavior
- Built with AddFox, so `bun run dev` gives you extension HMR during local development
- Includes a debug toggle via `localStorage.ttt-debug = 1`

## Development with HMR
This extension uses AddFox for local development.

### Install
```bash
bun install
```

### Dev mode with hot reload
```bash
bun run dev
```

### TypeScript checks
```bash
bun run typecheck
```

### Tests
```bash
bun run test
```

Vitest conventions in this repo:
- Tests live next to source files as `*.test.ts`
- Default environment is `node`
- Use `// @vitest-environment jsdom` only for tests that need a browser DOM
- Mocks are cleared/restored automatically after each test
- Prefer explicit `vitest` imports over globals
- Keep tests deterministic: no shared mutable state between tests
- Use table-driven tests (`test.each`) when covering variants
- Put fixture HTML under `mocks/` and reuse it through `src/test/fixtures.ts`

### Production build
```bash
bun run build
```

### Zip for distribution
```bash
bun run zip
```

## Setup
1. Create a Telegram bot with @BotFather.
2. Add the bot as an admin to your target channel.
3. Get the channel ID or use the @channelusername.
4. Open the extension options page and save:
   - Bot Token
   - Channel ID
   - Caption prefix toggle

## Notes
- This uses the Telegram Bot API directly from the extension.
- If X/Twitter changes its DOM, the selector logic may need updates.
- The extension only shows the button for posts with media.
- For video posts, the extension first uses browser-resolvable direct file URLs exposed by X/Twitter.
- If X only exposes a page-local `blob:` player source, the background installs a MAIN-world bridge with `chrome.scripting`, then the extension materializes that video in-browser before upload.
- If that blob-backed path turns out to be a stream-backed MediaSource/HLS player, the extension installs a MAIN-world stream discovery observer, collects recoverable `video.twimg.com` MP4/HLS candidates, and retries with recovered direct MP4 URLs.
- If a post only exposes playlist/HLS URLs such as `.m3u8`, the extension first tries to resolve a direct MP4 variant from that playlist; if none can be recovered, the send is rejected with a clear error.
- Set `localStorage.ttt-debug = 1` in the page console to log classification details.
