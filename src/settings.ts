import { DEFAULT_SETTINGS } from "./shared";
import type { ExtensionSettings } from "./shared";

export async function loadExtensionSettings(): Promise<ExtensionSettings> {
  const stored: Record<string, unknown> = await chrome.storage.local.get([
    "botToken", "channelId", "captionPrefix", "includePostLink", "autoPrefix"
  ]);
  return {
    botToken: typeof stored.botToken === "string" ? stored.botToken : DEFAULT_SETTINGS.botToken,
    channelId: typeof stored.channelId === "string" ? stored.channelId : DEFAULT_SETTINGS.channelId,
    // Read the former boolean only when the editable field has not been migrated yet.
    captionPrefix: typeof stored.captionPrefix === "string"
      ? stored.captionPrefix
      : stored.autoPrefix === false ? "" : DEFAULT_SETTINGS.captionPrefix,
    includePostLink: typeof stored.includePostLink === "boolean" ? stored.includePostLink : DEFAULT_SETTINGS.includePostLink
  };
}
