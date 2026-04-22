import type { CSLItem } from "../bbt/types";

/**
 * Post-process a BBT-rendered CSL bibliography entry to add things academic
 * readers expect even when the selected CSL style omits them:
 *
 *   1. Turn any in-text DOI (or `https://doi.org/...` URL) into a clickable link.
 *   2. If the style doesn't include volume/issue/pages, append a terse
 *      "vol(issue):pages" tail.
 *   3. If the DOI isn't anywhere in the rendered entry, append it as a link.
 *
 * The input HTML is what BBT's `item.bibliography` returned (sanitized CSL
 * HTML, typically one `.csl-entry` div). We parse it, mutate in place, and
 * return the new HTML.
 */
export function enhanceCslEntry(html: string, csl: CSLItem): string {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(`<div id="zoob-r">${html}</div>`, "text/html");
  } catch {
    return html;
  }
  const root = doc.getElementById("zoob-r");
  if (!root) return html;

  // Strip the entry-number prefix that numbered CSL styles (AMA, Vancouver,
  // IEEE, …) emit in `.csl-left-margin`. In a per-entry card view each entry
  // is visually its own block — a leading "1." makes no sense. The refs block
  // renderer uses its own code path and keeps numbering there.
  root.querySelectorAll(".csl-left-margin").forEach((el) => el.remove());
  // Some numbered styles leave `.csl-right-inline` with a hanging-indent left
  // margin. Zero it out so the text starts at the card edge.
  root.querySelectorAll(".csl-right-inline").forEach((el) => {
    (el as HTMLElement).style.marginLeft = "0";
    (el as HTMLElement).style.paddingLeft = "0";
    (el as HTMLElement).style.display = "inline";
  });

  const doi = typeof csl.DOI === "string" ? csl.DOI.trim() : "";
  const vol = csl.volume != null ? String(csl.volume).trim() : "";
  const issue = csl.issue != null ? String(csl.issue).trim() : "";
  const page = typeof csl.page === "string" ? csl.page.trim() : "";

  // Pass 1: linkify DOI in the existing text so users can click it wherever
  // the style chose to place it.
  if (doi) linkifyDoi(root, doi);

  const text = (root.textContent ?? "").toLowerCase();
  const norm = text.replace(/\s+/g, " ");

  // Detect which fields are already present. Matches are permissive — we only
  // want to avoid duplicating what's already there.
  const doiInText = !!doi && norm.includes(doi.toLowerCase());
  const volInText = !!vol && new RegExp(`\\b${escapeRegex(vol)}\\b`).test(norm);
  const issueInTextInitial = !!issue && new RegExp(`\\(${escapeRegex(issue)}\\)|no\\.?\\s*${escapeRegex(issue)}\\b`).test(norm);
  const pagesInText = !!page && norm.includes(page.toLowerCase().replace(/\s+/g, " "));

  // Pass 2: if the style emits the volume but not the issue (common with AMA
  // rendered in a short form — "Cell 180, 568–584"), inject `(issue)` right
  // after the volume so the citation reads as "Cell 180(3), 568–584" instead
  // of trailing an orphan "(3)" on the tail.
  let issueInjected = false;
  if (issue && !issueInTextInitial && vol && volInText) {
    issueInjected = injectAfterVolume(root, vol, issue);
  }
  const issueInText = issueInTextInitial || issueInjected;

  // Build the citation detail: "42(3):123–145" / "42:123–145" / "42(3)" / etc.
  const cite = buildCitation(vol, volInText, issue, issueInText, page, pagesInText);

  const tailParts: string[] = [];
  if (cite) tailParts.push(`<span class="zoob-csl__cite">${escapeHtml(cite)}</span>`);
  if (doi && !doiInText) {
    tailParts.push(
      `<a class="zoob-csl__doi" href="https://doi.org/${encodeURI(doi)}" target="_blank" rel="noopener">doi:${escapeHtml(doi)}</a>`,
    );
  }

  if (tailParts.length > 0) {
    // Find the last `.csl-entry` (or use root) and trim a trailing period so
    // the tail reads cleanly.
    const entry = root.querySelector(".csl-entry") ?? root.firstElementChild ?? root;
    trimTrailingPunctuation(entry);
    entry.insertAdjacentHTML(
      "beforeend",
      ` <span class="zoob-csl__tail">${tailParts.join(" · ")}</span>`,
    );
  }

  return root.innerHTML;
}

