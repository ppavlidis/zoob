import type { CSLItem, CSLName } from "../bbt/types";

/**
 * Surname-ish key for sorting bibliography entries alphabetically by first
 * author. Falls back to editor → literal → container-title → title so
 * author-less items still land somewhere sensible rather than all clumping
 * at the top or bottom. Lowercased for locale-aware compare.
 */
export function sortKeyByFirstAuthor(item: CSLItem): string {
  const creators = item.author ?? item.editor ?? [];
  for (const n of creators) {
    if (n.family) return n.family.toLowerCase();
    if (n.literal) return n.literal.toLowerCase();
  }
  // No usable creator — fall back to container title, then title. Items with
  // nothing of the sort sort last under the Unicode replacement char.
  const ct = typeof item["container-title"] === "string" ? item["container-title"] : "";
  const t = typeof item.title === "string" ? item.title : "";
  return (ct || t || "\uFFFF").toLowerCase();
}

export function authorsShort(item: CSLItem): string {
  const a = item.author ?? item.editor ?? [];
  if (a.length === 0) return "";
  const names = a.map(nameString).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} et al.`;
}

export function authorsLong(item: CSLItem, max = 6): string {
  const a = item.author ?? item.editor ?? [];
  const names = a.map(nameString).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length <= max) {
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  }
  return `${names.slice(0, max).join(", ")}, …`;
}

function nameString(n: CSLName): string {
  if (n.literal) return n.literal;
  const parts = [n.given, n["dropping-particle"], n["non-dropping-particle"], n.family, n.suffix]
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  return parts.join(" ").trim();
}

export function yearOf(item: CSLItem): string {
  const d = item.issued;
  if (!d) return "";
  if (typeof d.year === "number") return String(d.year);
  const parts = d["date-parts"]?.[0];
  if (parts && parts.length > 0) return String(parts[0]);
  if (d.literal) return d.literal;
  if (d.raw) return d.raw;
  return "";
}

export function venueOf(item: CSLItem): string {
  return (
    (typeof item["container-title"] === "string" && item["container-title"]) ||
    (typeof item.publisher === "string" && item.publisher) ||
    ""
  );
}

export function tagsOf(item: CSLItem): string[] {
  const raw = typeof item.keyword === "string" ? item.keyword : "";
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
