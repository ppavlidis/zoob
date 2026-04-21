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

/** Match a single citation token at an arbitrary offset. */
export function matchCitationAt(src: string, offset: number):
  | { start: number; end: number; citekey: string }
  | null {
  // Scan back to find '[' preceding the cursor, then try to match from there.
  let i = offset;
  while (i > 0 && src[i - 1] !== "[") i--;
  if (i === 0 || src[i - 1] !== "[") {
    // Try a more permissive scan: look for the nearest [ within 128 chars.
    const window = Math.max(0, offset - 128);
    const back = src.lastIndexOf("[", offset);
    if (back < window) return null;
    i = back + 1;
  }
  const re = /^(-?@[\w][\w:.#$%&\-+?<>~/]*)(?:\s*[;,][^\]]*)?\]/;
  const rest = src.slice(i);
  const m = rest.match(re);
  if (!m) return null;
  const start = i - 1; // include the `[`
  const end = start + m[0].length + 1; // +1 for `[`
  const keyMatch = m[1].match(/-?@([\w][\w:.#$%&\-+?<>~/]*)/);
  if (!keyMatch) return null;
  return { start, end, citekey: keyMatch[1] };
}
