import { setIcon, Notice, Platform } from "obsidian";
import type ZoobPlugin from "../main";
import type { ZoobItem, BBTAttachment, BBTAnnotation } from "../bbt/types";
import { authorsLong, authorsShort, venueOf, yearOf, tagsOf, truncate } from "../util/format";
import { primaryPdf, zoteroOpenPdfByKey, zoteroSelectByKey } from "../util/zoteroLinks";
import { s2, s2PaperUrl } from "../util/s2";
import { compactAuthorsInHtml } from "../util/authorCompact";
import { enhanceCslEntry } from "../util/bibEnhance";
import { compactBibHtml } from "../util/compactBib";

type Variant = "panel" | "hover";

/**
 * Compact one-entry row for the side-panel bibliography. Shows the formatted
 * CSL entry (or a plain-text fallback) plus a small action strip. Rich detail
 * is deferred to the hover card.
 */
export function renderBibRow(
  parent: HTMLElement,
  plugin: ZoobPlugin,
  item: ZoobItem,
  index: number,
): HTMLElement {
  const row = parent.createDiv({
    cls: "zoob-bibrow",
    attr: { "data-citekey": item.citekey },
  });
  row.createSpan({ cls: "zoob-bibrow__index", text: `${index + 1}.` });

  const pdf = primaryPdf(item.attachments);

  const body = row.createDiv({ cls: "zoob-bibrow__body" });
  const entry = body.createSpan({ cls: "zoob-bibrow__entry" });
  // Compact rows use our own renderer from CSL-JSON so volume/issue/pages and
  // DOI are always shown regardless of the chosen CSL style. The style setting
  // still governs the detailed card and the ::: {#refs} block.
  entry.innerHTML = compactBibHtml(item.csl, {
    authorCompactThreshold: plugin.settings.authorCompactThreshold,
    authorCompactKeepFirst: plugin.settings.authorCompactKeepFirst,
  });
  // Clicking the entry opens the full text (PDF) — matching the prominent
  // PDF button, and the reference-manager convention. Falls back to opening
  // in Zotero if there's no PDF, so the click always does *something* useful.
  // Clicks on inner <a> elements (DOI, URLs in the CSL output) are honored as
  // links and don't bubble here.
  entry.title = pdf ? "Open full text" : "Open in Zotero";
  entry.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a")) return;
    if (pdf) openPdf(plugin, item, pdf, e.altKey);
    else openInZotero(plugin, item);
  });

  const actions = row.createDiv({ cls: "zoob-bibrow__actions" });
  const key = actions.createEl("code", {
    cls: "zoob-bibrow__citekey",
    text: `@${item.citekey}`,
    attr: { title: "Click to copy [@citekey]" },
  });
  key.addEventListener("click", async (e) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(`[@${item.citekey}]`);
    new Notice(`Copied [@${item.citekey}]`);
  });

  const loading = item.hydratedLevel === "meta";
  const pdfBtn = actions.createEl("button", {
    cls: "zoob-bibrow__icon",
    attr: {
      "aria-label": pdf ? "Open PDF" : loading ? "Checking for PDF…" : "No PDF attachment",
      title: pdf
        ? "Open PDF (Alt-click: opposite target)"
        : loading ? "Checking for PDF…" : "No PDF attachment",
    },
  });
  setIcon(pdfBtn, "file-text");
  if (!pdf) {
    pdfBtn.addClass("zoob-bibrow__icon--disabled");
    pdfBtn.disabled = true;
  } else {
    pdfBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openPdf(plugin, item, pdf, e.altKey);
    });
  }

  const insertBtn = actions.createEl("button", {
    cls: "zoob-bibrow__icon",
    attr: { "aria-label": "Insert citation at cursor", title: "Insert citation at cursor" },
  });
  setIcon(insertBtn, "at-sign");
  insertBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    plugin.insertCitationAtCursor(item.citekey);
  });

  return row;
}

