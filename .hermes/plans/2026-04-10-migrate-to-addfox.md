# TTT → AddFox Migration Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Migrate the current WXT-based X/Twitter-to-Telegram browser extension to AddFox with the same user-facing behavior, cleaner entry structure, and AddFox-native build/config flow.

**Architecture:**
Move from WXT entrypoints to AddFox’s convention-based `app/` layout. Keep the existing runtime logic mostly intact at first: background message handling stays in a service worker, content extraction stays in a content script, and the settings page stays a simple DOM-based options page. Replace WXT config with `addfox.config.ts`, migrate manifest/permissions into AddFox config, and keep shared logic in a small reusable module set so the migration is mechanical rather than risky.

**Tech Stack:**
AddFox, Rsbuild, TypeScript, Chrome MV3, Chrome storage/runtime APIs, Telegram Bot API, Cobalt API.

---

## Migration strategy

1. Preserve behavior first, polish later.
2. Move files into AddFox’s expected entry paths.
3. Swap build tooling and manifest generation.
4. Verify the extension still sends photos, albums, and videos correctly.
5. Remove WXT-only files once AddFox build is green.

---

### Task 1: Freeze current behavior and map source files

**Objective:** Create a clear file-to-file migration map so nothing gets lost during the rewrite.

**Files:**
- Read: `README.md`
- Read: `wxt.config.ts`
- Read: `entrypoints/background.ts`
- Read: `entrypoints/content.ts`
- Read: `entrypoints/settings.html`
- Read: `src/shared.ts`
- Read: `src/post-extraction.ts`
- Read: `src/options-ui.ts`
- Read: `src/post-extraction.test.ts`

**Steps:**
1. Record every feature that must survive migration: local settings, media detection, photo send, album send, video send via Cobalt, auth testing, debug toggle.
2. Map current WXT entrypoints to AddFox entries:
   - `entrypoints/background.ts` → `app/background/index.ts`
   - `entrypoints/content.ts` → `app/content/index.ts`
   - `entrypoints/settings.html` + `src/options-ui.ts` → `app/options/index.html` + `app/options/index.ts`
3. Note current manifest requirements:
   - permissions: `storage`, `activeTab`, `tabs`, `permissions`
   - host permissions: `https://x.com/*`, `https://twitter.com/*`, `https://api.telegram.org/*`
   - optional host permissions for custom Cobalt URLs
4. Note all shared logic that can stay where it is for now:
   - `src/shared.ts`
   - `src/post-extraction.ts`
5. Decide whether to keep the DOM-based options UI or convert it to a framework component. For the first migration pass, keep it DOM-based.

**Verification:**
- Migration map is written and all files are accounted for.
- No behavior is marked “optional” unless the current app already treats it that way.

---

### Task 2: Introduce AddFox config and app layout

**Objective:** Replace WXT configuration with AddFox configuration and create the new AddFox entry folders.

**Files:**
- Create: `addfox.config.ts`
- Create: `app/background/index.ts`
- Create: `app/content/index.ts`
- Create: `app/options/index.html`
- Create: `app/options/index.ts`
- Keep: `src/shared.ts`
- Keep: `src/post-extraction.ts`

**Steps:**
1. Create `addfox.config.ts` with the core manifest fields.
2. Move the manifest data from `wxt.config.ts` into AddFox config.
3. Set the app source directory to AddFox defaults unless there is a strong reason not to.
4. Create `app/background/index.ts` by copying the current background logic.
5. Create `app/content/index.ts` by copying the current content-script logic.
6. Create `app/options/index.html` that loads `app/options/index.ts` as the page entry.
7. Make the options page import and reuse `src/options-ui.ts` or consolidate that code into `app/options/index.ts`.
8. Leave `src/shared.ts` and `src/post-extraction.ts` in place until the build is green.

**Suggested `addfox.config.ts` shape:**
```ts
import { defineConfig } from "addfox";

export default defineConfig({
  manifest: {
    name: "TTT",
    version: "1.0.0",
    description: "Sends X post media to Telegram with one click.",
    permissions: ["storage", "activeTab", "tabs", "permissions"],
    host_permissions: [
      "https://x.com/*",
      "https://twitter.com/*",
      "https://api.telegram.org/*"
    ],
    optional_host_permissions: [
      "https://*/*",
      "http://*/*",
      "http://localhost/*",
      "http://127.0.0.1/*"
    ],
    action: { default_title: "TTT" },
    options_ui: { page: "options/index.html", open_in_tab: true },
    icons: {
      16: "icons/icon16.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png"
    }
  }
});
```

**Verification:**
- AddFox recognizes all entries without extra wiring.
- The manifest produced by the build contains the same permissions as before.
- The options page opens successfully.

---

### Task 3: Rewire the options page for AddFox

**Objective:** Make the settings UI work as an AddFox options entry without changing user-facing behavior.

