import type { CSLItem, CSLName } from "../bbt/types";
import { yearOf, venueOf } from "./format";

/**
 * Render a one-line compact bibliography entry from a CSL-JSON item. We build
 * this ourselves (rather than relying on BBT's `item.bibliography`) so the
 * fields the user cares about — volume, issue, pages, DOI — are *always*
 * present regardless of which CSL style they've selected. Authors use the
 * "Family II" initials form (Smith AD, Jones BE).
 *
 * Output is sanitized HTML:
 *   Smith AD, Jones BE (2005) Title. Journal 42(3):123–145. doi:10.xxx/xx
 */
export function compactBibHtml(
  csl: CSLItem,
  opts: { authorCompactThreshold: number; authorCompactKeepFirst: number },
): string {
  const authors = formatAuthors(
    csl.author ?? csl.editor ?? [],
    opts.authorCompactThreshold,
    opts.authorCompactKeepFirst,
  );
  const year = yearOf(csl);
  const title = typeof csl.title === "string" ? csl.title.trim() : "";
  const journal = venueOf(csl);
  const vol = csl.volume != null ? String(csl.volume).trim() : "";
  const issue = csl.issue != null ? String(csl.issue).trim() : "";
  const page = typeof csl.page === "string" ? csl.page.trim() : "";
  const doi = typeof csl.DOI === "string" ? csl.DOI.trim() : "";

  const parts: string[] = [];

  // "Smith AD, Jones BE (2005)" or fallbacks.
  const lead: string[] = [];
  if (authors) lead.push(escapeHtml(authors));
  if (year) lead.push(`(${escapeHtml(year)})`);
  if (lead.length > 0) parts.push(lead.join(" "));

  // "Title."
  if (title) parts.push(escapeHtml(stripTrailingPeriod(title)) + ".");

  // "Journal 42(3):123–145."
  const venueCite = buildVenueCite(journal, vol, issue, page);
  if (venueCite) parts.push(venueCite + ".");

  // "doi:10.xxx/xx" as a clickable link.
  if (doi) {
    parts.push(
      `<a class="zoob-csl__doi" href="https://doi.org/${encodeURI(doi)}" target="_blank" rel="noopener" title="Open DOI in browser">doi:${escapeHtml(doi)}</a>`,
    );
  }

  return parts.join(" ").trim();
}

function buildVenueCite(journal: string, vol: string, issue: string, page: string): string {
  const parts: string[] = [];
  if (journal) parts.push(`<span class="zoob-csl__venue">${escapeHtml(journal)}</span>`);
  let tail = "";
  if (vol) tail += vol;
  if (issue) tail += `(${issue})`;
  if (page) tail += (tail ? ":" : "") + normalizePages(page);
  if (tail) parts.push(`<span class="zoob-csl__cite">${escapeHtml(tail)}</span>`);
  return parts.join(" ");
}

function formatAuthors(
  authors: CSLName[],
  threshold: number,
  keepFirst: number,
): string {
  const names = authors.map(nameInitials).filter((s) => s.length > 0);
  if (names.length === 0) return "";
  if (threshold > 0 && names.length > threshold && keepFirst >= 1 && keepFirst < names.length - 1) {
    const head = names.slice(0, keepFirst).join(", ");
    const tail = names[names.length - 1];
    return `${head}, …, ${tail}`;
  }
  return names.join(", ");
}

/** "Smith, Albert D." → "Smith AD"; literal/corporate → unchanged. */
function nameInitials(n: CSLName): string {
  if (n.literal) return n.literal.trim();
  const family = [n["non-dropping-particle"], n.family].filter(Boolean).join(" ").trim();
  const given = (n.given ?? "").trim();
  if (!family && !given) return "";
  if (!given) return family;
  const initials = given
    .split(/[\s.\-]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase())
    .filter(Boolean)
    .join("");
  const suffix = n.suffix ? ` ${n.suffix.trim()}` : "";
  return (family ? `${family} ${initials}` : initials).trim() + suffix;
}

function normalizePages(page: string): string {
  return page.replace(/(\d)\s*-\s*(\d)/g, "$1\u2013$2");
}

function stripTrailingPeriod(s: string): string {
  return s.replace(/\.+\s*$/, "");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;"
    : c === "<" ? "&lt;"
    : c === ">" ? "&gt;"
    : c === '"' ? "&quot;"
    : "&#39;",
  );
}
