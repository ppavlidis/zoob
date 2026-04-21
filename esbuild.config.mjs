import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const banner = `/*
 * zoob — Obsidian plugin for Zotero (Better BibTeX).
 * Built from sources under src/. See repository for details.
 */`;

const prod = process.argv[2] === "production";

// Deploy target: copy built artifacts into a vault's plugins/zoob/ dir on every
// successful build. Order of precedence:
//   1. ZOOB_VAULT_PLUGIN_DIR env var
//   2. `.deploy-path` file in repo root (gitignored; one line = absolute path)
// Symlinks into a vault don't survive Obsidian's plugin loader reliably, so
// copying on build is the robust answer.
const deployDir = (() => {
  if (process.env.ZOOB_VAULT_PLUGIN_DIR) return process.env.ZOOB_VAULT_PLUGIN_DIR;
  try {
    const p = readFileSync(".deploy-path", "utf8").trim();
    return p.length > 0 ? p : undefined;
  } catch {
    return undefined;
  }
})();
const deployPlugin = {
  name: "zoob-deploy",
  setup(build) {
    build.onEnd((result) => {
      if (!deployDir || (result.errors ?? []).length > 0) return;
      try {
        mkdirSync(deployDir, { recursive: true });
        for (const f of ["main.js", "manifest.json", "styles.css"]) {
          if (existsSync(f)) copyFileSync(f, resolve(deployDir, f));
        }
        console.log(`[deploy] copied to ${deployDir}`);
      } catch (e) {
        console.warn(`[deploy] failed: ${e.message}`);
      }
    });
  },
};

const ctx = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  plugins: [deployPlugin],
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