export function renderItemCard(
  parent: HTMLElement,
  plugin: ZoobPlugin,
  item: ZoobItem,
  variant: Variant,
  opts: { index?: number } = {},
): HTMLElement {
  const root = parent.createDiv({
    cls: `zoob-card zoob-card--${variant}`,
    attr: { "data-citekey": item.citekey },
  });

  // Header row: index + citekey chip + type/year.
  const header = root.createDiv({ cls: "zoob-card__header" });
  if (variant === "panel" && typeof opts.index === "number") {
    header.createSpan({ cls: "zoob-card__index", text: String(opts.index + 1) });
  }
  const citechip = header.createEl("code", { cls: "zoob-card__citekey", text: `@${item.citekey}` });
  citechip.title = "Click to copy citekey";
  citechip.addEventListener("click", async (e) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(`[@${item.citekey}]`);
    new Notice(`Copied [@${item.citekey}]`);
  });
  const year = yearOf(item.csl);
  if (year) header.createSpan({ cls: "zoob-card__year", text: year });
  if (item.csl.type) {
    header.createSpan({ cls: "zoob-card__type", text: prettyType(String(item.csl.type)) });
  }

  // Formatted CSL bibliography entry (preferred) or fall back to title/authors/venue.
  if (variant === "panel" && item.formattedHtml) {
    const bib = root.createDiv({ cls: "zoob-card__bib" });
    // BBT returns sanitized CSL HTML (no scripts). innerHTML preserves <i>/<b>.
    const compacted = compactAuthorsInHtml(
      item.formattedHtml,
      item.csl,
      plugin.settings.authorCompactThreshold,
      plugin.settings.authorCompactKeepFirst,
    );
    bib.innerHTML = enhanceCslEntry(compacted, item.csl);
    bib.title = "Click to open in Zotero";
    bib.addEventListener("click", () => openInZotero(plugin, item));
  } else {
    const titleEl = root.createDiv({ cls: "zoob-card__title", text: item.csl.title ?? "(untitled)" });
    titleEl.addEventListener("click", () => openInZotero(plugin, item));
    const authorText = variant === "hover" ? authorsShort(item.csl) : authorsLong(item.csl, 8);
    if (authorText) root.createDiv({ cls: "zoob-card__authors", text: authorText });
    const venue = venueOf(item.csl);
    if (venue) root.createDiv({ cls: "zoob-card__venue", text: venue });
  }

  // AI summary (from a child note starting with "AI summary"). Shown above
  // the abstract since it's typically the user's distilled take.
  const summary = extractAiSummary(item.notes);
  if (summary) {
    const box = root.createDiv({ cls: "zoob-card__summary" });
    const label = box.createSpan({ cls: "zoob-card__summary-label" });
    setIcon(label, "sparkles");
    label.createSpan({ text: " AI summary" });
    box.createDiv({ cls: "zoob-card__summary-body", text: summary });
  }

  // Abstract (hover: truncated snippet; panel: collapsible).
  if (item.csl.abstract) {
    if (variant === "hover") {
      root.createDiv({
        cls: "zoob-card__abstract",
        text: truncate(item.csl.abstract, plugin.settings.abstractPreviewChars),
      });
    } else {
      renderCollapsibleAbstract(root, item.csl.abstract);
    }
  }

  // Tags.
  const tags = tagsOf(item.csl);
  if (tags.length > 0) {
    const tagRow = root.createDiv({ cls: "zoob-card__tags" });
    for (const t of tags) tagRow.createSpan({ cls: "zoob-card__tag", text: t });
  }

  // Attachments row (badges).
  if (variant === "panel") {
    const attRow = root.createDiv({ cls: "zoob-card__attachments" });
    for (const att of item.attachments) {
      renderAttachmentBadge(attRow, plugin, item, att);
    }
    if (item.notes.length > 0) {
      const nb = attRow.createSpan({ cls: "zoob-card__badge zoob-card__badge--note" });
      setIcon(nb, "sticky-note");
      nb.createSpan({ text: ` ${item.notes.length} note${item.notes.length === 1 ? "" : "s"}` });
    }
    // Annotations: collapsible, draggable quotes. Rendered below the attachment row.
    renderAnnotations(root, plugin, item);
  } else {
    // Hover footer: Zotero + PDF + Cited by + DOI/URL on a single wrap-friendly row.
    const hoverRow = root.createDiv({ cls: "zoob-card__pdf" });
    if (item.zoteroKey) {
      const zbtn = hoverRow.createEl("a", { cls: "zoob-card__badge" });
      setIcon(zbtn, "arrow-up-right");
      zbtn.createSpan({ text: " Zotero" });
      zbtn.title = "Open in Zotero";
      zbtn.addEventListener("click", (e) => {
        e.preventDefault();
        openInZotero(plugin, item);
      });
    }
    const pdf = primaryPdf(item.attachments);
    if (pdf) {
      const link = hoverRow.createEl("a", { cls: "zoob-card__badge", text: "Open PDF" });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        openPdf(plugin, item, pdf, e.altKey);
      });
    }
    renderS2CitedBy(hoverRow, item);
    const doi = typeof item.csl.DOI === "string" ? item.csl.DOI : "";
    const url = typeof item.csl.URL === "string" ? item.csl.URL : "";
    if (doi) {
      const a = hoverRow.createEl("a", { cls: "zoob-card__link", text: `doi:${doi}` });
      a.setAttr("href", `https://doi.org/${doi}`);
      a.setAttr("target", "_blank");
      a.setAttr("rel", "noopener");
    } else if (url) {
      const a = hoverRow.createEl("a", { cls: "zoob-card__link", text: url });
      a.setAttr("href", url);
      a.setAttr("target", "_blank");
      a.setAttr("rel", "noopener");
    }
  }

  // Panel-only metadata row: DOI / URL.
  if (variant === "panel") {
    const doi = typeof item.csl.DOI === "string" ? item.csl.DOI : "";
    const url = typeof item.csl.URL === "string" ? item.csl.URL : "";
    if (doi || url) {
      const metaRow = root.createDiv({ cls: "zoob-card__meta" });
      if (doi) {
        const a = metaRow.createEl("a", { cls: "zoob-card__link", text: `doi:${doi}` });
        a.setAttr("href", `https://doi.org/${doi}`);
        a.setAttr("target", "_blank");
        a.setAttr("rel", "noopener");
      }
      if (url && !doi) {
        const a = metaRow.createEl("a", { cls: "zoob-card__link", text: url });
        a.setAttr("href", url);
        a.setAttr("target", "_blank");
        a.setAttr("rel", "noopener");
      }
    }
  }

  // Action row (panel only). PDF is handled by the attachment-badge row above,
  // which covers snapshots/links too — no need for a redundant PDF icon here.
  if (variant === "panel") {
    const actions = root.createDiv({ cls: "zoob-card__actions" });
    addActionButton(actions, "arrow-up-right", "Open in Zotero", () => openInZotero(plugin, item));
    addActionButton(actions, "at-sign", "Insert citation at cursor", () => {
      plugin.insertCitationAtCursor(item.citekey);
    });
    addActionButton(actions, "quote", "Copy formatted entry", async () => {
      try {
        const html = await plugin.bbt.bibliography(
          [item.citekey],
          plugin.effectiveCslId(),
          item.libraryID,
        );
        await navigator.clipboard.writeText(htmlToPlainText(html));
        new Notice("Copied formatted reference");
      } catch (e) {
        new Notice(`Couldn't format: ${(e as Error).message}`);
      }
    });
  }

  return root;
}

