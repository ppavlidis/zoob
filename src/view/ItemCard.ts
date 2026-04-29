import { setIcon, Notice, Platform } from "obsidian";
import type ZoobPlugin from "../main";
import type { ZoobItem, BBTAttachment, BBTAnnotation } from "../bbt/types";
import { authorsLong, authorsShort, venueOf, yearOf, tagsOf, truncate } from "../util/format";
import { primaryPdf, zoteroOpenPdfByKey, zoteroSelectByKey } from "../util/zoteroLinks";
import { s2, s2PaperUrl } from "../util/s2";
import { compactAuthorsInHtml } from "../util/authorCompact";
import { enhanceCslEntry } from "../util/bibEnhance";
import { compactBibHtml } from "../util/compactBib";
import { t, plural } from "../i18n";

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
  _index: number,
): HTMLElement {
  const row = parent.createDiv({
    cls: "zoob-bibrow",
    attr: { "data-citekey": item.citekey },
  });

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
  entry.title = pdf ? t("card.openFullText") : t("card.openInZotero");
  makeButtonLike(entry, pdf ? t("card.openFullText") : t("card.openInZotero"));
  entry.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a")) return;
    if (pdf) openPdf(plugin, item, pdf, e.altKey);
    else openInZotero(plugin, item);
  });
  entry.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if ((e.target as HTMLElement).closest("a")) return;
    e.preventDefault();
    if (pdf) openPdf(plugin, item, pdf, e.altKey);
    else openInZotero(plugin, item);
  });

  const actions = row.createDiv({ cls: "zoob-bibrow__actions" });
  const key = actions.createEl("code", {
    cls: "zoob-bibrow__citekey",
    text: `@${item.citekey}`,
    // Include the full citekey in the tooltip so truncated-with-ellipsis long
    // keys are still discoverable on hover (BBT can produce 60+ char keys).
    attr: { title: t("card.citekey.tooltip", { citekey: item.citekey }) },
  });
  makeButtonLike(key, t("card.citekey.ariaCopy", { citekey: item.citekey }));
  const copyCitekey = async () => {
    await navigator.clipboard.writeText(`[@${item.citekey}]`);
    new Notice(t("notice.citekeyCopied", { citekey: item.citekey }));
  };
  key.addEventListener("click", async (e) => {
    e.stopPropagation();
    await copyCitekey();
  });
  key.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    await copyCitekey();
  });

  const loading = item.hydratedLevel === "meta";
  const pdfBtn = actions.createEl("button", {
    cls: "zoob-bibrow__icon",
    attr: {
      "aria-label": pdf ? t("card.pdf.open") : loading ? t("card.pdf.checking") : t("card.pdf.none"),
      title: pdf
        ? t("card.pdf.openAltHint")
        : loading ? t("card.pdf.checking") : t("card.pdf.none"),
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
    attr: { "aria-label": t("card.insertAtCursor"), title: t("card.insertAtCursor") },
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

  // Header row: citekey chip + type/year. No index — visual separation between
  // cards is handled by CSS (top border on each card, extra breathing room).
  const header = root.createDiv({ cls: "zoob-card__header" });
  void opts;
  const citechip = header.createEl("code", { cls: "zoob-card__citekey", text: `@${item.citekey}` });
  citechip.title = t("card.citekey.copyTitle");
  makeButtonLike(citechip, t("card.citekey.ariaCopy", { citekey: item.citekey }));
  const copyFromCard = async () => {
    await navigator.clipboard.writeText(`[@${item.citekey}]`);
    new Notice(t("notice.citekeyCopied", { citekey: item.citekey }));
  };
  citechip.addEventListener("click", async (e) => {
    e.stopPropagation();
    await copyFromCard();
  });
  citechip.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    e.stopPropagation();
    await copyFromCard();
  });
  // Type stays in the header (right-aligned via margin-left:auto). The year
  // used to live here too, but a long citekey chip caused it to wrap onto a
  // new line on some cards and not others — the placement looked random
  // across the panel. The year is now its own row directly above the title,
  // consistent on every card and noticeably more prominent.
  if (item.csl.type) {
    header.createSpan({ cls: "zoob-card__type", text: prettyType(String(item.csl.type)) });
  }
  const year = yearOf(item.csl);
  if (year) root.createDiv({ cls: "zoob-card__date", text: year });

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
    // No `title` attribute or aria-label on the container — both bleed through
    // to child elements (including DOI links), which then show "Open in Zotero"
    // on hover, overriding the native URL tooltip. We also intentionally omit
    // role="button" / tabindex — Chromium surfaces aria-label as a tooltip
    // when an element is role="button". Keyboard users reach the same action
    // via the dedicated "Open in Zotero" button in the action row below, so
    // the bib is mouse-click convenience only.
    bib.addClass("zoob-clickable");
    bib.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("a")) return;
      openInZotero(plugin, item);
    });
  } else {
    const titleEl = root.createDiv({ cls: "zoob-card__title", text: item.csl.title ?? t("card.untitled") });
    titleEl.title = t("card.title.openInZotero");
    makeButtonLike(titleEl, t("card.openInZotero"));
    titleEl.addEventListener("click", () => openInZotero(plugin, item));
    titleEl.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      openInZotero(plugin, item);
    });
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
    label.createSpan({ text: ` ${t("card.aiSummary")}` });
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

  // Annotations: collapsible, draggable quotes. Attachment badges are folded
  // into the bottom action row (see below) so the card footer is one line.
  if (variant === "panel") {
    renderAnnotations(root, plugin, item);
  } else {
    // Hover footer: Zotero + PDF + Cited by + DOI/URL on a single wrap-friendly row.
    const hoverRow = root.createDiv({ cls: "zoob-card__pdf" });
    if (item.zoteroKey) {
      // Use a real href so a click follows the link natively via Electron's
      // protocol handler. The hover popover tears itself down on click, which
      // races a JS-based `window.open()` and causes the navigation to be
      // dropped — letting the browser follow the href dodges the teardown.
      const zbtn = hoverRow.createEl("a", {
        cls: "zoob-card__badge",
        attr: {
          href: zoteroSelectByKey(item.zoteroKey, item.libraryID),
          title: t("card.openInZotero"),
        },
      });
      setIcon(zbtn, "arrow-up-right");
      zbtn.createSpan({ text: ` ${t("card.zoteroBadge")}` });
    }
    const pdf = primaryPdf(item.attachments);
    if (pdf) {
      // Same story as the Zotero badge: set a real href for the default open
      // target so the click navigates natively. Alt-click still needs JS to
      // invert the target, so we guard on that.
      const pdfHref = hoverPdfHref(plugin, item, pdf);
      const link = hoverRow.createEl("a", {
        cls: "zoob-card__badge",
        text: t("card.pdf.open"),
        attr: pdfHref ? { href: pdfHref } : {},
      });
      link.addEventListener("click", (e) => {
        if (!e.altKey && pdfHref) return; // let the href do its job
        e.preventDefault();
        openPdf(plugin, item, pdf, e.altKey);
      });
    }
    // Semantic Scholar lookup is gated on an opt-in setting — S2's free graph
    // API is a shared rate-limited resource, so no badge, no request unless
    // the user has ticked the box in settings.
    if (plugin.settings.showCitationCounts) renderS2CitedBy(hoverRow, item);
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

  // Panel-only metadata row: DOI / URL. Only rendered when we're falling back
  // to the non-formatted branch above — enhanceCslEntry already places the DOI
  // inline (or appended) on cards that have BBT's formatted HTML, so duplicating
  // it here just shows the same link twice.
  if (variant === "panel" && !item.formattedHtml) {
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

  // Action row (panel only). Combines attachment badges (PDF/snapshot/link)
  // and the notes-count badge with the three icon actions so the footer is one
  // wrap-friendly line rather than two stacked rows.
  if (variant === "panel") {
    const actions = root.createDiv({ cls: "zoob-card__actions" });
    for (const att of item.attachments) {
      renderAttachmentBadge(actions, plugin, item, att);
    }
    if (item.notes.length > 0) {
      const nb = actions.createSpan({ cls: "zoob-card__badge zoob-card__badge--note" });
      setIcon(nb, "sticky-note");
      const nKey = plural(item.notes.length, "card.notes_one", "card.notes_other");
      nb.createSpan({ text: ` ${t(nKey, { count: item.notes.length })}` });
    }
    addActionButton(actions, "arrow-up-right", t("card.openInZotero"), () => openInZotero(plugin, item));
    addActionButton(actions, "at-sign", t("card.insertAtCursor"), () => {
      plugin.insertCitationAtCursor(item.citekey);
    });
    addActionButton(actions, "quote", t("card.copyFormatted"), async () => {
      try {
        const html = await plugin.bbt.bibliography(
          [item.citekey],
          plugin.effectiveCslId(),
          item.libraryID,
        );
        await navigator.clipboard.writeText(htmlToPlainText(html));
        new Notice(t("notice.copiedFormatted"));
      } catch (e) {
        new Notice(t("notice.couldNotFormat", { message: (e as Error).message }));
      }
    });
  }

  return root;
}

/**
 * Make a non-button element behave like a button for assistive tech and keyboard
 * users: ARIA role, tab stop, and a focus-visible marker class that styles.css
 * hooks to draw a focus ring. Callers still add their own click + keydown
 * listeners (keydown must listen for Enter/Space; native <button> is preferred
 * when layout allows, this is for inline/flow elements where <button> breaks
 * the visual).
 */
function makeButtonLike(el: HTMLElement, label: string): void {
  el.setAttr("role", "button");
  el.setAttr("tabindex", "0");
  if (!el.hasAttribute("aria-label")) el.setAttr("aria-label", label);
  el.addClass("zoob-clickable");
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
  const toggle = wrap.createEl("button", { cls: "zoob-card__abstract-toggle", text: t("card.abstract.more") });
  let expanded = false;
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    expanded = !expanded;
    preview.setText(expanded ? abstract : truncate(abstract, 220));
    toggle.setText(expanded ? t("card.abstract.less") : t("card.abstract.more"));
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
  const label = isPdf
    ? t("card.attachment.pdf")
    : isWeb
      ? t("card.attachment.snapshot")
      : isLink
        ? t("card.attachment.link")
        : (att.title ?? t("card.attachment.generic"));

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

/**
 * Build a native-resolvable URI for the "Open PDF" badge in the hover card, if
 * the configured target admits one. Returns undefined for targets that need
 * imperative logic (obsidian-in-vault fallback, "system" — which Electron may
 * route to an in-process PDF viewer rather than the user's default app if we
 * just set file:// as an href).
 */
function hoverPdfHref(
  plugin: ZoobPlugin,
  item: ZoobItem,
  att: BBTAttachment,
): string | undefined {
  if (plugin.settings.pdfOpenTarget !== "zotero") return undefined;
  if (typeof att.open === "string" && att.open) return att.open;
  if (att.key) return zoteroOpenPdfByKey(att.key, item.libraryID);
  return undefined;
}

function openInZotero(plugin: ZoobPlugin, item: ZoobItem): void {
  if (item.zoteroKey) {
    window.open(zoteroSelectByKey(item.zoteroKey, item.libraryID), "_self");
    return;
  }
  // The panel renders items at "meta" hydration first (fast path) and upgrades
  // to "full" (which is when `zoteroKey` lands) in the background. If the user
  // clicks during that window, fetch full hydration on-demand and open on
  // resolve — in practice a sub-second BBT call — rather than falsely
  // reporting "No Zotero item key available."
  void plugin.upgradeItems([item]).then((full) => {
    const upgraded = full[0];
    const key = upgraded?.zoteroKey;
    if (!key) {
      new Notice(t("notice.noZoteroKeyForCite"));
      return;
    }
    window.open(zoteroSelectByKey(key, upgraded.libraryID ?? item.libraryID), "_self");
  }).catch(() => {
    new Notice(t("notice.noZoteroKeyForCite"));
  });
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
    new Notice(t("notice.attachmentNoKey"));
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
    new Notice(t("notice.pdfNotInVault"));
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
  new Notice(t("notice.cannotOpenAttachment"));
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
    const na = parent.createSpan({ cls: "zoob-card__badge zoob-card__badge--na", text: t("card.s2.na") });
    na.title = t("card.s2.noLookup");
    return;
  }
  const a = parent.createEl("a", { cls: "zoob-card__badge zoob-card__badge--scholar" });
  setIcon(a, "quote");
  const label = a.createSpan({ text: ` ${t("card.s2.na")}` });
  a.setAttr("target", "_blank");
  a.setAttr("rel", "noopener");
  a.title = t("card.s2.checking");

  // Run the lookup + paint result. Extracted so a click on a `?` badge can
  // re-run it after invalidating the cached miss. S2 caches negative results
  // for 24h to be a good citizen, but rate-limit blips shouldn't pin a `?`
  // for a day — let the user force a retry.
  const paint = (): void => {
    a.title = t("card.s2.checking");
    void s2.lookup(doi || undefined, title || undefined).then((paper) => {
      if (!paper) {
        a.removeClass("zoob-card__badge--scholar");
        a.addClass("zoob-card__badge--na");
        a.addClass("zoob-card__badge--retry");
        label.setText(` ${t("card.s2.na")}`);
        a.removeAttribute("href");
        a.title = t("card.s2.notFound");
        return;
      }
      a.removeClass("zoob-card__badge--na");
      a.removeClass("zoob-card__badge--retry");
      a.addClass("zoob-card__badge--scholar");
      label.setText(` ${t("card.s2.citedBy", { count: paper.citationCount })}`);
      a.setAttr("href", s2PaperUrl(paper.paperId));
      a.title = t("card.s2.openPage");
    });
  };

  a.addEventListener("click", (e) => {
    // Only intercept when the badge is in the `?` state (no href). Once a
    // real count is painted, fall through to the anchor's href so the click
    // opens the S2 paper page.
    if (a.hasAttribute("href")) return;
    e.preventDefault();
    s2.invalidate(doi || undefined, title || undefined);
    paint();
  });

  paint();
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
  const annKey = plural(all.length, "card.annotations_one", "card.annotations_other");
  toggle.createSpan({ text: ` ${t(annKey, { count: all.length })}` });
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
    if (!inserted) new Notice(t("notice.openNoteForQuote"));
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
