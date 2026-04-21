import {
  Editor,
  MarkdownFileInfo,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { BBTClient, BBTConnectionError, resolveCollection } from "./bbt/client";
import { ItemCache } from "./bbt/cache";
import type { ZoobItem } from "./bbt/types";
import {
  CSL_STYLES,
  DEFAULT_SETTINGS,
  ZoobSettings,
  ZoobSettingTab,
  effectiveCslId,
} from "./settings";
import { BibView, ZOOB_VIEW_TYPE } from "./view/BibView";
import { HoverCard } from "./view/HoverCard";
import { CitationSuggest, SuggestItem } from "./editor/CitationSuggest";
import { citeTokenExtension } from "./editor/CiteTokenExtension";
import { clearRefsBlockCache, refsBlockPostProcessor } from "./editor/RefsBlockPostProcessor";
import { matchCitationAt } from "./util/citations";
import { readBibPath } from "./util/frontmatter";
import { zoteroSelectByKey } from "./util/zoteroLinks";
import { tagsOf, venueOf, yearOf } from "./util/format";

export default class ZoobPlugin extends Plugin {
  settings!: ZoobSettings;
  bbt!: BBTClient;
  cache!: ItemCache;
  hoverCard!: HoverCard;

  private refreshDebounce: number | null = null;
  // Last markdown leaf the user focused. Used so that clicking action buttons
  // in the side panel (which steals focus) still inserts into the last note.
  private lastMdLeaf: WorkspaceLeaf | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.bbt = new BBTClient({ endpoint: this.settings.bbtEndpoint });
    this.cache = new ItemCache(this.settings.cacheTtlMs);
    // Load the persisted item cache before the first view refresh so warm
    // citekeys don't trigger a BBT round-trip on startup.
    const cachePath = `${this.manifest.dir ?? ".obsidian/plugins/zoob"}/cache.json`;
    await this.cache.attachDisk(this.app, cachePath);
    this.hoverCard = new HoverCard(this);

    this.registerView(ZOOB_VIEW_TYPE, (leaf: WorkspaceLeaf) => new BibView(leaf, this));
    this.addSettingTab(new ZoobSettingTab(this.app, this));

    // Editor integrations.
    this.registerEditorSuggest(new CitationSuggest(this.app, this));
    this.registerEditorExtension(citeTokenExtension(this));
    this.registerMarkdownPostProcessor(refsBlockPostProcessor(this));

    // Reading-mode: hover on citations by DOM delegation, since the CM6
    // extension doesn't apply there.
    this.registerDomEvent(document, "mouseover", (e) => this.handleReadingHoverIn(e));
    this.registerDomEvent(document, "mouseout", (e) => this.handleReadingHoverOut(e));

    // File modifications DO NOT auto-refresh the bibliography panel. BBT
    // round-trips are slow enough on large libraries that refetching every
    // keystroke-save thrashes the UI; the user pulls via the refresh button,
    // a command, or the obsidian://zoob?action=refresh URI when ready. We
    // still poke the view-header action count here because that's a cheap
    // local extract.
    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        if (!(f instanceof TFile)) return;
        if (f !== this.app.workspace.getActiveFile()) return;
        void this.updateActionState();
      }),
    );

    // No `editor-change` listener: that fires per keystroke and (even debounced)
    // kicks the bibliography refresh — which hits BBT. vault.on("modify") above
    // already covers in-app edits once Obsidian auto-saves, and terminal edits
    // from outside, without punishing every keystroke.

