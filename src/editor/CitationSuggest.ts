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
  /** Settles the debounced search that the next keystroke would otherwise orphan. */
  private cancelPending: (() => void) | null = null;
  private lastQuery = "";
  private lastResults: SuggestItem[] = [];
  /** In-flight BBT search, keyed by query — dedupes rapid typing into one call. */
  private inFlight: Map<string, Promise<SuggestItem[]>> = new Map();

  constructor(app: App, private plugin: ZoobPlugin) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line).slice(0, cursor.ch);
    // Find the innermost un-closed `[` and the `@` segment being typed in it, so a search also works
    // after `;` in a multi-cite (`[@a; @b`). Spaces are allowed so that a search such as "lee 2026"
    // (surname, year, title words) works as well as a citekey.
    const open = line.lastIndexOf("[");
    if (open < 0 || line.indexOf("]", open) >= 0) return null;
    const inner = line.slice(open + 1);
    const semi = inner.lastIndexOf(";");
    const seg = inner.slice(semi + 1);
    const m = seg.match(/^(\s*-?@)([^@]*)$/);
    if (!m) return null;
    if (semi < 0 && m[1] !== "@") return null;
    const query = m[2];
    // First cite in the group starts at `[` (the whole `[@…]` is replaced); later ones at their `@`.
    const startCh = semi < 0 ? open : cursor.ch - query.length - 1;
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
    // A cleared timer never runs, so its promise would stay unresolved in inFlight and any later
    // return to that query would wait on it forever ("Searching…" that never ends).
    this.cancelPending?.();
    const p = new Promise<SuggestItem[]>((resolve) => {
      this.cancelPending = () => { this.inFlight.delete(q); resolve([]); };
      this.debounceTimer = window.setTimeout(async () => {
        this.cancelPending = null;
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
      // A cancelled search for this same query, superseded by a newer one: let the newer one render.
      const current = this.inFlight.get(q);
      if (current && current !== p) return;
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
    const startsGroup = ctx.editor.getRange(ctx.start, { line: ctx.start.line, ch: ctx.start.ch + 1 }) === "[";
    if (!startsGroup) {
      // Later cite in a multi-cite group: swap `@query` for `@key`, leave the surrounding brackets.
      const replacement = `@${item.citekey}`;
      ctx.editor.replaceRange(replacement, ctx.start, ctx.end);
      ctx.editor.setCursor({ line: ctx.start.line, ch: ctx.start.ch + replacement.length });
      this.close();
      return;
    }
    const replacement = `[@${item.citekey}]`;
    // Obsidian auto-closes `[` as `[]`, so the closing bracket is already after the cursor; replace it
    // too, otherwise the inserted `]` leaves a second one behind.
    let end = ctx.end;
    const next = ctx.editor.getRange(end, { line: end.line, ch: end.ch + 1 });
    if (next === "]") end = { line: end.line, ch: end.ch + 1 };
    ctx.editor.replaceRange(replacement, ctx.start, end);
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
