import { defineConfig } from "addfox";

// Every origin the extension may fetch from at runtime. Reused for
// host_permissions and for the connect-src of the extension CSP below, so the
// two cannot drift apart.
const apiOrigins = [
  "https://x.com",
  "https://twitter.com",
  "https://api.x.com",
  "https://cdn.syndication.twimg.com",
  "https://video.twimg.com",
  "https://api.telegram.org"
];

export default defineConfig({
  outDir: "dist",
  hotReload: {
    autoRefreshContentPage: true,
  },
  rsbuild: {
    server: {
      // 3000 is commonly taken (Grafana here); a pinned port keeps the pinned
      // CSP and the HMR client in sync instead of silently drifting to 3001+.
      port: 3113,
      strictPort: true,
    },
    tools: {
      swc: {
        jsc: {
          transform: {
            react: {
              runtime: "automatic",
              importSource: "react",
            },
          },
        },
      },
    },
  },
  manifest: {
    name: "TTT",
    version: "1.2.1",
    description: "Sends X post media to Telegram with one click.",
    permissions: ["storage", "scripting"],
    host_permissions: apiOrigins.map((origin) => `${origin}/*`),
    // Without an explicit CSP, Addfox dev replaces it with a connect-src that
    // only allows the dev server, which blocks api.telegram.org from the
    // background service worker.
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'; connect-src 'self' ${apiOrigins.join(" ")};`,
    },
    action: {
      default_title: "TTT",
    },
    commands: {
      open_settings: {
        suggested_key: {
          default: "Ctrl+Shift+Y",
          mac: "Command+Shift+Y",
        },
        description: "Open TTT settings",
      },
    },
    options_page: "options/index.html",
    icons: {
      16: "icons/icon16.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png",
    },
  },
});
