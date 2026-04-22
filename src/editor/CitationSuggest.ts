import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";
import type ZoobPlugin from "../main";
import { t } from "../i18n";

interface SuggestItem {
  citekey: string;
  title: string;
  author: string;
  year: string;
}

const SEARCHING_SENTINEL = "__zoob_searching__";

export class CitationSuggest extends EditorSuggest<SuggestItem> {
  private debounceTimer: number | null = null;
  private lastQuery = "";
  private lastResults: SuggestItem[] = [];
  /** In-flight BBT search, keyed by query — dedupes rapid typing into one call. */
  private inFlight: Map<string, Promise<SuggestItem[]>> = new Map();

  constructor(app: App, private plugin: ZoobPlugin) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line).slice(0, cursor.ch);
    // Match `[@...` with an un-closed bracket at the end of the prefix.
    const m = line.match(/\[@([\w:.#$%&\-+?<>~/]*)$/);
    if (!m) return null;
    const query = m[1];
    const startCh = cursor.ch - query.length - 2; // `[@`
    return {
      start: { line: cursor.line, ch: startCh },
      end: cursor,
      query,
    };
  }

  async getSuggestions(context: EditorSuggestContext): Promise<SuggestItem[]> {
    const q = context.query.trim();
    // Cached hit — instant.
    if (q === this.lastQuery && this.lastResults.length > 0) {
      return this.lastResults;
    }
    if (q.length < 2) return [];

    // If a search for this exact query is already in flight, reuse it and
    // show the searching placeholder while we wait.
    const existing = this.inFlight.get(q);
    if (existing) {
      this.scheduleRerenderWhen(existing, q);
      return [searchingPlaceholder(q)];
    }

    // Debounce a new fetch. Returning the placeholder synchronously gives the
    // user immediate feedback that their keystroke landed; the real results
    // arrive through scheduleRerenderWhen.
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    const p = new Promise<SuggestItem[]>((resolve) => {
      this.debounceTimer = window.setTimeout(async () => {
        try {
          const results = await this.plugin.searchForSuggest(q);
          this.lastQuery = q;
          this.lastResults = results;
          resolve(results);
        } catch {
          resolve([]);
        } finally {
          this.inFlight.delete(q);
        }
      }, 250);
    });
    this.inFlight.set(q, p);
    this.scheduleRerenderWhen(p, q);
    return [searchingPlaceholder(q)];
  }

  /**
   * When a background search resolves, nudge Obsidian to re-render the
   * suggester so the real results replace the "Searching…" placeholder.
   * EditorSuggest has no public "refresh" — the cleanest reliable way is to
   * re-invoke the internal trigger handler via `this.trigger(editor, file)`,
   * which causes Obsidian to call `onTrigger` + `getSuggestions` again. On
   * the second call we hit the lastQuery cache and return the real items.
   */
  private scheduleRerenderWhen(p: Promise<SuggestItem[]>, q: string): void {
    void p.then((items) => {
      // Bail if the popup is gone or the user has moved on to a different query.
      const ctx = this.context;
      if (!ctx) return;
      if (ctx.query.trim() !== q) return;
      // Swap the rendered list in-place via EditorSuggest's internal
      // `suggestions` controller (undocumented but stable). Falls back to
      // close() if the shape ever changes — losing the popup is preferable
      // to a thrown error.
      try {
        const sugg = (this as unknown as {
          suggestions?: { setSuggestions?: (items: SuggestItem[]) => void };
        }).suggestions;
        if (sugg && typeof sugg.setSuggestions === "function") {
          sugg.setSuggestions(items.length > 0 ? items : [emptyPlaceholder(q)]);
          return;
        }
      } catch {
        /* fall through */
      }
      this.close();
    });
  }

  renderSuggestion(item: SuggestItem, el: HTMLElement): void {
    el.addClass("zoob-suggest");
    if (item.citekey === SEARCHING_SENTINEL) {
      el.addClass("zoob-suggest--searching");
      el.createDiv({ cls: "zoob-suggest__title", text: item.title });
      return;
    }
    const line1 = el.createDiv({ cls: "zoob-suggest__line1" });
    line1.createEl("code", { cls: "zoob-suggest__key", text: `@${item.citekey}` });
    if (item.year) line1.createSpan({ cls: "zoob-suggest__year", text: item.year });
    const title = el.createDiv({ cls: "zoob-suggest__title", text: item.title || t("suggest.untitled") });
    if (item.author) el.createDiv({ cls: "zoob-suggest__author", text: item.author });
    void title;
  }

  selectSuggestion(item: SuggestItem): void {
    const ctx = this.context;
    if (!ctx) return;
    // Ignore the placeholder — it's not a real item.
    if (item.citekey === SEARCHING_SENTINEL) return;
    const replacement = `[@${item.citekey}]`;
    ctx.editor.replaceRange(replacement, ctx.start, ctx.end);
    // Place cursor just after the closing bracket.
    const endPos: EditorPosition = {
      line: ctx.start.line,
      ch: ctx.start.ch + replacement.length,
    };
    ctx.editor.setCursor(endPos);
    this.close();
  }
}

function searchingPlaceholder(q: string): SuggestItem {
  return {
    citekey: SEARCHING_SENTINEL,
    title: t("suggest.searching", { query: q }),
    author: "",
    year: "",
  };
}

function emptyPlaceholder(q: string): SuggestItem {
  return {
    // Reuse the sentinel so selectSuggestion ignores clicks/Enter on it.
    citekey: SEARCHING_SENTINEL,
    title: t("suggest.empty", { query: q }),
    author: "",
    year: "",
  };
}

export type { SuggestItem };
