import { MarkdownPostProcessor, MarkdownPostProcessorContext, TFile } from "obsidian";
import type ZoobPlugin from "../main";
import type { ZoobItem } from "../bbt/types";
import { authorsInText, yearOf } from "../util/format";
import { extractCitekeys } from "../util/citations";
import { t } from "../i18n";

// Reading-mode post-processor that replaces Pandoc citation markup with the
// in-text form that matches the user's selected CSL style — author-year for
// APA/Chicago/Harvard/etc., numeric for AMA/Vancouver/IEEE, etc.
//
// Source text on disk is untouched — display-only. Live preview and source
// mode continue to show the raw `[@key]` (handled by CiteTokenExtension,
// which only adds a visual decoration). The rendered span re-uses
// `.zoob-cite[data-citekey]` internally so the existing hover-card delegation
// in main.ts picks it up without extra wiring.
//
// BBT's JSON-RPC has no dedicated in-text citation method (bibliography-only),
// so we classify each supported style into a family and format client-side
// from the CSL metadata we already fetch for the side panel. Unknown styles
// (custom CSL IDs) default to author-year.

// A bracket group containing at least one `@citekey`. We match `[`..`]` on a
// single line to avoid crossing block boundaries in accidentally-malformed
// markup, then walk the group's tokens.
const CITE_GROUP_RE = /\[[^\]\n]*?(?:-?@[\w][\w:.#$%&\-+?<>~/]*)[^\]\n]*\]/g;

interface CiteToken {
  suppressAuthor: boolean;  // `-@key` form — render `(Year)` only
  citekey: string;
  locator: string;           // free-text after the citekey, e.g. "pp. 33"
}

interface Hit {
  start: number;
  end: number;
  tokens: CiteToken[];
  raw: string;
}

// --- style classification --------------------------------------------------

interface AuthorYearFormat {
  kind: "author-year";
  /** Separator between author and year — ", " (APA) or " " (Chicago AD). */
  yearSep: string;
  /** Separator between adjacent cites in a multi-cite group — "; ". */
  groupSep: string;
  open: string;
  close: string;
}

interface NumericFormat {
  kind: "numeric";
  open: string;   // "(" or "[" or "" (AMA superscript has none)
  close: string;
  sep: string;    // "," (AMA) or ", " (IEEE)
  superscript: boolean;
}

type CiteFormat = AuthorYearFormat | NumericFormat;

const AUTHOR_YEAR_APA: AuthorYearFormat = {
  kind: "author-year", yearSep: ", ", groupSep: "; ", open: "(", close: ")",
};
const AUTHOR_YEAR_CHICAGO: AuthorYearFormat = {
  kind: "author-year", yearSep: " ", groupSep: "; ", open: "(", close: ")",
};
const NUMERIC_SUPERSCRIPT: NumericFormat = {
  kind: "numeric", open: "", close: "", sep: ",", superscript: true,
};
const NUMERIC_VANCOUVER: NumericFormat = {
  kind: "numeric", open: "(", close: ")", sep: ",", superscript: false,
};
const NUMERIC_IEEE: NumericFormat = {
  kind: "numeric", open: "[", close: "]", sep: ", ", superscript: false,
};
const NUMERIC_PNAS: NumericFormat = {
  kind: "numeric", open: "(", close: ")", sep: ", ", superscript: false,
};

const STYLE_FORMAT: Record<string, CiteFormat> = {
  "http://www.zotero.org/styles/american-medical-association": NUMERIC_SUPERSCRIPT,
  "http://www.zotero.org/styles/chicago-note-bibliography": NUMERIC_SUPERSCRIPT,
  "http://www.zotero.org/styles/vancouver": NUMERIC_VANCOUVER,
  "http://www.zotero.org/styles/ieee": NUMERIC_IEEE,
  "http://www.zotero.org/styles/pnas": NUMERIC_PNAS,
  "http://www.zotero.org/styles/apa": AUTHOR_YEAR_APA,
  "http://www.zotero.org/styles/harvard-cite-them-right": AUTHOR_YEAR_APA,
  "http://www.zotero.org/styles/modern-language-association": AUTHOR_YEAR_CHICAGO,
  "http://www.zotero.org/styles/chicago-author-date": AUTHOR_YEAR_CHICAGO,
  "http://www.zotero.org/styles/council-of-science-editors-author-date": AUTHOR_YEAR_CHICAGO,
  "http://www.zotero.org/styles/genetics": AUTHOR_YEAR_CHICAGO,
};

/** Best-effort format for a CSL style ID. Unknown → author-year, APA-ish. */
function citeFormatForStyle(id: string): CiteFormat {
  if (STYLE_FORMAT[id]) return STYLE_FORMAT[id];
  // Heuristic for custom styles: if the style ID contains "vancouver",
  // "ieee", "nature", or "numeric", guess numeric; otherwise author-year.
  const lc = id.toLowerCase();
  if (/\b(vancouver|ieee|nature|numeric|jama|ama)\b/.test(lc)) {
    return NUMERIC_VANCOUVER;
  }
  return AUTHOR_YEAR_APA;
}

// --- token parsing ---------------------------------------------------------

function parseTokens(group: string): CiteToken[] {
  const inner = group.slice(1, -1);
  const out: CiteToken[] = [];
  for (const piece of inner.split(";")) {
    const m = piece.match(/^\s*(-)?@([\w][\w:.#$%&\-+?<>~/]*)(.*)$/);
    if (!m) continue;
    out.push({
      suppressAuthor: !!m[1],
      citekey: m[2],
      locator: m[3].replace(/^[\s,]+/, "").trim(),
    });
  }
  return out;
}

// --- numbering -------------------------------------------------------------

/**
 * For numeric styles: citekey → its 1-based position in the note's cite order.
 * Computed from the *full* source (post-processors only see a single block at
 * a time), so numbers remain stable across rerenders of individual paragraphs.
 */
async function citekeyNumbering(
  plugin: ZoobPlugin,
  sourcePath: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const file = plugin.app.vault.getAbstractFileByPath(sourcePath);
  if (!(file instanceof TFile)) return map;
  let source = "";
  try {
    source = await plugin.app.vault.cachedRead(file);
  } catch {
    return map;
  }
  const keys = extractCitekeys(source);
  keys.forEach((k, i) => map.set(k, i + 1));
  return map;
}

// --- the post-processor ----------------------------------------------------

export function citationPostProcessor(plugin: ZoobPlugin): MarkdownPostProcessor {
  return async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    if (!plugin.settings.renderInlineCitations) return;
    const fmt = citeFormatForStyle(plugin.effectiveCslId());

    type Plan = { node: Text; hits: Hit[] };
    const plans: Plan[] = [];
    const allKeys = new Set<string>();

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(n: Node) {
        const text = (n as Text).nodeValue ?? "";
        if (!text.includes("@")) return NodeFilter.FILTER_REJECT;
        const parent = (n as Text).parentElement;
        if (!parent) return NodeFilter.FILTER_SKIP;
        if (parent.closest("code, pre, .zoob-refs, .zoob-inline-cite")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = (node as Text).nodeValue ?? "";
      const hits: Hit[] = [];
      CITE_GROUP_RE.lastIndex = 0;
      let gm: RegExpExecArray | null;
      while ((gm = CITE_GROUP_RE.exec(text)) !== null) {
        const tokens = parseTokens(gm[0]);
        if (tokens.length === 0) continue;
        for (const tok of tokens) allKeys.add(tok.citekey);
        hits.push({
          start: gm.index,
          end: gm.index + gm[0].length,
          tokens,
          raw: gm[0],
        });
      }
      if (hits.length > 0) plans.push({ node: node as Text, hits });
    }

    if (plans.length === 0) return;

    // Fetch metadata (fast path — no attachments/notes) and numbering in
    // parallel. Numbering only needed for numeric styles.
    const [items, numbering] = await Promise.all([
      plugin.getItemsFast([...allKeys], { bibPath: plugin.currentBibPath() })
        .catch(() => [] as ZoobItem[]),
      fmt.kind === "numeric"
        ? citekeyNumbering(plugin, ctx.sourcePath)
        : Promise.resolve(new Map<string, number>()),
    ]);
    const byKey = new Map(items.map((i) => [i.citekey, i]));

    for (const plan of plans) {
      applyReplacements(plan.node, plan.hits, byKey, numbering, fmt);
    }
  };
}

// --- DOM rendering ---------------------------------------------------------

function applyReplacements(
  node: Text,
  hits: Hit[],
  byKey: Map<string, ZoobItem>,
  numbering: Map<string, number>,
  fmt: CiteFormat,
): void {
  const parent = node.parentNode;
  if (!parent) return;
  const text = node.nodeValue ?? "";
  const frag = document.createDocumentFragment();
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start > cursor) {
      frag.appendChild(document.createTextNode(text.slice(cursor, hit.start)));
    }
    frag.appendChild(buildCitationSpan(hit, byKey, numbering, fmt));
    cursor = hit.end;
  }
  if (cursor < text.length) {
    frag.appendChild(document.createTextNode(text.slice(cursor)));
  }
  parent.replaceChild(frag, node);
}

function buildCitationSpan(
  hit: Hit,
  byKey: Map<string, ZoobItem>,
  numbering: Map<string, number>,
  fmt: CiteFormat,
): HTMLElement {
  const root = document.createElement("span");
  root.className = "zoob-inline-cite";
  root.title = hit.raw;

  // For superscript numeric styles, wrap the whole thing in <sup>. Otherwise
  // the bracket/paren sit at baseline with the number.
  const body: HTMLElement = fmt.kind === "numeric" && fmt.superscript
    ? root.appendChild(document.createElement("sup"))
    : root;

  if (fmt.open) body.appendChild(document.createTextNode(fmt.open));

  hit.tokens.forEach((tok, i) => {
    if (i > 0) {
      body.appendChild(document.createTextNode(
        fmt.kind === "numeric" ? fmt.sep : fmt.groupSep,
      ));
    }
    const piece = document.createElement("span");
    // Reuse the cite-token class so the existing hover delegation wires up.
    piece.className = "zoob-cite";
    piece.setAttribute("data-citekey", tok.citekey);

    if (fmt.kind === "numeric") {
      const n = numbering.get(tok.citekey);
      piece.textContent = n != null ? String(n) : "?";
      body.appendChild(piece);
      if (tok.locator) {
        body.appendChild(document.createTextNode(`, ${tok.locator}`));
      }
    } else {
      piece.textContent = renderAuthorYearPiece(tok, byKey.get(tok.citekey), fmt);
      body.appendChild(piece);
    }
  });

  if (fmt.close) body.appendChild(document.createTextNode(fmt.close));
  return root;
}

function renderAuthorYearPiece(
  tok: CiteToken,
  item: ZoobItem | undefined,
  fmt: AuthorYearFormat,
): string {
  if (!item) {
    const trail = tok.locator ? `, ${tok.locator}` : "";
    return `@${tok.citekey} (${t("inlineCite.missing")})${trail}`;
  }
  const year = yearOf(item.csl) || t("inlineCite.noDate");
  const authors = tok.suppressAuthor ? "" : authorsInText(item.csl);
  let out = authors ? `${authors}${fmt.yearSep}${year}` : year;
  if (tok.locator) out += `, ${tok.locator}`;
  return out;
}
