---
ai_context: addfox_extension_metadata
description: Structured metadata about the Addfox browser extension project
when_to_use:
  - Initial project exploration - understand extension structure, entries, permissions
  - Build debugging - check entry configuration, output paths, dependencies
  - Architecture review - analyze entry relationships and code organization
  - Before modifying entries - see current configuration and generated outputs
structure:
  - Section 1: Basic project info (name, version, manifest version)
  - Section 2: Permissions (required, host, optional)
  - Section 3: Entries (source files, build outputs, configuration flags)
related_files:
  - error.md: Runtime errors (use when debugging extension errors)
  - llms.txt: This project's AI guide (always read first)
---

# Extension Meta

## 1. Basic information

- Framework: addfox
- Name: TTT
- Description: Sends X post media to Telegram with one click.
- Version: 1.0.0
- Framework version: 0.1.1-beta.12
- Manifest version: 3

## 2. Permissions

### 2.1 Permissions
- storage
- activeTab
- tabs
- permissions

### 2.2 Host permissions
- https://x.com/*
- https://twitter.com/*
- https://api.telegram.org/*

### 2.3 Optional permissions
- None

## 3. Entries

```text
background/
├── 📄 Source: /home/rnd332/twitter-to-telegram-extension/app/background/index.ts
└── 📁 JS/
    └── background/index.js
    ⚙️  html: false

content/
├── 📄 Source: /home/rnd332/twitter-to-telegram-extension/app/content/index.ts
└── 📁 JS/
    └── content/index.js
    ⚙️  html: false

options/
├── 📄 Source: /home/rnd332/twitter-to-telegram-extension/app/options/index.ts
├── 📄 HTML: /home/rnd332/twitter-to-telegram-extension/app/options/index.html
└── 📁 JS/
    ├── options/index.js
    └── static/js/shared-vendor.js
    ⚙️  html: true, outputFollowsScriptPath: true, scriptInject: head
```
