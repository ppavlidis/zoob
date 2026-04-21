import type ZoobPlugin from "../main";
import type { ZoobItem } from "../bbt/types";
import { renderItemCard } from "./ItemCard";

export class HoverCard {
  private el: HTMLDivElement | null = null;
  private showTimer: number | null = null;
  private hideTimer: number | null = null;
  private currentKey: string | null = null;
  private pinned = false;
  private disposed = false;

  constructor(private plugin: ZoobPlugin) {}

  /** Called on plugin unload. Nukes any card (pinned or not) and blocks further shows. */
  dispose(): void {
    this.disposed = true;
    this.pinned = false;
    this.hide();
    // Sweep any stragglers that escaped lifecycle tracking.
    document.querySelectorAll(".zoob-hover").forEach((n) => n.remove());
  }

  /** Schedule a show, with debounce. */
  scheduleShow(citekey: string, anchor: HTMLElement | DOMRect): void {
    if (this.disposed) return;
    this.clearHideTimer();
    if (this.currentKey === citekey && this.el) {
      // Already showing this key; keep it up.
      return;
    }
    this.clearShowTimer();
    this.showTimer = window.setTimeout(() => {
      void this.show(citekey, anchor);
    }, this.plugin.settings.hoverDelayMs);
  }

  scheduleHide(): void {
    if (this.pinned) return;
    this.clearShowTimer();
    this.clearHideTimer();
    this.hideTimer = window.setTimeout(() => this.hide(), 80);
  }

  hide(): void {
    this.clearShowTimer();
    this.clearHideTimer();
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    this.currentKey = null;
    this.pinned = false;
  }

  private clearShowTimer(): void {
    if (this.showTimer !== null) {
      window.clearTimeout(this.showTimer);
      this.showTimer = null;
    }
  }
  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private async show(citekey: string, anchor: HTMLElement | DOMRect): Promise<void> {
    let item: ZoobItem | undefined;
    try {
      const bibPath = this.plugin.currentBibPath();
      const items = await this.plugin.getItems([citekey], { bibPath });
      item = items[0];
    } catch (e) {
      this.renderError(`Couldn't reach Zotero: ${(e as Error).message}`, anchor);
      return;
    }
    if (!item) {
      this.renderError(`No Zotero item for @${citekey}`, anchor);
      return;
    }
    // The plugin may have unloaded during the await — bail out cleanly.
    if (this.disposed) return;
    // Remove any previous card before creating a new one (fixes stacking/stickiness).
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    this.currentKey = citekey;

    const card = document.body.createDiv({ cls: "zoob-hover" });
    this.el = card;
    renderItemCard(card, this.plugin, item, "hover");

    // Keep open while hovered; pin only on explicit Alt/⌥-click (otherwise the
    // card hides as expected when you mouse away).
    card.addEventListener("mouseenter", () => this.clearHideTimer());
    card.addEventListener("mouseleave", () => this.scheduleHide());
    card.addEventListener("click", (e) => {
      if (!e.altKey) return;
      if ((e.target as HTMLElement).closest("a, button")) return;
      this.pinned = true;
      card.addClass("zoob-hover--pinned");
    });
    this.position(card, anchor);
  }

  private renderError(msg: string, anchor: HTMLElement | DOMRect): void {
    this.hide();
    const card = document.body.createDiv({ cls: "zoob-hover zoob-hover--error" });
    this.el = card;
    card.createDiv({ text: msg });
    this.position(card, anchor);
    window.setTimeout(() => this.hide(), 2000);
  }

  private position(card: HTMLDivElement, anchor: HTMLElement | DOMRect): void {
    const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : anchor;
    const margin = 8;
    card.style.position = "fixed";
    card.style.zIndex = "9999";
    card.style.width = "min(560px, 90vw)";
    card.style.maxHeight = "min(70vh, 640px)";
    card.style.overflowY = "auto";
    const cardRect = card.getBoundingClientRect();
    let top = rect.bottom + margin;
    if (top + cardRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - cardRect.height - margin);
    }
    let left = rect.left;
    if (left + cardRect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - cardRect.width - 8);
    }
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
  }
}