function addActionButton(
  parent: HTMLElement,
  icon: string,
  label: string,
  cb: (ev: MouseEvent) => void,
): HTMLElement {
  const b = parent.createEl("button", { cls: "zoob-card__action", attr: { "aria-label": label, title: label } });
  setIcon(b, icon);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    cb(e);
  });
  return b;
}

function renderCollapsibleAbstract(parent: HTMLElement, abstract: string): void {
  const wrap = parent.createDiv({ cls: "zoob-card__abstract zoob-card__abstract--collapsible" });
  const preview = wrap.createDiv({
    cls: "zoob-card__abstract-preview",
    text: truncate(abstract, 220),
  });
  if (abstract.length <= 220) return;
  const toggle = wrap.createEl("button", { cls: "zoob-card__abstract-toggle", text: "show more" });
  let expanded = false;
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    expanded = !expanded;
    preview.setText(expanded ? abstract : truncate(abstract, 220));
    toggle.setText(expanded ? "show less" : "show more");
  });
}

function renderAttachmentBadge(
  parent: HTMLElement,
  plugin: ZoobPlugin,
  item: ZoobItem,
  att: BBTAttachment,
): void {
  const type = typeof att.contentType === "string" ? att.contentType : "";
  const path = typeof att.path === "string"
    ? att.path
    : typeof att.localPath === "string"
      ? att.localPath
      : "";
  const isPdf = type === "application/pdf" || path.toLowerCase().endsWith(".pdf");
  const isWeb = att.itemType === "attachment" && type.startsWith("text/html");
  const isLink = !path && typeof att.url === "string";

  const icon = isPdf ? "file-text" : isWeb ? "globe" : isLink ? "link" : "paperclip";
  const label = isPdf ? "PDF" : isWeb ? "Snapshot" : isLink ? "Link" : (att.title ?? "Attachment");

  const el = parent.createEl("button", {
    cls: `zoob-card__badge zoob-card__badge--${isPdf ? "pdf" : isWeb ? "snapshot" : isLink ? "link" : "file"}`,
    attr: { title: `${label}${path ? ` — ${path}` : ""}${att.url ? ` — ${att.url}` : ""}` },
  });
  setIcon(el, icon);
  el.createSpan({ text: ` ${label}` });
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isPdf) openPdf(plugin, item, att, e.altKey);
    else if (isLink && att.url) window.open(att.url, "_blank");
    else if (path) openSystemPath(path);
    else openInZotero(plugin, item);
  });
}

