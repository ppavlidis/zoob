import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Extension, RangeSetBuilder } from "@codemirror/state";
import type ZoobPlugin from "../main";

// CM6 decoration that marks `[@citekey]` tokens as hoverable spans, and dispatches
// to the plugin's hover controller on mouseover.
//
// The decoration is a Mark (not a Replace): the source text is untouched — what
// the user sees in the editor is exactly what's on disk. The mark only adds a
// CSS class so we can style and target it with DOM event delegation.

const CITE_RE = /\[-?@([\w][\w:.#$%&\-+?<>~/]*)\]/g;

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
        },
        mouseout(event: MouseEvent, _view: EditorView) {
          const t = event.target as HTMLElement | null;
          if (!t?.closest?.(".zoob-cite")) return;
          const to = (event.relatedTarget as HTMLElement | null)?.closest?.(".zoob-cite, .zoob-hover");
          if (to) return;
          plugin.hoverCard.scheduleHide();
        },
        click(event: MouseEvent, _view: EditorView) {
          const t = event.target as HTMLElement | null;
          const cite = t?.closest?.(".zoob-cite") as HTMLElement | null;
          if (!cite) return;
          // Modifier-click: open in Zotero.
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            const key = cite.getAttr("data-citekey") ?? "";
            void plugin.openCitekeyInZotero(key);
          }
        },
      },
    },
  );
}

function buildDecorations(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    CITE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CITE_RE.exec(text)) !== null) {
      const start = from + m.index;
      const end = start + m[0].length;
      b.add(
        start,
        end,
        Decoration.mark({
          class: "zoob-cite",
          attributes: { "data-citekey": m[1] },
        }),
      );
    }
  }
  return b.finish();
}