**Files:**
- Modify/Create: `app/options/index.html`
- Modify/Create: `app/options/index.ts`
- Optionally remove later: `entrypoints/settings.html`
- Optionally remove later: `src/options-ui.ts`

**Steps:**
1. Move the existing settings HTML into `app/options/index.html`.
2. Keep the same element IDs so the UI logic stays intact.
3. Update the script loading path to point at the AddFox entry script.
4. Port the logic from `src/options-ui.ts` into `app/options/index.ts` or import it directly if AddFox bundling allows it cleanly.
5. Verify storage still uses `chrome.storage.local` only.
6. Confirm the Cobalt auth test button still triggers the same runtime message and permission flow.

**Verification:**
- Saving settings writes the same keys as before.
- The “Test Cobalt auth” flow still surfaces browser permission prompts for custom hosts.
- Reloading the options page restores saved values.

---

### Task 4: Keep the content script behavior identical

**Objective:** Preserve post detection and button injection with minimal code changes.

**Files:**
- Modify/Create: `app/content/index.ts`
- Keep: `src/post-extraction.ts`
- Keep: `src/shared.ts`

**Steps:**
1. Copy the current content-script code into `app/content/index.ts`.
2. Keep the `article` scan, mutation observer, and button injection logic unchanged for the first pass.
3. Keep the same X/Twitter match patterns in the manifest.
4. Ensure `extractPostData` still returns the same payload shapes.
5. Only refactor selector logic after the migration is stable.

**Verification:**
- The send button appears on photo posts, albums, and video posts.
- Duplicate buttons are not injected on repeated DOM mutations.
- Debug logging still works with `localStorage.ttt-debug = 1`.

---

### Task 5: Keep the background worker behavior identical

**Objective:** Preserve message handling and Telegram/Cobalt networking in the new framework.

**Files:**
- Modify/Create: `app/background/index.ts`
- Keep: `src/shared.ts`

**Steps:**
1. Copy the current background code into `app/background/index.ts`.
2. Keep `SEND_TO_TELEGRAM` and `TEST_COBALT_AUTH` message handling unchanged.
3. Keep local settings bootstrap on install.
4. Keep the Cobalt download flow, origin permission request, and Telegram upload logic unchanged.
5. Confirm the AddFox build does not alter MV3 behavior or fetch permissions.

**Verification:**
- Photo sending still calls Telegram `sendPhoto`.
- Album sending still calls Telegram `sendMediaGroup`.
- Video sending still downloads through Cobalt before uploading to Telegram.
- Self-hosted Cobalt auth failures still produce readable errors.

---

### Task 6: Update build, scripts, and repo docs

**Objective:** Remove WXT-specific assumptions and make the repo AddFox-native.

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Remove later: `wxt.config.ts`
- Remove later: `entrypoints/background.ts`
- Remove later: `entrypoints/content.ts`
- Remove later: `entrypoints/settings.html`

**Steps:**
1. Replace WXT scripts with AddFox scripts.
2. Update docs to say AddFox instead of WXT.
3. Update install/build instructions.
4. Update any references to `settings.html` if the new page becomes `options/index.html`.
5. Remove WXT config and old entrypoint files only after AddFox build passes.

**Suggested `package.json` scripts:**
```json
{
  "scripts": {
    "dev": "addfox dev",
    "build": "addfox build",
    "zip": "addfox zip",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "bun test"
  }
}
```

**Verification:**
- `dev`, `build`, and `zip` use AddFox.
- README matches the actual project layout.
- No WXT entry files are still referenced anywhere.

---

### Task 7: Run the full migration test pass

**Objective:** Prove the migrated extension behaves the same as the original.

**Files:**
- All migrated files

**Steps:**
1. Run the build.
2. Run the type check.
3. Run the unit tests.
4. Load the unpacked extension in Chrome.
5. Verify the options page opens.
6. Visit X/Twitter and confirm the send button appears.
7. Test one photo post, one album post, and one video post.
8. Test custom Cobalt host permissions if applicable.

**Commands:**
```bash
bun install
bun run build
bun run typecheck
bun test
```

**Success criteria:**
- Build succeeds with AddFox.
- Existing tests pass.
- Extension behavior is functionally unchanged.
- The repo is clean of WXT-only runtime dependencies.

---

## Recommended implementation order

1. Task 1 — map everything.
2. Task 2 — create AddFox scaffold.
3. Task 4 — content script.
4. Task 5 — background worker.
5. Task 3 — options page.
6. Task 6 — scripts/docs cleanup.
7. Task 7 — verification.

## Risks to watch

- AddFox manifest field names may differ slightly from WXT’s config shape.
- The options page entry may need a tiny HTML wrapper depending on how AddFox wants HTML pages declared.
- If the current DOM-based settings code depends on `entrypoints/settings.html` being served directly, the new options page path must be tested early.
- Keep the migration mechanical until the build is green; avoid refactoring selectors during the framework switch.