function openInZotero(plugin: ZoobPlugin, item: ZoobItem): void {
  const key = item.zoteroKey;
  if (!key) {
    new Notice("No Zotero item key available for this citation.");
    return;
  }
  window.open(zoteroSelectByKey(key, item.libraryID), "_self");
}

export function openPdf(
  plugin: ZoobPlugin,
  item: ZoobItem,
  att: BBTAttachment,
  invertTarget: boolean,
): void {
  const cfg = plugin.settings.pdfOpenTarget;
  let target = cfg;
  if (invertTarget) {
    target = cfg === "zotero" ? "system" : "zotero";
  }
  const path = typeof att.path === "string"
    ? att.path
    : typeof att.localPath === "string"
      ? att.localPath
      : "";
  const attachmentKey = att.key;

  if (target === "zotero") {
    // Prefer BBT's pre-built `open` URI (it already encodes attachment key +
    // library). Fall back to building it from att.key ourselves.
    if (typeof att.open === "string" && att.open) {
      window.open(att.open, "_self");
      return;
    }
    if (attachmentKey) {
      window.open(zoteroOpenPdfByKey(attachmentKey, item.libraryID), "_self");
      return;
    }
    // BBT didn't give us anything Zotero-linkable; warn instead of silently
    // falling through to the OS handler (Acrobat, etc.), which surprises the
    // user when the setting says "Zotero".
    new Notice("This attachment has no Zotero key; opening with system default.");
  }
  if (target === "obsidian") {
    // Obsidian can only display PDFs inside the vault. Attempt, fall back to system.
    try {
      const root = plugin.app.vault.adapter as unknown as { getBasePath?: () => string };
      const base = typeof root.getBasePath === "function" ? root.getBasePath() : "";
      if (base && path.startsWith(base)) {
        const relative = path.slice(base.length).replace(/^[/\\]+/, "");
        const file = plugin.app.vault.getAbstractFileByPath(relative);
        if (file) {
          void plugin.app.workspace.getLeaf(true).openFile(file as never);
          return;
        }
      }
    } catch {
      /* fall through */
    }
    new Notice("PDF is not inside the vault — opening with system default.");
    openSystemPath(path);
    return;
  }
  if (path) {
    openSystemPath(path);
    return;
  }
  if (attachmentKey) {
    window.open(zoteroOpenPdfByKey(attachmentKey, item.libraryID), "_self");
    return;
  }
  new Notice("No way to open this attachment.");
}

