# TTT Browser Extension

A Chrome/Chromium extension that adds a button to X posts with media. Clicking it sends the post image or video and link to a Telegram channel.

## What it does
- Injects a media-aware button only on posts that contain media
- Detects video posts by real video containers, not preview frames
- Sends images directly to Telegram using `sendPhoto`
- Sends videos by sending the post URL to Cobalt, downloading the resolved file, then uploading it to Telegram with `sendVideo`
- Stores settings locally in the browser using `chrome.storage.local`
- Provides an options page for bot token, channel ID, Cobalt API URL, Cobalt auth token, auth scheme, and video quality
- Requests access to custom Cobalt hosts only when you test or use them
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
   - Cobalt API URL
   - Cobalt Auth Token if needed
   - Cobalt Auth Scheme (`Bearer` or `Api-Key`)
   - Video quality
   - Caption prefix toggle
5. If you use a custom Cobalt host, confirm the browser permission prompt the first time you test or send a video.

## Notes
- This uses the Telegram Bot API directly from the extension.
- If X/Twitter changes its DOM, the selector logic may need updates.
- The extension only shows the button for posts with media.
- For video posts, Cobalt is used as the downloader engine.
- Custom Cobalt URLs may use either HTTP or HTTPS.
- Set `localStorage.ttt-debug = 1` in the page console to log classification details.
