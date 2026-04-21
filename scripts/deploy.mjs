#!/usr/bin/env node
// Copy the three plugin files into a vault's .obsidian/plugins/zoob directory.
// Usage:
//   ZOOB_VAULT_PLUGIN_DIR=/path/to/vault/.obsidian/plugins/zoob node scripts/deploy.mjs
// or set ZOOB_VAULT_PLUGIN_DIR in a local .env-like file (see package.json scripts).

import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const dest = process.env.ZOOB_VAULT_PLUGIN_DIR;
if (!dest) {
  console.error(
    "ZOOB_VAULT_PLUGIN_DIR is not set.\n" +
      "Example:\n" +
      "  export ZOOB_VAULT_PLUGIN_DIR=\"/path/to/vault/.obsidian/plugins/zoob\"\n" +
      "  npm run deploy",
  );
  process.exit(1);
}

const files = ["manifest.json", "main.js", "styles.css"];

// If dest is a symlink (from the old install approach), remove it so we can
// replace it with a real directory that holds file copies.
try {
  const l = lstatSync(dest);
  if (l.isSymbolicLink()) {
    console.log(`removing pre-existing symlink at ${dest}`);
    unlinkSync(dest);
  }
} catch {
  /* dest does not exist yet — fine */
}

mkdirSync(dest, { recursive: true });

let copied = 0;
for (const f of files) {
  if (!existsSync(f)) {
    console.error(`missing ${f} — run 'npm run build' first`);
    process.exit(1);
  }
  const out = resolve(dest, f);
  copyFileSync(f, out);
  const { size } = statSync(out);
  console.log(`→ ${out}  (${size.toLocaleString()} bytes)`);
  copied++;
}
console.log(`\ndeployed ${copied} file${copied === 1 ? "" : "s"}.`);
console.log("in Obsidian: Settings → Community plugins → reload ↻ next to 'Installed plugins'.");
