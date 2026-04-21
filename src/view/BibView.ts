import { ItemView, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import type ZoobPlugin from "../main";
import type { ZoobItem } from "../bbt/types";
import { BBTConnectionError } from "../bbt/client";
import { renderBibRow, renderItemCard } from "./ItemCard";
import { extractCitekeys } from "../util/citations";
import { readBibPath } from "../util/frontmatter";

export const ZOOB_VIEW_TYPE = "zoob-bibliography";

type State = "idle" | "loading" | "offline" | "empty" | "ready";

export class BibView extends ItemView {
  private zoobState: State = "idle";
  private stateEl!: HTMLElement;
  private listEl!: HTMLElement;
  private headerEl!: HTMLElement;
  private infoEl!: HTMLElement;
  private healthDot!: HTMLElement;
  private currentFile: TFile | null = null;
  private lastKeys: string[] = [];
  /** Items last passed to render() — used to re-render instantly on density toggle. */
  private lastItems: ZoobItem[] = [];
  /**
   * Monotonic token bumped on every refresh() call. Any in-flight fetch that
   * finishes after a newer refresh has started compares its captured token to
   * this one and bails out instead of clobbering the new file's view. Required
   * because switching to a different note mid-fetch is extremely common on
   * large libraries where Zotero takes seconds to respond.
   */
  private refreshToken = 0;

  constructor(leaf: WorkspaceLeaf, private plugin: ZoobPlugin) {
    super(leaf);
    // Set the icon synchronously so Obsidian doesn't show a placeholder glyph
    // during the first render of the leaf's tab/header.
    this.icon = "book-marked";
  }

  getViewType(): string {
    return ZOOB_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Zoob references";
  }

  getIcon(): string {
    return "book-marked";
  }

  async onOpen(): Promise<void> {
    this.containerEl.addClass("zoob-view");
    const root = this.contentEl;
    root.empty();

    this.headerEl = root.createDiv({ cls: "zoob-view__header" });
    const title = this.headerEl.createEl("div", { cls: "zoob-view__title", text: "References" });
    title.createEl("span", { cls: "zoob-view__count" });

    const actions = this.headerEl.createDiv({ cls: "zoob-view__actions" });
    this.healthDot = actions.createEl("span", {
      cls: "zoob-view__health zoob-view__health--unknown",
      attr: { title: "Zotero connection status", "aria-label": "Zotero connection status" },
    });
    setIcon(this.healthDot, "help-circle");

    const densityBtn = actions.createEl("button", {
      cls: "zoob-view__icon-button",
    });
    const updateDensityButton = () => {
      // Icon + tooltip describe the action, not the current state.
      const next = this.plugin.settings.bibDensity === "compact" ? "detailed" : "compact";
      setIcon(densityBtn, next === "detailed" ? "layout-grid" : "list");
      const tip = next === "detailed" ? "Switch to detailed view" : "Switch to compact view";
      densityBtn.setAttr("title", tip);
      densityBtn.setAttr("aria-label", tip);
    };
    updateDensityButton();
    densityBtn.addEventListener("click", () => {
      // Flip and re-render synchronously from the last rendered items so the
      // toggle feels instant. Persist the setting in the background.
      this.plugin.settings.bibDensity =
        this.plugin.settings.bibDensity === "compact" ? "detailed" : "compact";
      updateDensityButton();
      if (this.zoobState === "ready" && this.lastItems.length > 0) {
        this.render(this.lastItems, this.lastKeys);
      }
      void this.plugin.saveSettings();
    });

    const refreshBtn = actions.createEl("button", {
      cls: "zoob-view__icon-button",
      attr: { "aria-label": "Refresh", title: "Refresh from Zotero" },
    });
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.addEventListener("click", () => void this.refresh({ force: true }));

    this.infoEl = root.createDiv({ cls: "zoob-view__info" });
    this.stateEl = root.createDiv({ cls: "zoob-view__state" });
    this.listEl = root.createDiv({ cls: "zoob-view__list" });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => void this.refresh()),
    );
    // No metadataCache.on("changed") listener — the plugin's vault.on("modify")
    // debounces a single refresh per save; doubling up here just re-triggers
    // the same work and re-starts an in-flight fetch.

    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /** Public trigger — main.ts calls this when the editor changes. */
  async onEditorChanged(file: TFile | null): Promise<void> {
    if (file !== this.currentFile) {
      await this.refresh();
      return;
    }
    // Same file: only re-render if citekey set changed.
    if (!file) return;
    const source = await this.app.vault.cachedRead(file);
    const keys = extractCitekeys(source);
    if (!sameArray(keys, this.lastKeys)) {
      await this.refresh();
    }
  }

  async refresh(opts: { force?: boolean } = {}): Promise<void> {
    const file = this.app.workspace.getActiveFile();

    if (!file) {
      // Don't cancel an in-flight fetch for a real file when the focus
      // transiently lands on something with no active file.
      this.refreshToken++;
      this.currentFile = null;
      this.lastKeys = [];
      return this.setStatus("idle", "Open a note to see its references here.");
    }

    const source = await this.app.vault.cachedRead(file);
    const keys = extractCitekeys(source);

    // Short-circuit BEFORE bumping the refresh token so a duplicate trigger
    // (e.g. auto-save event arriving while the previous fetch is still running
    // for the same citekeys) doesn't cancel the in-flight work and start over.
    // We accept any non-"offline" state here — "loading" means a fetch is
    // already in progress for these same keys.
    if (
      !opts.force
      && file === this.currentFile
      && sameArray(keys, this.lastKeys)
      && (this.zoobState === "ready" || this.zoobState === "loading")
    ) {
      return;
    }

    const token = ++this.refreshToken;
    this.currentFile = file;
    this.lastKeys = keys;

    this.updateInfo(file, keys.length);

    if (keys.length === 0) {
      return this.setStatus(
        "empty",
        "No citations in this note yet. Type `[@` to start.",
      );
    }

    // Synchronous cache peek: if everything is already hydrated (at least to
    // meta level), render straight from cache with no loading flash. Common
    // case when switching between tabs you've already visited.
    const bibPath = readBibPath(this.app, file);
    const cached = opts.force ? null : this.plugin.peekCachedItems(keys);
    if (cached) {
      this.render(cached, keys);
      this.setHealth(true);
      // Still fire the phase-2 upgrade for any meta-level items in the cache.
      this.backgroundUpgrade(cached, file, keys, token);
      return;
    }

    this.renderLoading(keys.length);

    try {
      // Phase 1: render with CSL + formatted bibliography (fast; usually one RPC).
      const fastItems = await this.plugin.getItemsFast(keys, {
        force: opts.force,
        bibPath,
      });
      if (token !== this.refreshToken) return;
      this.render(fastItems, keys);
      this.setHealth(true);

      this.backgroundUpgrade(fastItems, file, keys, token);
    } catch (e) {
      if (token !== this.refreshToken) return;
      this.setHealth(false, (e as Error).message);
      if (e instanceof BBTConnectionError) {
        this.renderOffline((e as Error).message);
      } else {
        this.renderBbtError((e as Error).message);
      }
    }
  }

  /**
   * Fire off phase-2 attachment hydration in the background. Only acts on
   * meta-level items; full items pass through untouched. Guarded against
   * stale state so switching tabs mid-upgrade doesn't clobber the new view.
   */
  private backgroundUpgrade(items: ZoobItem[], file: TFile, keys: string[], token: number): void {
    const needsUpgrade = items.some((i) => i.hydratedLevel === "meta");
    if (!needsUpgrade) return;
    void this.plugin.upgradeItems(items).then((fullItems) => {
      if (token !== this.refreshToken) return;
      if (this.currentFile !== file) return;
      if (!sameArray(this.lastKeys, keys)) return;
      if (this.zoobState !== "ready") return;
      this.render(fullItems, keys);
    }).catch(() => {
      // Attachment upgrade failures are non-fatal.
    });
  }

  private renderLoading(count: number): void {
    this.zoobState = "loading";
    this.stateEl.empty();
    this.listEl.empty();
    const box = this.stateEl.createDiv({ cls: "zoob-view__message zoob-view__message--loading" });
    const spinner = box.createDiv({ cls: "zoob-spinner" });
    spinner.createDiv({ cls: "zoob-spinner__ring" });
    const noun = count === 1 ? "citation" : "citations";
    box.createSpan({ text: `Loading ${count} ${noun} from Zotero…` });
  }

  private renderBbtError(message: string): void {
    this.zoobState = "offline";
    this.stateEl.empty();
    this.listEl.empty();
    const box = this.stateEl.createDiv({
      cls: "zoob-view__message zoob-view__message--offline",
    });
    box.createDiv({ cls: "zoob-view__error-title", text: "Zotero returned an error" });
    box.createDiv({ cls: "zoob-view__error-detail", text: message });
    const hint = box.createDiv({ cls: "zoob-view__error-hint" });
    hint.createSpan({ text: "Check that the citekeys in this note exist in the library named by the " });
    hint.createEl("code", { text: "bib:" });
    hint.createSpan({ text: " frontmatter." });
    const actions = box.createDiv({ cls: "zoob-view__error-actions" });
    const retry = actions.createEl("button", { cls: "zoob-view__error-button", text: "Try again" });
    retry.addEventListener("click", () => void this.refresh({ force: true }));
  }

  private renderOffline(message: string): void {
    this.zoobState = "offline";
    this.stateEl.empty();
    this.listEl.empty();
    const box = this.stateEl.createDiv({
      cls: "zoob-view__message zoob-view__message--offline",
    });
    box.createDiv({ cls: "zoob-view__error-title", text: "Couldn't reach Zotero" });
    box.createDiv({ cls: "zoob-view__error-detail", text: message });
    const hint = box.createDiv({ cls: "zoob-view__error-hint" });
    hint.createSpan({ text: "Make sure Zotero is running with the " });
    const a = hint.createEl("a", {
      text: "Better BibTeX",
      attr: { href: "https://retorque.re/zotero-better-bibtex/installation/" },
    });
    a.setAttr("target", "_blank");
    a.setAttr("rel", "noopener");
    hint.createSpan({ text: " extension." });
    const actions = box.createDiv({ cls: "zoob-view__error-actions" });
    const retry = actions.createEl("button", { cls: "zoob-view__error-button", text: "Try again" });
    retry.addEventListener("click", () => void this.refresh({ force: true }));
    const openZotero = actions.createEl("button", { cls: "zoob-view__error-button", text: "Open Zotero" });
    openZotero.addEventListener("click", () => {
      window.open("zotero://select/library", "_self");
    });
  }

  private updateInfo(file: TFile, count: number): void {
    this.infoEl.empty();
    const bib = readBibPath(this.app, file);
    const fileLabel = this.infoEl.createSpan({ cls: "zoob-view__file", text: file.basename });
    if (bib) {
      this.infoEl.createSpan({ cls: "zoob-view__sep", text: " · " });
      this.infoEl.createSpan({ cls: "zoob-view__bib", text: bib });
    }
    const countEl = this.headerEl.querySelector(".zoob-view__count");
    if (countEl) countEl.setText(count > 0 ? ` (${count})` : "");
    void fileLabel;
  }

  private setStatus(state: State, message?: string): void {
    this.zoobState = state;
    this.stateEl.empty();
    this.listEl.empty();
    if (!message) return;
    const box = this.stateEl.createDiv({ cls: `zoob-view__message zoob-view__message--${this.zoobState}` });
    // Preserve newlines in the message.
    for (const line of message.split("\n")) {
      box.createDiv({ text: line });
    }
  }

  private setHealth(ok: boolean, message?: string): void {
    if (!this.healthDot) return;
    this.healthDot.removeClass("zoob-view__health--unknown");
    this.healthDot.removeClass("zoob-view__health--ok");
    this.healthDot.removeClass("zoob-view__health--bad");
    this.healthDot.addClass(ok ? "zoob-view__health--ok" : "zoob-view__health--bad");
    const label = ok
      ? "Connected to Zotero"
      : `Zotero unreachable${message ? ` — ${message}` : ""}`;
    this.healthDot.setAttr("title", label);
    this.healthDot.setAttr("aria-label", label);
    setIcon(this.healthDot, ok ? "check-circle" : "alert-triangle");
  }

  private render(items: ZoobItem[], requestedKeys: string[]): void {
    this.setStatus("ready");
    this.lastItems = items;
    this.listEl.empty();
    // Warn about citekeys present in the note but missing from Zotero / the
    // specified library — common when the `bib:` path points to the wrong
    // collection.
    const foundKeys = new Set(items.map((it) => it.citekey));
    const missing = requestedKeys.filter((k) => !foundKeys.has(k));
    if (missing.length > 0) {
      const warn = this.listEl.createDiv({ cls: "zoob-view__missing" });
      const title = warn.createDiv({ cls: "zoob-view__missing-title" });
      setIcon(title.createSpan({ cls: "zoob-view__missing-icon" }), "alert-triangle");
      title.createSpan({
        text: ` Not found in Zotero (${missing.length}) — check \`bib:\` frontmatter`,
      });
      const list = warn.createDiv({ cls: "zoob-view__missing-list" });
      for (const k of missing) list.createEl("code", { text: `@${k}` });
    }
    const density = this.plugin.settings.bibDensity;
    this.listEl.toggleClass("zoob-view__list--detailed", density === "detailed");
    items.forEach((it, i) => {
      if (density === "detailed") {
        renderItemCard(this.listEl, this.plugin, it, "panel", { index: i });
      } else {
        renderBibRow(this.listEl, this.plugin, it, i);
      }
    });
  }

  /** Highlight a given citekey briefly — called when user hovers a cite token. */
  flashCitekey(citekey: string): void {
    const sel = `[data-citekey="${cssEscape(citekey)}"]`;
    const el = this.listEl.querySelector<HTMLElement>(sel);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    el.classList.remove("zoob-bibrow--flash");
    void el.offsetWidth;
    el.classList.add("zoob-bibrow--flash");
  }

  /**
   * Re-run the renderer against the items we last showed, without refetching.
   * Used for purely presentational setting changes (density, author compact).
   */
  rerenderFromCache(): void {
    if (this.zoobState !== "ready" || this.lastItems.length === 0) return;
    this.render(this.lastItems, this.lastKeys);
  }
}

function sameArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function cssEscape(v: string): string {
  // Tight selector: escape double-quotes and backslashes only (attr selector).
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