this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf && leaf.view instanceof MarkdownView) {
          this.lastMdLeaf = leaf;
          this.installViewAction(leaf.view);
        }
        // BibView listens for active-leaf-change itself and refreshes
        // immediately; don't re-trigger via the debounced schedule here, or
        // every tab switch fires two refreshes (one now, one 300 ms later).
        void this.updateActionState();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.sweepInstallViewActions()),
    );
    // layout-change fires when tabs are opened, closed, or rearranged. This
    // catches cases active-leaf-change misses — e.g. opening a new tab
    // without making it active.
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.sweepInstallViewActions()),
    );

    // Right-click in the editor: offer the Zotero picker. Placed at the top
    // of the Zotero-related section of the context menu.
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        menu.addItem((item) => {
          item
            .setTitle("Insert citation from Zotero…")
            .setIcon("quote")
            .onClick(() => void this.insertCitationViaZoteroPicker(editor));
        });
      }),
    );

    // Commands.
    this.addCommand({
      id: "open-references-panel",
      name: "Open references panel",
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: "insert-citation",
      name: "Insert citation",
      editorCallback: (editor: Editor) => {
        // Insert `[@` and let the suggester take over.
        const cur = editor.getCursor();
        editor.replaceRange("[@]", cur);
        editor.setCursor({ line: cur.line, ch: cur.ch + 2 });
      },
    });
    this.addCommand({
      id: "insert-citation-via-zotero-picker",
      name: "Insert citation from Zotero (picker dialog)",
      editorCallback: (editor: Editor) => void this.insertCitationViaZoteroPicker(editor),
    });
    this.addCommand({
      id: "insert-refs-block",
      name: "Insert references block",
      editorCallback: (editor: Editor) => {
        const cur = editor.getCursor();
        editor.replaceRange("\n::: {#refs}\n:::\n", cur);
      },
    });
    this.addCommand({
      id: "refresh-current-note",
      name: "Refresh Zotero data for current note",
      callback: () => void this.doRefreshPaths(undefined, { notify: true }),
    });
    this.addCommand({
      id: "refresh-all",
      name: "Refresh Zotero data (entire cache)",
      callback: () => void this.doRefreshAll({ notify: true }),
    });

    // External-trigger hook. Other apps (e.g. Claude Code running in a
    // terminal next to this vault) can invalidate the cache without the user
    // clicking anything. Scope is per-note by default — callers opt in to a
    // full wipe explicitly.
    //   open 'obsidian://zoob?action=refresh'                  → active note
    //   open 'obsidian://zoob?action=refresh&path=Notes/x.md'  → that note
    //   open 'obsidian://zoob?action=refresh&path=a.md&path=b.md'  → multi
    //   open 'obsidian://zoob?action=refresh-all'              → whole cache
    //   open 'obsidian://zoob?action=open'                     → show panel
    // Per Obsidian's API, `registerObsidianProtocolHandler` only fires for
    // the `obsidian://<handler>` scheme, so there's no collision with
    // arbitrary external URLs.
    this.registerObsidianProtocolHandler("zoob", (params) => {
      const action = (params.action ?? "").toLowerCase();
      if (action === "refresh") {
        const paths = collectPathParams(params);
        void this.doRefreshPaths(paths.length > 0 ? paths : undefined, { notify: true });
      } else if (action === "refresh-all") {
        void this.doRefreshAll({ notify: true });
      } else if (action === "open" || action === "open-panel") {
        void this.activateView();
      } else {
        new Notice(`zoob: unknown action "${action}"`);
      }
    });
    this.addCommand({
      id: "open-item-in-zotero",
      name: "Open item in Zotero (citation under cursor)",
      editorCallback: (editor: Editor) => void this.openCiteUnderCursor(editor, "zotero"),
    });
    this.addCommand({
      id: "open-attachment",
      name: "Open attachment (citation under cursor)",
      editorCallback: (editor: Editor) => void this.openCiteUnderCursor(editor, "pdf"),
    });
    this.addCommand({
      id: "insert-meta-block",
      name: "Insert item metadata block (citation under cursor)",
      editorCallback: (editor: Editor) => void this.insertMetaBlockAtCursor(editor),
    });
    this.addCommand({
      id: "copy-as-csl-json",
      name: "Copy item as CSL-JSON (citation under cursor)",
      editorCallback: (editor: Editor) => void this.copyCslJsonAtCursor(editor),
    });

    // Install the view-header action on any already-open markdown views.
    this.app.workspace.onLayoutReady(() => {
      this.sweepInstallViewActions();
      void this.updateActionState();
    });
  }

  onunload(): void {
    this.hoverCard.dispose();
    // Sweep any view-header action buttons we installed.
    document.querySelectorAll(".zoob-view-action").forEach((n) => n.remove());
    // Flush any pending cache write. Fire-and-forget: Obsidian won't wait on
    // an async onunload, but the adapter write is fast and typically completes.
    void this.cache.flush();
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<ZoobSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
    // Make sure selected cslStyleId is still valid; else keep user value as custom.
    if (!CSL_STYLES.some((s) => s.id === this.settings.cslStyleId) && !this.settings.cslCustomId) {
      this.settings.cslCustomId = this.settings.cslStyleId;
      this.settings.cslStyleId = DEFAULT_SETTINGS.cslStyleId;
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Reflect whether the active note has citations on the view-header action —
   * muted (greyed) when zero, highlighted with a count tooltip when non-zero.
   * The action stays clickable regardless so the user can open the empty panel.
   */
  async updateActionState(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    let count = 0;
    if (file) {
      try {
        const src = await this.app.vault.cachedRead(file);
        const { extractCitekeys } = await import("./util/citations");
        count = new Set(extractCitekeys(src)).size;
      } catch {
        count = 0;
      }
    }
    const tip = !file
      ? "zoob: no note open"
      : count === 0
        ? "zoob: no citations in this note"
        : `zoob: ${count} citation${count === 1 ? "" : "s"}`;
    document.querySelectorAll(".zoob-view-action").forEach((el) => {
      (el as HTMLElement).toggleClass("zoob-action--muted", count === 0);
      el.setAttribute("aria-label", tip);
      el.setAttribute("title", tip);
    });
  }

  /** Sweep all open markdown views and ensure each has the action button. */
  private sweepInstallViewActions(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) this.installViewAction(leaf.view);
    });
  }

  /**
   * Add a library action button to the top-right of a markdown view's
   * header, next to "Properties" / Git / other plugins. Clicking it opens the
   * references panel. Idempotent — verifies the DOM node still exists before
   * considering the view "already installed" (Obsidian rebuilds the actions
   * row on some transitions).
   */
  private installViewAction(view: MarkdownView): void {
    const marker = "__zoobActionEl";
    const v = view as unknown as Record<string, unknown>;
    const prev = v[marker] as HTMLElement | undefined;
    if (prev && prev.isConnected) return;
    const el = view.addAction("quote", "zoob: references", () => {
      void this.activateView();
    });
    el.addClass("zoob-view-action");
    v[marker] = el;
    void this.updateActionState();
  }

  effectiveCslId(): string {
    return effectiveCslId(this.settings);
  }

  currentBibPath(): string | undefined {
    return readBibPath(this.app, this.app.workspace.getActiveFile());
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(ZOOB_VIEW_TYPE)[0];
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: ZOOB_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /** Hydrate citekeys through the cache; resolves `libraryID` from `bib:` if possible. */
  async getItems(
    citekeys: string[],
    opts: { force?: boolean; bibPath?: string } = {},
  ): Promise<ZoobItem[]> {
    if (opts.force) this.cache.invalidate();
    const { hits, misses } = this.cache.getMany(citekeys);
    // Upgrade any meta-level hits in place before returning, so callers of
    // getItems() (insert-meta-block, open-PDF, etc.) always see attachments.
    const metaHits = hits.filter((h) => h.hydratedLevel === "meta");
    if (misses.length === 0 && metaHits.length === 0) return orderBy(hits, citekeys);

    const libraryID = await this.resolveLibraryID(opts.bibPath);

    const fetched = misses.length > 0
      ? await this.bbt.hydrate(misses, libraryID, this.effectiveCslId())
      : [];
    if (fetched.length > 0) this.cache.putMany(fetched);

    const upgraded = metaHits.length > 0
      ? await this.bbt.hydrateAttachments(metaHits)
      : [];
    if (upgraded.length > 0) this.cache.putMany(upgraded.filter((u) => u.hydratedLevel === "full"));

    const fullHits = hits.map((h) => upgraded.find((u) => u.citekey === h.citekey) ?? h);
    return orderBy([...fullHits, ...fetched], citekeys);
  }

  /**
   * Fast first-pass hydration for the side panel: returns items with CSL
   * metadata and formatted bibliography HTML, but empty attachments/notes.
   * Typically one RPC round-trip regardless of citekey count.
   */
  async getItemsFast(
    citekeys: string[],
    opts: { force?: boolean; bibPath?: string } = {},
  ): Promise<ZoobItem[]> {
    if (opts.force) this.cache.invalidate();
    const { hits, misses } = this.cache.getMany(citekeys);
    if (misses.length === 0) return orderBy(hits, citekeys);

    const libraryID = await this.resolveLibraryID(opts.bibPath);
    // Compact density renders from our own CSL-JSON formatter, so skip the
    // `item.bibliography` RPC entirely — halves the fast-path round-trip.
    // Detailed density still pulls BBT's formatted HTML.
    const cslStyleId =
      this.settings.bibDensity === "detailed" ? this.effectiveCslId() : undefined;
    const fetched = await this.bbt.hydrateMeta(misses, libraryID, cslStyleId);
    // Store meta-level items in the cache so subsequent fast lookups hit it.
    this.cache.putMany(fetched);
    return orderBy([...hits, ...fetched], citekeys);
  }

  /**
   * Synchronous cache peek. Returns the ordered items if every citekey is
   * present in the cache, else null. Lets the side panel skip the "loading"
   * flash when switching back to a tab it has already rendered.
   */
  peekCachedItems(citekeys: string[]): ZoobItem[] | null {
    const out: ZoobItem[] = [];
    for (const k of citekeys) {
      const it = this.cache.get(k);
      if (!it) return null;
      out.push(it);
    }
    return out;
  }

  /**
   * Upgrade the given items to full hydration (attachments/notes/zoteroKey).
   * Writes the fully-hydrated items back to the cache so later getItems()
   * calls don't re-fetch.
   */
  async upgradeItems(items: ZoobItem[]): Promise<ZoobItem[]> {
    const full = await this.bbt.hydrateAttachments(items);
    this.cache.putMany(full.filter((i) => i.hydratedLevel === "full"));
    return full;
  }

  private async resolveLibraryID(bibPath?: string): Promise<number | undefined> {
    if (!bibPath) return undefined;
    try {
      const libs = await this.bbt.libraries();
      const found = resolveCollection(libs, bibPath);
      return found?.library.id;
    } catch {
      return undefined;
    }
  }

  /**
   * Suggest citations by querying the *whole* Zotero library via BBT
   * `item.search`. Returns search-result fields directly — no CSL hydration —
   * so the suggester stays snappy even on large libraries.
   */
  async searchForSuggest(query: string): Promise<SuggestItem[]> {
    const q = query.trim();
    // Two chars min — a single letter against a big library triggers an
    // expensive full-table search inside Zotero's indexer.
    if (q.length < 2) return [];
    // Scope the search when the active note has a `bib:` library. Without it,
    // fan out one search per library in parallel so wall time is ~max(per-lib)
    // rather than sum — BBT's `item.search` otherwise walks libraries serially.
    const libraryID = await this.resolveLibraryID(this.currentBibPath());
    try {
      const perCall = 12000;
      const rawResults = libraryID != null
        ? await this.bbt.search(q, libraryID, perCall)
        : await this.searchAllLibrariesParallel(q, perCall);
      // De-duplicate by citekey in case a fan-out produces overlaps.
      const seen = new Set<string>();
      const deduped: typeof rawResults = [];
      for (const r of rawResults) {
        if (seen.has(r.citekey)) continue;
        seen.add(r.citekey);
        deduped.push(r);
      }
      return deduped.slice(0, 25).map((r) => ({
        citekey: r.citekey,
        title: r.title ?? "",
        author: r.author ?? "",
        year: extractYear(r.date ?? ""),
      }));
    } catch (e) {
      if (e instanceof BBTConnectionError) {
        new Notice(`zoob suggest: ${e.message}`, 4000);
      }
      return [];
    }
  }

  /**
   * Parallel fan-out across every library — each call is scoped so BBT can
   * short-circuit, and we merge results. Individual-library failures (timeout,
   * error) are swallowed so a slow library can't hide results from a fast one.
   */
  private async searchAllLibrariesParallel(
    q: string,
    timeoutMs: number,
  ): Promise<Array<{ citekey: string; title?: string; author?: string; date?: string; itemType?: string }>> {
    let libs;
    try {
      libs = await this.bbt.libraries();
    } catch {
      // If we can't list libraries, fall through to a plain unscoped call.
      return this.bbt.search(q, undefined, timeoutMs);
    }
    if (!libs.length) return this.bbt.search(q, undefined, timeoutMs);
    const results = await Promise.all(
      libs.map((lib) => this.bbt.search(q, lib.id, timeoutMs).catch(() => [])),
    );
    return results.flat();
  }

  insertCitationAtCursor(citekey: string): void {
    const view = this.resolveMdView();
    if (!view) {
      new Notice("No active markdown editor.");
      return;
    }
    view.editor.replaceSelection(`[@${citekey}]`);
  }

  /**
   * Insert a citation via Zotero's CAYW picker — the same dialog Word and
   * Google Docs use. Pandoc format returns `[@citekey]` (or `[@a; @b]` for
   * multi-pick) which we drop straight in. Cancelling the dialog returns an
   * empty string; we silently no-op in that case.
   */
  async insertCitationViaZoteroPicker(editor?: Editor): Promise<void> {
    const target = editor ?? this.resolveMdView()?.editor;
    if (!target) {
      new Notice("No active markdown editor.");
      return;
    }
    // Remember the cursor now — by the time the user returns from Zotero,
    // focus may have moved and getCursor() would be wrong.
    const insertAt = target.getCursor();
    const note = new Notice("Pick a reference in Zotero…", 0);
    try {
      // Don't pass `minimize` and don't steal focus back — both caused worse
      // side effects (orphan bubble / Zotero main window getting minimized).
      // Let Zotero manage its own window state; macOS will return focus to
      // Obsidian automatically when the user clicks back.
      const text = await this.bbt.cayw({ format: "pandoc", brackets: true });
      if (!text) return; // user cancelled
      target.replaceRange(text, insertAt);
      // Place cursor just after the inserted citation.
      target.setCursor({ line: insertAt.line, ch: insertAt.ch + text.length });
    } catch (e) {
      new Notice(`Zotero picker failed: ${(e as Error).message}`, 5000);
    } finally {
      note.hide();
    }
  }

  /** Insert arbitrary text at the active editor's cursor. Returns false if no editor. */
  insertTextAtCursor(text: string): boolean {
    const view = this.resolveMdView();
    if (!view) return false;
    view.editor.replaceSelection(text);
    return true;
  }

  /**
   * Return the best MarkdownView to target for insertions. Prefers the
   * currently-active one; falls back to the last-focused markdown leaf (so
   * clicking a side-panel button doesn't lose the target just because the
   * panel took focus).
   */
  private resolveMdView(): MarkdownView | null {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) return active;
    if (this.lastMdLeaf && this.lastMdLeaf.view instanceof MarkdownView) {
      return this.lastMdLeaf.view;
    }
    return null;
  }

  async openCitekeyInZotero(citekey: string): Promise<void> {
    try {
      const [item] = await this.getItems([citekey], { bibPath: this.currentBibPath() });
      if (!item?.zoteroKey) {
        new Notice(`No Zotero link for @${citekey}`);
        return;
      }
      window.open(zoteroSelectByKey(item.zoteroKey, item.libraryID), "_self");
    } catch (e) {
      new Notice(`zoob: ${(e as Error).message}`);
    }
  }

  private async openCiteUnderCursor(editor: Editor, kind: "zotero" | "pdf"): Promise<void> {
    const pos = editor.getCursor();
    const lineText = editor.getLine(pos.line);
    const match = matchCitationAt(lineText, pos.ch);
    if (!match) {
      new Notice("No citation under cursor.");
      return;
    }
    const items = await this.getItems([match.citekey], { bibPath: this.currentBibPath() });
    const item = items[0];
    if (!item) {
      new Notice(`No Zotero item for @${match.citekey}`);
      return;
    }
    if (kind === "zotero") {
      if (!item.zoteroKey) {
        new Notice("No Zotero item key available.");
        return;
      }
      window.open(zoteroSelectByKey(item.zoteroKey, item.libraryID), "_self");
      return;
    }
    // kind === "pdf"
    const { primaryPdf } = await import("./util/zoteroLinks");
    const pdf = primaryPdf(item.attachments);
    if (!pdf) {
      new Notice("No PDF attachment on this item.");
      return;
    }
    const { openPdf } = await import("./view/ItemCard");
    openPdf(this, item, pdf, false);
  }

  private async insertMetaBlockAtCursor(editor: Editor): Promise<void> {
    const pos = editor.getCursor();
    const match = matchCitationAt(editor.getLine(pos.line), pos.ch);
    if (!match) {
      new Notice("Put the cursor on a [@citekey] first.");
      return;
    }
    const items = await this.getItems([match.citekey], { bibPath: this.currentBibPath() });
    const item = items[0];
    if (!item) {
      new Notice(`No Zotero item for @${match.citekey}`);
      return;
    }
    const block = buildMetaBlock(item);
    editor.replaceRange(`\n${block}\n`, { line: pos.line, ch: editor.getLine(pos.line).length });
  }

  private async copyCslJsonAtCursor(editor: Editor): Promise<void> {
    const pos = editor.getCursor();
    const match = matchCitationAt(editor.getLine(pos.line), pos.ch);
    if (!match) {
      new Notice("Put the cursor on a [@citekey] first.");
      return;
    }
    const items = await this.getItems([match.citekey], { bibPath: this.currentBibPath() });
    if (!items[0]) {
      new Notice(`No Zotero item for @${match.citekey}`);
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(items[0].csl, null, 2));
    new Notice(`Copied CSL-JSON for @${match.citekey}`);
  }

  // --- reading-mode hover handling ---

  private handleReadingHoverIn(e: MouseEvent): void {
    const t = e.target as HTMLElement | null;
    if (!t || !(t instanceof HTMLElement)) return;
    // Reading mode renders `[@key]` as plain text inside a paragraph. We detect
    // by regex over the mouseover'd text node's text, locating the key and its
    // bounding client rect via a Range.
    const node = t;
    const reading = node.closest(".markdown-reading-view, .markdown-preview-view");
    if (!reading) return;
    // Walk the text node containing the pointer position.
    const caret = document.caretPositionFromPoint?.(e.clientX, e.clientY)
      ?? (document as unknown as {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      }).caretRangeFromPoint?.(e.clientX, e.clientY);
    let range: Range | null = null;
    let textNode: Text | null = null;
    let offset = 0;
    if (caret instanceof Range) {
      range = caret;
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        textNode = range.startContainer as Text;
        offset = range.startOffset;
      }
    } else if (caret && "offsetNode" in caret) {
      const cp = caret as { offsetNode: Node; offset: number };
      if (cp.offsetNode.nodeType === Node.TEXT_NODE) {
        textNode = cp.offsetNode as Text;
        offset = cp.offset;
      }
    }
    if (!textNode) return;
    const text = textNode.nodeValue ?? "";
    const hit = matchCitationAt(text, offset);
    if (!hit) return;
    // Create a Range for just the [@key] substring to position the popover.
    const anchor = document.createRange();
    try {
      anchor.setStart(textNode, hit.start);
      anchor.setEnd(textNode, hit.end);
    } catch {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    this.hoverCard.scheduleShow(hit.citekey, rect);
  }

  private handleReadingHoverOut(e: MouseEvent): void {
    const related = e.relatedTarget as HTMLElement | null;
    if (related && related.closest(".zoob-hover")) return;
    this.hoverCard.scheduleHide();
  }

  // --- bib view refresh ---

  scheduleBibRefresh(): void {
    if (this.refreshDebounce !== null) window.clearTimeout(this.refreshDebounce);
    // 1.2s — long enough to collapse a typing burst, short enough that a
    // paste-and-move-on still updates the panel without feeling laggy.
    this.refreshDebounce = window.setTimeout(() => {
      this.refreshDebounce = null;
      this.refreshBibView();
      void this.updateActionState();
    }, 1200);
  }

  /**
   * Invalidate cached items cited by the given note paths, then re-render.
   * Pass `undefined` to mean "the currently-active note". Notes whose files
   * don't exist are skipped silently. The refs-block cache and BBT internal
   * caches are always cleared — they're keyed partly by citekey set, not by
   * path, so we can't do better than nuking them without more bookkeeping,
   * but they repopulate cheaply from the item cache.
   */
  async doRefreshPaths(
    paths: string[] | undefined,
    opts: { notify?: boolean } = {},
  ): Promise<void> {
    const { extractCitekeys } = await import("./util/citations");
    const files: TFile[] = [];
    if (!paths) {
      const f = this.app.workspace.getActiveFile();
      if (f) files.push(f);
    } else {
      for (const p of paths) {
        const af = this.app.vault.getAbstractFileByPath(p);
        if (af instanceof TFile) files.push(af);
      }
    }
    if (files.length === 0) {
      if (opts.notify) new Notice("zoob: no matching note to refresh");
      return;
    }
    const citekeys = new Set<string>();
    for (const f of files) {
      try {
        const src = await this.app.vault.cachedRead(f);
        for (const k of extractCitekeys(src)) citekeys.add(k);
      } catch {
        // unreadable — skip
      }
    }
    for (const k of citekeys) this.cache.invalidate(k);
    clearRefsBlockCache();
    this.refreshBibView(true);
    this.refreshRefsBlocks();
    if (opts.notify) {
      const label =
        files.length === 1 ? files[0].basename : `${files.length} notes`;
      new Notice(`zoob: refreshed ${citekeys.size} citekeys for ${label}`);
    }
  }

  /** Nuke the entire cache (item cache, BBT caches, refs-block cache) and re-render. */
  async doRefreshAll(opts: { notify?: boolean } = {}): Promise<void> {
    this.cache.invalidate();
    this.bbt.clearCaches();
    clearRefsBlockCache();
    this.refreshBibView(true);
    this.refreshRefsBlocks();
    if (opts.notify) new Notice("zoob: full cache cleared");
  }

  refreshBibView(force = false): void {
    const leaf = this.app.workspace.getLeavesOfType(ZOOB_VIEW_TYPE)[0];
    if (!leaf) return;
    const view = leaf.view as BibView;
    void view.refresh({ force });
  }

  /** Re-render the panel with the current items — use for display-only setting changes. */
  rerenderBibView(): void {
    const leaf = this.app.workspace.getLeavesOfType(ZOOB_VIEW_TYPE)[0];
    if (!leaf) return;
    (leaf.view as BibView).rerenderFromCache();
  }

  /** Force a reflow of any visible ::: {#refs} blocks. */
  refreshRefsBlocks(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    // Simplest path: trigger a re-render by touching the metadata cache.
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    view?.previewMode?.rerender?.(true);
  }
}

