import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Extension, RangeSetBuilder } from "@codemirror/state";
import type ZoobPlugin from "../main";

// CM6 decoration that marks `[@citekey]` tokens as hoverable spans, and dispatches
// to the plugin's hover controller on mouseover.
//
// The decoration is a Mark (not a Replace): the source text is untouched — what
// the user sees in the editor is exactly what's on disk. The mark only adds a
// CSS class so we can style and target it with DOM event delegation.

// Pandoc citation syntax allows multi-cite groups like `[@a; @b, pp. 33]`, and
// single cites with locators like `[@a p. 5]`. We can't require the citekey to
// immediately precede `]` (that breaks multi-cites); instead we find bracket
// groups that contain at least one `@key` and then decorate each `@key` span
// inside. The inner pattern uses a lookbehind to require `[` or whitespace or
// `;`/`,` before the `@` so stray `email@host` text doesn't get decorated.
const CITE_GROUP_RE = /\[[^\]\n]*@[\w][\w:.#$%&\-+?<>~/]*[^\]\n]*\]/g;
const CITEKEY_IN_GROUP_RE = /(?<=[\[\s;,])-?@([\w][\w:.#$%&\-+?<>~/]*)/g;

export function citeTokenExtension(plugin: ZoobPlugin): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mouseover(event: MouseEvent, _view: EditorView) {
          const t = event.target as HTMLElement | null;
          const cite = t?.closest?.(".zoob-cite") as HTMLElement | null;
          if (!cite) return;
          const key = cite.getAttr("data-citekey") ?? "";
          if (!key) return;
          plugin.hoverCard.scheduleShow(key, cite);
          // Subtle persistent shade on the matching panel row, so the user
          // can see at a glance which entry corresponds to this citation.
          plugin.linkPanelRow(key);
        },
        mouseout(event: MouseEvent, _view: EditorView) {
          const t = event.target as HTMLElement | null;
          if (!t?.closest?.(".zoob-cite")) return;
          const to = (event.relatedTarget as HTMLElement | null)?.closest?.(".zoob-cite, .zoob-hover");
          if (to) return;
          plugin.hoverCard.scheduleHide();
          plugin.linkPanelRow(null);
        },
        click(event: MouseEvent, _view: EditorView) {
          const t = event.target as HTMLElement | null;
          const cite = t?.closest?.(".zoob-cite") as HTMLElement | null;
          if (!cite) return;
          const key = cite.getAttr("data-citekey") ?? "";
          if (!key) return;
          // Modifier-click leaves Obsidian: open the item in Zotero.
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            void plugin.openCitekeyInZotero(key);
            return;
          }
          // Plain click optionally scrolls the panel to the row. No flash,
          // no auto-open — the linked-row shade from hover is the cue. Off
          // by default; users opt into the scroll if they want it.
          if (plugin.settings.clickCitationToReveal) {
            event.preventDefault();
            plugin.scrollPanelToCitekey(key);
          }
        },
      },
    },
  );
}

function buildDecorations(view: EditorView): DecorationSet {
  // Collect (start, end, citekey) triples first, then add to the builder in
  // ascending order — RangeSetBuilder rejects out-of-order ranges, and a
  // two-pass regex (group, then keys-within-group) can emit them in either
  // order depending on the text shape.
  type Hit = { start: number; end: number; citekey: string };
  const hits: Hit[] = [];
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    CITE_GROUP_RE.lastIndex = 0;
    let gm: RegExpExecArray | null;
    while ((gm = CITE_GROUP_RE.exec(text)) !== null) {
      const groupStart = gm.index;
      const groupText = gm[0];
      CITEKEY_IN_GROUP_RE.lastIndex = 0;
      let km: RegExpExecArray | null;
      while ((km = CITEKEY_IN_GROUP_RE.exec(groupText)) !== null) {
        // km.index points at the `@` (or `-@`); km[0] is the `@citekey`
        // (possibly with a leading `-`) slice; km[1] is the bare citekey.
        const tokStart = from + groupStart + km.index;
        const tokEnd = tokStart + km[0].length;
        hits.push({ start: tokStart, end: tokEnd, citekey: km[1] });
      }
    }
  }
  hits.sort((a, b) => a.start - b.start || a.end - b.end);
  const b = new RangeSetBuilder<Decoration>();
  for (const h of hits) {
    b.add(
      h.start,
      h.end,
      Decoration.mark({
        class: "zoob-cite",
        attributes: { "data-citekey": h.citekey },
      }),
    );
  }
  return b.finish();
}