/**
 * Walk text nodes under `root` and insert `(issue)` right after the first
 * standalone occurrence of `vol` (word-boundary match, not already followed
 * by `(` which would mean the issue is already there in some other form).
 * Skips text inside existing `<a>` elements. Returns true on success.
 */
function injectAfterVolume(root: HTMLElement, vol: string, issue: string): boolean {
  const re = new RegExp(`\\b${escapeRegex(vol)}\\b`);
  const walker = (root.ownerDocument ?? document).createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n = walker.nextNode();
  while (n) {
    const t = n as Text;
    if (t.parentElement?.closest("a")) {
      n = walker.nextNode();
      continue;
    }
    const v = t.nodeValue ?? "";
    const m = re.exec(v);
    if (m) {
      const idx = m.index + m[0].length;
      // Don't double-insert if the next char already opens a paren.
      if (v.charAt(idx) === "(") return false;
      t.nodeValue = v.slice(0, idx) + `(${issue})` + v.slice(idx);
      return true;
    }
    n = walker.nextNode();
  }
  return false;
}

function buildCitation(
  vol: string, volIn: boolean,
  issue: string, issueIn: boolean,
  page: string, pageIn: boolean,
): string {
  const hasVol = vol && !volIn;
  const hasIssue = issue && !issueIn;
  const hasPage = page && !pageIn;
  if (!hasVol && !hasIssue && !hasPage) return "";
  // Issue alone — "(3)" with nothing around it — is meaningless on the tail.
  // Caller should have tried to inject it inline already; if that failed we
  // simply drop it rather than append a confusing orphan parenthesis.
  if (!hasVol && !hasPage && hasIssue) return "";
  let out = "";
  if (hasVol) out += vol;
  if (hasIssue) out += `(${issue})`;
  if (hasPage) out += (out ? ":" : "") + normalizePages(page);
  return out;
}

function normalizePages(page: string): string {
  // "123-145" → "123–145" (en-dash for page ranges is standard).
  return page.replace(/(\d)\s*-\s*(\d)/g, "$1\u2013$2");
}

function linkifyDoi(root: HTMLElement, doi: string): void {
  // Candidate targets: the bare DOI, and the canonical resolver URL.
  const needles = [doi, `https://doi.org/${doi}`, `http://doi.org/${doi}`, `doi.org/${doi}`];
  const walker = (root.ownerDocument ?? document).createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  const targets: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    const t = n as Text;
    if (t.parentElement?.closest("a")) {
      n = walker.nextNode();
      continue;
    }
    const v = t.nodeValue ?? "";
    if (needles.some((needle) => v.toLowerCase().includes(needle.toLowerCase()))) {
      targets.push(t);
    }
    n = walker.nextNode();
  }
  for (const t of targets) {
    const parent = t.parentNode;
    if (!parent) continue;
    const v = t.nodeValue ?? "";
    // Pick the longest needle present so we link "https://doi.org/xxx" over the bare DOI.
    const needle = needles
      .filter((ne) => v.toLowerCase().includes(ne.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
    if (!needle) continue;
    const idx = v.toLowerCase().indexOf(needle.toLowerCase());
    const before = v.slice(0, idx);
    const match = v.slice(idx, idx + needle.length);
    const after = v.slice(idx + needle.length);
    const doc = root.ownerDocument ?? document;
    const frag = doc.createDocumentFragment();
    if (before) frag.appendChild(doc.createTextNode(before));
    const a = doc.createElement("a");
    a.className = "zoob-csl__doi";
    a.setAttribute("href", `https://doi.org/${encodeURI(doi)}`);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener");
    a.textContent = match;
    frag.appendChild(a);
    if (after) frag.appendChild(doc.createTextNode(after));
    parent.replaceChild(frag, t);
  }
}

function trimTrailingPunctuation(el: Element): void {
  // Walk the tail text node and strip a trailing "." so our " · tail" reads
  // naturally after whatever the CSL style chose.
  let last: ChildNode | null = el.lastChild;
  while (last && last.nodeType === Node.TEXT_NODE) {
    const t = last as Text;
    const v = (t.nodeValue ?? "").replace(/[\s.·]+$/u, "");
    if (v.length === 0) {
      const prev = last.previousSibling;
      last.parentNode?.removeChild(last);
      last = prev;
      continue;
    }
    t.nodeValue = v;
    break;
  }
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
