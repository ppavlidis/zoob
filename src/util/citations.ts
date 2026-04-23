// Pandoc-compatible citekey extraction.
//
// Accepts `[@key]`, `[@key, pp. 12]`, `[-@key]` (suppress-author) and
// multi-cite `[@a; @b]`. Skips citations inside inline code (`...`) and
// fenced code blocks, and skips anything inside YAML frontmatter.
//
// The main exported fn is `extractCitekeys(source)` which returns citekeys in
// order of first appearance, de-duplicated — this matches deepsit's "References"
// ordering.

// A citekey character class conservative enough to match BBT's real-world keys.
// (BBT supports a long list but practical keys are ASCII + these punctuations.)
const CITEKEY = "[\\w][\\w:.#$%&\\-+?<>~/]*";
const CITE_PATTERN = new RegExp(`\\[(-?@${CITEKEY}(?:\\s*[;,][^\\]]*)?)+\\]`, "g");
const SINGLE_KEY_IN_CITE = new RegExp(`-?@(${CITEKEY})`, "g");

export const CITEKEY_IN_TEXT_REGEX = new RegExp(`\\[-?@(${CITEKEY})\\]`);

/** Strip fenced code blocks, inline code, and YAML frontmatter. */
export function stripNonProseRegions(src: string): string {
  let out = src;
  // Frontmatter (only at very start).
  if (out.startsWith("---\n")) {
    const end = out.indexOf("\n---", 4);
    if (end !== -1) out = out.slice(0, 4) + " ".repeat(end - 4) + out.slice(end);
  }
  // Fenced code blocks (``` or ~~~).
  out = out.replace(/(```|~~~)[\s\S]*?\1/g, (m) => " ".repeat(m.length));
  // Inline code.
  out = out.replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
  return out;
}

export function extractCitekeys(src: string): string[] {
  const clean = stripNonProseRegions(src);
  const seen = new Set<string>();
  const ordered: string[] = [];
  let m: RegExpExecArray | null;
  CITE_PATTERN.lastIndex = 0;
  while ((m = CITE_PATTERN.exec(clean)) !== null) {
    const group = m[0];
    let km: RegExpExecArray | null;
    SINGLE_KEY_IN_CITE.lastIndex = 0;
    while ((km = SINGLE_KEY_IN_CITE.exec(group)) !== null) {
      const key = km[1];
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
  }
  return ordered;
}

/**
 * Match a single citation token at an arbitrary offset. Handles both simple
 * `[@key]` and Pandoc multi-cite groups `[@a; @b, pp. 5]` — inside a group we
 * return the specific `@citekey` span under (or nearest before) the offset,
 * not just the first key in the group. Callers use start/end to position a
 * popover, so returning the individual token makes the hover anchor correctly
 * on whichever citekey the cursor is actually over.
 */
export function matchCitationAt(src: string, offset: number):
  | { start: number; end: number; citekey: string }
  | null {
  // Find the enclosing `[ ... ]` bracket group that covers `offset`.
  const openIdx = src.lastIndexOf("[", offset);
  if (openIdx < 0) return null;
  // Allow a small back-window — matchCitationAt is called with a text-node
  // slice and the cursor might land on whitespace at the very start.
  if (offset - openIdx > 512) return null;
  const closeIdx = src.indexOf("]", openIdx);
  if (closeIdx < 0 || closeIdx < offset - 1) return null;
  const group = src.slice(openIdx, closeIdx + 1);
  // Enumerate @citekey tokens inside the group. The lookbehind rules out
  // accidental matches like `email@host` — we only decorate `@` preceded by
  // `[`, whitespace, `;`, or `,`.
  const re = /(?<=[\[\s;,])-?@([\w][\w:.#$%&\-+?<>~/]*)/g;
  let bestBefore: { start: number; end: number; citekey: string } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(group)) !== null) {
    const start = openIdx + m.index;
    const end = start + m[0].length;
    if (offset >= start && offset <= end) {
      return { start, end, citekey: m[1] };
    }
    if (start <= offset) bestBefore = { start, end, citekey: m[1] };
  }
  return bestBefore;
}
