// addfox ships bin/addfox.mjs with a UTF-8 BOM and CRLF immediately before the
// shebang. The kernel only honours `#!` at byte 0, so `addfox` cannot be spawned
// and shells fall back to executing the file as shell code, which hangs.
// Normalize the published bin in place after install; no-op once upstream ships LF.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const binUrl = new URL("../node_modules/addfox/bin/addfox.mjs", import.meta.url);
if (!existsSync(binUrl)) process.exit(0);

const source = readFileSync(binUrl, "utf8");
const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
if (normalized !== source) writeFileSync(binUrl, normalized);
