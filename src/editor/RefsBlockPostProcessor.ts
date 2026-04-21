import { MarkdownPostProcessor, MarkdownPostProcessorContext } from "obsidian";
import type ZoobPlugin from "../main";
import { extractCitekeys } from "../util/citations";

// Reading-mode post-processor that replaces the Pandoc-style reference block:
//
//    ::: {#refs}
//    :::
//
// with a CSL-formatted bibliography of the note's cited keys.
//
// Obsidian renders `::: {#refs}` as plain paragraphs, so we scan the rendered
// subtree for a starting `::: {#refs}` paragraph and the following `:::` and
// replace the range between them with a styled bibliography container.

const FENCE_START = /^\s*:::\s*(?:\{#refs(?:\s+[^}]*)?\}|refs)\s*$/;
const FENCE_END = /^\s*:::\s*$/;

/**
 * Obsidian calls markdown post-processors aggressively — not just on file open,
 * but on scroll, edit, viewport change, metadata-cache update, etc. Each call
 * used to hit `item.bibliography` on BBT; on notes with a refs block that
 * meant continuous Zotero CPU load even when the user was idle. Cache the
 * rendered HTML per (citekeys + cslStyleId) so repeat renders are free.
 */
const refsBlockCache = new Map<string, string>();

function cacheKey(keys: string[], cslId: string): string {
  return `${cslId}\u0000${keys.join("|")}`;
}

/** Drop all cached refs-block HTML. Call on manual refresh / style change. */
export function clearRefsBlockCache(): void {
  refsBlockCache.clear();
}

export function refsBlockPostProcessor(plugin: ZoobPlugin): MarkdownPostProcessor {
  return async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const startEl = findMatchingParagraph(el, FENCE_START);
    if (!startEl) return;

    const endEl = nextMatchingSibling(startEl, FENCE_END);
    if (!endEl) return;

    // Remove everything between start and end (exclusive), and the fences.
    const between: Element[] = [];
    let cur: Element | null = startEl.nextElementSibling;
    while (cur && cur !== endEl) {
      between.push(cur);
      cur = cur.nextElementSibling;
    }

    const container = document.createElement("div");
    container.addClass("zoob-refs");
    const heading = container.createDiv({ cls: "zoob-refs__heading", text: "References" });
    const body = container.createDiv({ cls: "zoob-refs__body" });
    body.setText("Loading references…");

    // Replace the start fence with the container and remove rest.
    startEl.replaceWith(container);
    for (const e of between) e.remove();
    endEl.remove();

    // Fetch and render bibliography.
    const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
    let source = "";
    if (file && "extension" in file) {
      try {
        source = await plugin.app.vault.cachedRead(file as never);
      } catch {
        /* ignore */
      }
    }
    const keys = source ? extractCitekeys(source) : [];
    if (keys.length === 0) {
      body.setText("No citations found in this note.");
      heading.setText("References");
      return;
    }

    const cslId = plugin.effectiveCslId();
    const ck = cacheKey(keys, cslId);
    const cachedHtml = refsBlockCache.get(ck);
    const render = (html: string) => {
      body.empty();
      const inner = body.createDiv({ cls: "zoob-refs__list" });
      inner.innerHTML = html;
      heading.setText(`References (${keys.length})`);
    };
    if (cachedHtml != null) {
      render(cachedHtml);
      return;
    }
    try {
      const html = await plugin.bbt.bibliography(keys, cslId);
      refsBlockCache.set(ck, html);
      render(html);
      void ctx;
    } catch (e) {
      body.setText(`Couldn't format references: ${(e as Error).message}`);
    }
  };
}

function findMatchingParagraph(el: HTMLElement, pat: RegExp): Element | null {
  // Direct children first (common case).
  for (const child of Array.from(el.children)) {
    if (child.tagName === "P" && pat.test((child.textContent ?? "").trim())) {
      return child;
    }
  }
  // Then any paragraph in the subtree.
  for (const p of Array.from(el.querySelectorAll("p"))) {
    if (pat.test((p.textContent ?? "").trim())) return p;
  }
  return null;
}

function nextMatchingSibling(start: Element, pat: RegExp): Element | null {
  let cur = start.nextElementSibling;
  while (cur) {
    if ((cur.tagName === "P" || cur.tagName === "DIV") && pat.test((cur.textContent ?? "").trim())) {
      return cur;
    }
    cur = cur.nextElementSibling;
  }
  return null;
}
