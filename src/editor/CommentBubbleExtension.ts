import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { EditorState, Extension, Range, StateEffect, StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { setIcon } from "obsidian";
import type ZoobPlugin from "../main";

// Collapses `<!-- … -->` and Obsidian `%% … %%` comments into a small bubble
// in the editor. The bubble's tooltip shows the comment text. The source on
// disk is untouched; the replace decoration is display-only.
//
// A comment that the selection touches is left as plain text so it can be
// edited; clicking the bubble puts the cursor inside it for that purpose.
//
// Decorations come from a StateField rather than a ViewPlugin because a
// comment can span lines, and CM6 only permits line-crossing replace
// decorations from a field.

const COMMENT_RE = /<!--[\s\S]*?-->|%%[\s\S]*?%%/g;

export const setHideComments = StateEffect.define<boolean>();

class CommentBubble extends WidgetType {
  constructor(readonly from: number, readonly text: string) {
    super();
  }

  eq(other: CommentBubble): boolean {
    return other.from === this.from && other.text === this.text;
  }

  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement("span");
    el.className = "zoob-comment-bubble";
    setIcon(el, "message-square");
    el.addEventListener("mouseenter", () => showPopup(el, this.text));
    el.addEventListener("mouseleave", hidePopup);
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from + 1 }, scrollIntoView: true });
      view.focus();
    });
    return el;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

let popup: HTMLElement | null = null;

function hidePopup(): void {
  popup?.remove();
  popup = null;
}

/** Left-aligned popup with each sentence (and each line) as its own paragraph. */
function showPopup(anchor: HTMLElement, text: string): void {
  hidePopup();
  const el = document.body.createDiv({ cls: "zoob-comment-popup" });
  for (const line of text.split(/\n+/)) {
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      if (sentence.trim()) el.createEl("p", { text: sentence.trim() });
    }
  }
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
  const top = r.top - h - 6 >= 8 ? r.top - h - 6 : r.bottom + 6;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  popup = el;
}

function commentBody(raw: string): string {
  const inner = raw.startsWith("<!--") ? raw.slice(4, -3) : raw.slice(2, -2);
  return inner.trim();
}

function build(state: EditorState): DecorationSet {
  const tree = syntaxTree(state);
  const sel = state.selection.ranges;
  const out: Range<Decoration>[] = [];
  const text = state.doc.toString();
  COMMENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMMENT_RE.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    if (sel.some((r) => r.from <= to && r.to >= from)) continue;
    const name = tree.resolveInner(from, 1).name;
    if (/codeblock|inline-code|math/i.test(name)) continue;
    out.push(
      Decoration.replace({ widget: new CommentBubble(from, commentBody(m[0])) }).range(from, to),
    );
  }
  return Decoration.set(out);
}

export function commentBubbleExtension(plugin: ZoobPlugin): Extension {
  const field = StateField.define<{ hide: boolean; deco: DecorationSet }>({
    create(state) {
      const hide = plugin.settings.hideComments;
      return { hide, deco: hide ? build(state) : Decoration.none };
    },
    update(value, tr) {
      let hide = value.hide;
      for (const e of tr.effects) if (e.is(setHideComments)) hide = e.value;
      if (!hide) return { hide, deco: Decoration.none };
      if (hide === value.hide && !tr.docChanged && !tr.selection) return value;
      return { hide, deco: build(tr.state) };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });
  return field;
}
