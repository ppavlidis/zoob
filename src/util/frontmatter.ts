import type { App, TFile } from "obsidian";

/** Read the `bib:` frontmatter from a note via Obsidian's metadata cache. */
export function readBibPath(app: App, file: TFile | null): string | undefined {
  if (!file) return undefined;
  const cache = app.metadataCache.getFileCache(file);
  const fm = cache?.frontmatter;
  if (!fm) return undefined;
  const v = fm.bib;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
