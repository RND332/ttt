import { defineConfig } from "addfox";

const manifest = {
  name: "TTT",
  version: "1.1.1",
  description: "Sends X post media to Telegram with one click.",
  permissions: ["storage", "scripting"],
  host_permissions: [
    "https://x.com/*",
    "https://twitter.com/*",
    "https://api.x.com/*",
    "https://cdn.syndication.twimg.com/*",
    "https://video.twimg.com/*",
    "https://api.telegram.org/*"
  ],
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
} satisfies Record<string, unknown>;

export default defineConfig({
  outDir: "dist",
  cache: true,
  rsbuild: {
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
    chromium: manifest,
    firefox: {
      ...manifest,
      browser_specific_settings: {
        gecko: {
          id: "ttt@rnd332.github.io",
          strict_min_version: "140.0",
          data_collection_permissions: {
            required: ["authenticationInfo", "websiteContent"],
          },
        },
        gecko_android: {
          strict_min_version: "142.0",
        },
      },
    },
  },
});
