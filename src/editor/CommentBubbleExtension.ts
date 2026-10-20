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

  destroy(dom: HTMLElement): void {
    if (dom === popupAnchor) hidePopup();
  }

  ignoreEvent(): boolean {
    return true;
  }
}

let popup: HTMLElement | null = null;

let popupAnchor: HTMLElement | null = null;
let popupWatch: ((e: Event) => void) | null = null;

function hidePopup(): void {
  popup?.remove();
  popup = null;
  popupAnchor = null;
  if (popupWatch) {
    document.removeEventListener("mousemove", popupWatch, true);
    document.removeEventListener("scroll", popupWatch, true);
    document.removeEventListener("keydown", popupWatch, true);
    popupWatch = null;
  }
}

/** Split on `;` outside parentheses. */
function splitClauses(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim()).filter(Boolean);
}

const INLINE_RE =
  /(\([^()]*(?:\([^()]*\)[^()]*)*\))|((?:~|\/)[\w.\-@+]*(?:\/[\w.\-@+]+)+)|(\b[0-9a-f]{8,}\b)|(\b\d+(?:\.\d+){1,}(?:-\d+)?\b)/g;

/** Paths and hashes in monospace, parentheticals in italics, version numbers in semibold. */
function renderInline(parent: HTMLElement, text: string): void {
  let last = 0;
  INLINE_RE.lastIndex = 0;
  const re = new RegExp(INLINE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parent.appendText(text.slice(last, m.index));
    let tok = m[0];
    if (m[1]) {
      // Recurse on the inside only: passing the parentheses again would match this branch forever.
      const em = parent.createEl("em");
      em.appendText("(");
      renderInline(em, tok.slice(1, -1));
      em.appendText(")");
    } else if (m[2]) {
      const trimmed = tok.replace(/\.+$/, "");
      parent.createEl("code", { text: trimmed });
      tok = trimmed;
    } else if (m[3]) {
      parent.createEl("code", { text: tok });
    } else {
      parent.createEl("strong", { text: tok });
    }
    last = m.index + tok.length;
    re.lastIndex = last;
  }
  if (last < text.length) parent.appendText(text.slice(last));
}

/** Popup layout: bold label, then sentences as paragraphs, long ones broken at `;` and `<-`. */
function showPopup(anchor: HTMLElement, text: string): void {
  hidePopup();
  const el = document.body.createDiv({ cls: "zoob-comment-popup" });
  for (const line of text.split(/\n+/)) {
    let body = line.trim();
    if (!body) continue;
    const lab = body.match(/^([A-Za-z][\w ]{0,20}):\s+(?=\S)/);
    if (lab) {
      el.createDiv({ cls: "zoob-comment-popup__label", text: lab[1] });
      body = body.slice(lab[0].length);
    }
    for (const sentence of body.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      const clauses = sentence.length > 120 ? splitClauses(sentence) : [sentence];
      const p = el.createEl("p");
      clauses.forEach((clause, i) => {
        const row = p.createDiv({ cls: "zoob-comment-popup__clause" });
        const [head, ...srcs] = clause.split(/\s+<-\s+/);
        renderInline(row, i < clauses.length - 1 && sentence.length > 120 ? `${head};` : head);
        for (const src of srcs) {
          const from = row.createDiv({ cls: "zoob-comment-popup__from" });
          from.createSpan({ cls: "zoob-comment-popup__arrow", text: "\u2190 " });
          renderInline(from, src);
        }
      });
    }
  }
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
  const top = r.top - h - 6 >= 8 ? r.top - h - 6 : Math.min(r.bottom + 6, window.innerHeight - h - 8);
  el.style.left = `${left}px`;
  el.style.top = `${Math.max(8, top)}px`;
  popup = el;
  popupAnchor = anchor;
  // mouseleave alone strands the popup when the bubble is re-rendered or removed under the pointer.
  popupWatch = (e: Event) => {
    const t = e.target as Node | null;
    if (e.type === "mousemove" && popupAnchor?.isConnected && t && popupAnchor.contains(t)) return;
    hidePopup();
  };
  document.addEventListener("mousemove", popupWatch, true);
  document.addEventListener("scroll", popupWatch, true);
  document.addEventListener("keydown", popupWatch, true);
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