function openSystemPath(path: string): void {
  try {
    // Electron is available in Obsidian desktop.
    const electron = (window as unknown as { require?: (m: string) => unknown }).require?.("electron");
    const shell = (electron as { shell?: { openPath: (p: string) => Promise<string> } } | undefined)?.shell;
    if (shell && typeof shell.openPath === "function") {
      void shell.openPath(path);
      return;
    }
  } catch {
    /* ignore */
  }
  // Fallback.
  const url = Platform.isMacOS ? `file://${path}` : `file:///${path.replace(/\\/g, "/")}`;
  window.open(url, "_self");
}

function htmlToPlainText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").trim();
}

function prettyType(t: string): string {
  // "journalArticle" → "journal article"
  return t.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/**
 * Render a "Cited by N" badge backed by Semantic Scholar. Lookup is by DOI
 * (preferred) or title. The badge updates in place once the S2 API responds
 * and links to the S2 paper page. Shows "Cited by: NA" if we have nothing to
 * look up or the paper isn't in S2.
 */
function renderS2CitedBy(parent: HTMLElement, item: ZoobItem): void {
  const doi = typeof item.csl.DOI === "string" ? item.csl.DOI.trim() : "";
  const title = typeof item.csl.title === "string" ? item.csl.title.trim() : "";
  if (!doi && !title) {
    const na = parent.createSpan({ cls: "zoob-card__badge zoob-card__badge--na", text: "Cited by: ?" });
    na.title = "No DOI or title available";
    return;
  }
  const a = parent.createEl("a", { cls: "zoob-card__badge zoob-card__badge--scholar" });
  setIcon(a, "quote");
  const label = a.createSpan({ text: " Cited by: ?" });
  a.setAttr("target", "_blank");
  a.setAttr("rel", "noopener");
  a.title = "Checking Semantic Scholar…";

  void s2.lookup(doi || undefined, title || undefined).then((paper) => {
    if (!paper) {
      a.removeClass("zoob-card__badge--scholar");
      a.addClass("zoob-card__badge--na");
      label.setText(" Cited by: ?");
      a.removeAttribute("href");
      a.title = "Not found on Semantic Scholar";
      return;
    }
    label.setText(` Cited by ${paper.citationCount}`);
    a.setAttr("href", s2PaperUrl(paper.paperId));
    a.title = "Open on Semantic Scholar";
  });
}

/**
 * Scan the item's child notes for one starting with "AI summary" (case-insensitive,
 * optional trailing colon/dash). Returns the body with that marker stripped, or
 * undefined if none matches. Zotero notes are HTML; we convert to plain text.
 */
function extractAiSummary(notes: import("../bbt/types").BBTNote[]): string | undefined {
  const marker = /^\s*(?:ai\s+summary)\s*[:\-–—]?\s*/i;
  for (const n of notes) {
    const html = typeof n.note === "string" ? n.note : "";
    if (!html) continue;
    const text = htmlToPlainText(html);
    if (!marker.test(text)) continue;
    return text.replace(marker, "").trim();
  }
  return undefined;
}

interface AnnWithAtt {
  ann: BBTAnnotation;
  attachment: BBTAttachment;
}

function renderAnnotations(parent: HTMLElement, plugin: ZoobPlugin, item: ZoobItem): void {
  const all: AnnWithAtt[] = [];
  for (const a of item.attachments) {
    if (!Array.isArray(a.annotations)) continue;
    for (const ann of a.annotations) {
      if (!ann.annotationText && !ann.annotationComment) continue;
      all.push({ ann, attachment: a });
    }
  }
  if (all.length === 0) return;

  const wrap = parent.createDiv({ cls: "zoob-card__annotations" });
  const toggle = wrap.createEl("button", { cls: "zoob-card__annotations-toggle" });
  setIcon(toggle, "highlighter");
  toggle.createSpan({ text: ` ${all.length} annotation${all.length === 1 ? "" : "s"} — drag to insert as quote` });
  const list = wrap.createDiv({ cls: "zoob-card__annotations-list" });
  list.style.display = "none";

  let expanded = false;
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    expanded = !expanded;
    list.style.display = expanded ? "" : "none";
    toggle.toggleClass("is-expanded", expanded);
  });

  for (const row of all) renderAnnotationRow(list, plugin, item, row);
}

