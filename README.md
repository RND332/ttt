# TTT Browser Extension

A Chrome/Chromium extension that sends media from X posts to a Telegram channel with one click, using an editable caption prefix and an optional link to the original post.

## What it does
- Injects a media-aware button only on posts that contain media
- Supports media posts in feeds, individual post pages, and photo links (`/status/<id>/photo/<index>`)
- Detects video posts by real video containers, not preview frames
- Sends images using `sendPhoto` and photo albums using `sendMediaGroup`
- Sends videos by either downloading a direct X/Twitter video file URL or materializing an in-page blob-backed video in the browser, then uploading that file to Telegram with `sendVideo`
- For stream-backed MediaSource/HLS X videos, installs a MAIN-world discovery hook, recovers `video.twimg.com` MP4/HLS candidates from page/network state, and prefers recovered direct MP4 URLs before failing
- Resolves HLS playlists to direct MP4 variants when possible, and rejects unrecoverable stream-only / playlist-only cases with a clear error instead of routing through an external downloader
- Stores settings locally in the browser using `chrome.storage.local`
- Provides a minimal options page for bot token, channel ID, editable caption prefix, and an original-post link switch
- Remembers successfully sent X post IDs in a local IndexedDB database
- Shows an outlined send icon for new posts and an inactive check icon for already posted items
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

### Production build and distribution ZIP
```bash
bun run build
```

The build creates:
- `.addfox/dist/extension-chromium/` — unpacked extension
- `.addfox/dist/dist-chromium.zip` — distribution ZIP

Pushing a `v*` tag runs the release workflow: frozen install, tests, typecheck, production build, and ZIP upload to the GitHub release.

## Setup
1. Create a Telegram bot with @BotFather.
2. Add the bot as an admin to your target channel.
3. Get the channel ID or use the @channelusername.
4. Open the extension options page and save:
   - Bot Token
   - Channel ID
   - Caption prefix (leave empty for no prefix)
   - Include link to original post
   Settings save automatically; **Save changes** also saves immediately. Existing prefix-toggle preferences migrate to the editable field.

## Posted history
- Successful sends are stored by X post ID in the local `ttt-post-history` IndexedDB database using [idb-keyval](https://github.com/jakearchibald/idb-keyval).
- History is shared across tabs and channel changes in this browser profile. Sent buttons remain inactive after page reloads and extension service-worker restarts.
- Photo links and plain status links share the same post ID, so opening another image from an already sent post does not make it sendable again.
- Failed sends are not recorded and can be retried. Albums are recorded only after every group succeeds; retrying a partially sent album can resend its successful groups.
- Posts sent before this feature or from another browser are not imported. Clearing extension data or uninstalling the extension removes the local history.
- Telegram delivery and local persistence are not one atomic transaction: a shutdown after Telegram accepts a post but before its history is saved can leave it unrecorded.
- The send and sent icons reuse [Lucide](https://lucide.dev/icons/send) SVGs; their ISC notice is included in `public/icons/LICENSE-lucide.txt`.

## Notes
- This uses the Telegram Bot API directly from the extension.
- If X/Twitter changes its DOM, the selector logic may need updates.
- The extension only shows the button for posts with media.
- For video posts, the extension first uses browser-resolvable direct file URLs exposed by X/Twitter.
- If X only exposes a page-local `blob:` player source, the background installs a MAIN-world bridge with `chrome.scripting`, then the extension materializes that video in-browser before upload.
- If that blob-backed path turns out to be a stream-backed MediaSource/HLS player, the extension installs a MAIN-world stream discovery observer, collects recoverable `video.twimg.com` MP4/HLS candidates, and retries with recovered direct MP4 URLs.
- If a post only exposes playlist/HLS URLs such as `.m3u8`, the extension first tries to resolve a direct MP4 variant from that playlist; if none can be recovered, the send is rejected with a clear error.
- Set `localStorage.ttt-debug = 1` in the page console to log classification details.