/** Pull a 4-digit year out of a BBT date string like "2006-10-01" or "2006". */
function extractYear(date: string): string {
  const m = /\b(\d{4})\b/.exec(date);
  return m ? m[1] : "";
}


/**
 * Extract repeated `path` query params from an obsidian:// URI. Obsidian's
 * handler gives us the params object with the *last* value for a repeated key;
 * we also accept `paths=a.md,b.md` as a pragmatic fallback and a JSON-array
 * form for callers that prefer it.
 */
function collectPathParams(params: Record<string, string>): string[] {
  const out: string[] = [];
  if (typeof params.path === "string" && params.path) out.push(params.path);
  if (typeof params.paths === "string" && params.paths) {
    const raw = params.paths.trim();
    if (raw.startsWith("[")) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) for (const p of arr) if (typeof p === "string") out.push(p);
      } catch {
        /* fall through to CSV parse */
      }
    } else {
      for (const p of raw.split(",")) {
        const t = p.trim();
        if (t) out.push(t);
      }
    }
  }
  return out;
}

function buildMetaBlock(item: ZoobItem): string {
  const csl = item.csl;
  const payload: Record<string, unknown> = {
    citekey: item.citekey,
    type: csl.type,
    title: csl.title,
    authors: (csl.author ?? []).map((a) => a.literal ?? [a.given, a.family].filter(Boolean).join(" ")),
    year: yearOf(csl) || undefined,
    venue: venueOf(csl) || undefined,
    DOI: csl.DOI,
    URL: csl.URL,
    tags: tagsOf(csl),
    abstract: csl.abstract,
  };
  // Drop undefined/empty values for a tidy block.
  for (const k of Object.keys(payload)) {
    const v = payload[k];
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) delete payload[k];
  }
  return "```zoob-meta\n" + JSON.stringify(payload, null, 2) + "\n```";
}

function orderBy(items: ZoobItem[], order: string[]): ZoobItem[] {
  const byKey = new Map(items.map((it) => [it.citekey, it] as const));
  const out: ZoobItem[] = [];
  for (const k of order) {
    const it = byKey.get(k);
    if (it) out.push(it);
  }
  return out;
}