function renderAnnotationRow(
  parent: HTMLElement,
  plugin: ZoobPlugin,
  item: ZoobItem,
  { ann, attachment }: AnnWithAtt,
): void {
  void attachment;
  const row = parent.createDiv({
    cls: "zoob-annotation",
    attr: { draggable: "true" },
  });
  const color = typeof ann.annotationColor === "string" && ann.annotationColor
    ? ann.annotationColor
    : "var(--text-accent)";
  row.style.setProperty("--zoob-ann-color", color);

  const meta = row.createDiv({ cls: "zoob-annotation__meta" });
  if (ann.annotationPageLabel) {
    meta.createSpan({ cls: "zoob-annotation__page", text: `p. ${ann.annotationPageLabel}` });
  }
  if (ann.annotationType && ann.annotationType !== "highlight") {
    meta.createSpan({ cls: "zoob-annotation__type", text: String(ann.annotationType) });
  }

  if (ann.annotationText) {
    row.createDiv({ cls: "zoob-annotation__text", text: String(ann.annotationText) });
  }
  if (ann.annotationComment) {
    row.createDiv({ cls: "zoob-annotation__comment", text: String(ann.annotationComment) });
  }

  const quote = formatAnnotationAsQuote(ann, item);

  row.addEventListener("dragstart", (ev) => {
    const dt = ev.dataTransfer;
    if (!dt) return;
    dt.setData("text/plain", quote);
    dt.effectAllowed = "copy";
    row.addClass("is-dragging");
  });
  row.addEventListener("dragend", () => row.removeClass("is-dragging"));

  // Also allow click-to-insert at the editor cursor (no drag required).
  row.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const inserted = plugin.insertTextAtCursor(quote);
    if (!inserted) new Notice("Open a note to insert the quote.");
  });
}

function formatAnnotationAsQuote(ann: BBTAnnotation, item: ZoobItem): string {
  const text = (ann.annotationText ?? "").trim();
  const comment = (ann.annotationComment ?? "").trim();
  const page = ann.annotationPageLabel ? `, p. ${ann.annotationPageLabel}` : "";
  const cite = `[@${item.citekey}${page}]`;
  const lines: string[] = [];
  if (text) {
    for (const ln of text.split(/\r?\n/)) lines.push(`> ${ln}`);
    lines.push(`> — ${cite}`);
  } else {
    lines.push(`> ${cite}`);
  }
  if (comment) {
    lines.push("");
    lines.push(comment);
  }
  return lines.join("\n");
}
