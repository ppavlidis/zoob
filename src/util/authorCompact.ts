import type { CSLItem } from "../bbt/types";
import { yearOf } from "./format";

/**
 * Rewrite the rendered CSL HTML so that very long author lists become
 * "first N, …, last author". This works by locating the year in the HTML
 * (e.g. "(2026)" or "2026." or "2026;") as an anchor for the end of the
 * author block, then finding the family name of the (N+1)th author and the
 * family name of the last author within that block and replacing the middle
 * span with "…".
 *
 * Heuristics are fragile across styles; we bail (return original HTML
 * unchanged) whenever we can't find a confident match.
 */
export function compactAuthorsInHtml(
  html: string,
  csl: CSLItem,
  threshold: number,
  keepFirst: number,
): string {
  if (threshold <= 0) return html;
  const authors = csl.author ?? csl.editor ?? [];
  if (authors.length <= threshold) return html;
  if (keepFirst < 1 || keepFirst >= authors.length - 1) return html;

  const year = yearOf(csl);
  if (!year) return html;

  // Locate the year — prefer "(YYYY)" (author-date styles), else any "YYYY"
  // that comes early in the string and is plausibly the issue year.
  const parenRe = new RegExp("\\(\\s*" + escapeRegex(year) + "[a-z]?\\s*\\)");
  let anchorIdx = html.search(parenRe);
  if (anchorIdx < 0) {
    // Fall back: first occurrence of the bare year.
    const bareRe = new RegExp("(?:^|[^\\d])" + escapeRegex(year) + "(?:[^\\d]|$)");
    const m = bareRe.exec(html);
    if (!m) return html;
    // Point to the year digit itself, not the preceding char.
    anchorIdx = m.index + (m[0].startsWith(year) ? 0 : 1);
  }

  const authorBlock = html.slice(0, anchorIdx);
  const rest = html.slice(anchorIdx);

  // First author to drop = authors[keepFirst]; last author we preserve = authors[authors.length - 1].
  const firstDrop = (authors[keepFirst]?.family ?? authors[keepFirst]?.literal ?? "").trim();
  const lastAuthor = authors[authors.length - 1];
  const lastFamily = (lastAuthor?.family ?? lastAuthor?.literal ?? "").trim();
  // Last kept leading author — we splice right after its initials/given.
  const lastKept = authors[keepFirst - 1];
  const lastKeptFamily = (lastKept?.family ?? lastKept?.literal ?? "").trim();
  if (!firstDrop || !lastFamily || !lastKeptFamily) return html;

  // Find the last kept author's family name inside the author block.
  const lastKeptIdx = authorBlock.lastIndexOf(lastKeptFamily);
  if (lastKeptIdx < 0) return html;
  // Find the first-to-drop author position (must come after lastKeptIdx).
  const firstDropIdx = authorBlock.indexOf(firstDrop, lastKeptIdx + lastKeptFamily.length);
  if (firstDropIdx < 0) return html;
  // Find the last author's family within the block (must come after firstDropIdx).
  const lastAuthorIdx = authorBlock.lastIndexOf(lastFamily);
  if (lastAuthorIdx <= firstDropIdx) return html;

  // The splice point *before* the first-to-drop author: walk left from firstDropIdx past any
  // separators like ", ", " & ", " and ".
  let sliceStart = firstDropIdx;
  while (sliceStart > 0 && /[,&\s]|and\b/.test(authorBlock.slice(sliceStart - 1, sliceStart))) {
    sliceStart--;
  }
  // Trim any trailing "and" word.
  const before = authorBlock.slice(0, sliceStart).replace(/[,\s]+(and)?\s*$/i, "");

  // Splice point at start of last author: walk left from lastAuthorIdx past any separators
  // like ", & ", " and ", ", ".
  let sliceEnd = lastAuthorIdx;
  while (sliceEnd > 0 && /[,&\s]/.test(authorBlock.slice(sliceEnd - 1, sliceEnd))) {
    sliceEnd--;
  }
  const afterSep = authorBlock.slice(sliceEnd, lastAuthorIdx).trim();
  // Preserve a meaningful linker ("&" or "and") if the style used one before the
  // last author; discard pure comma/whitespace separators.
  const linker = /&|\band\b/i.test(afterSep) ? afterSep.replace(/^[,\s]+/, "").trim() + " " : "";
  const rebuilt = `${before}, … ${linker}${authorBlock.slice(lastAuthorIdx)}${rest}`;
  return rebuilt;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
