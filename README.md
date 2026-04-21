# zoob

Zotero bibliography inside Obsidian — a rich references side panel, hover previews on `[@citekey]`, and live CSL-formatted reference blocks. Talks to Zotero via [Better BibTeX](https://retorque.re/zotero-better-bibtex/).

Modeled on [obsidian-deepsit](https://github.com/bassio/obsidian-deepsit) — same conventions (Pandoc `[@citekey]`, `bib:` frontmatter, BBT citekeys) with a much richer panel and citation↔item linking.

## Requirements

- Obsidian 1.5+ (desktop only)
- Zotero 7+ (works with 7, 8, 9) running
- [Better BibTeX](https://retorque.re/zotero-better-bibtex/installation/) installed in Zotero

## What you get

- **References panel** (right sidebar): cards for every item cited in the active note — title, authors, year, venue, tags, collapsible abstract, DOI/URL, attachment badges (PDF, snapshot, link), annotation counts, and one-click actions (open in Zotero, open PDF, copy citekey, insert citation, copy formatted entry).
- **Hover previews** on `[@citekey]` in both edit and reading mode. Compact card with title, authors, abstract snippet, tags, and a PDF link. Works in Live Preview via a CodeMirror extension and in Reading mode via DOM delegation.
- **Citation autocomplete** triggered by `[@` — searches your whole library (BBT `item.search`) and shows citekey, title, authors, year. Displays a "Searching Zotero…" placeholder while the call is in flight, so you see feedback on slow libraries instead of an empty popover.
- **Zotero picker dialog** — the same native Cite-As-You-Write dialog Word and Google Docs use, with Zotero's full-library fuzzy search over title, authors, tags, etc. Reach it via:
  - Right-click in the editor → **Insert citation from Zotero…**
  - Command palette → **Insert citation from Zotero (picker dialog)**
  - Any hotkey you bind (Settings → Hotkeys → search "zoob picker")

  Useful when you know the title or author but not the citekey — the inline `[@` suggester is faster once you know roughly what you're after. Multi-select in the Zotero dialog inserts as `[@a; @b; @c]`.
- **Live reference blocks.** Write `::: {#refs}` / `:::` (Pandoc syntax) in a note; in reading mode it renders as a CSL-formatted bibliography of the note's cited keys.
- **Commands** (all in the command palette):
  - Open references panel
  - Insert citation
  - Insert citation from Zotero (picker dialog)
  - Insert references block
  - Refresh Zotero data for current note
  - Refresh Zotero data (entire cache)
  - Open item in Zotero (citation under cursor)
  - Open attachment (citation under cursor)
  - Insert item metadata block (citation under cursor)
  - Copy item as CSL-JSON (citation under cursor)

## Conventions

Add `bib:` to a note's frontmatter to scope suggestions and panel resolution to a Zotero collection (nested paths supported):

```yaml
---
bib: "My Library/AI Safety/Papers"
---
```

Cite with Pandoc syntax anywhere in the note:

```markdown
Smith et al. showed X [@smith2024transformer].
Multi-cite also works: [@a2020; @b2021, pp. 12–14].
```

Render a bibliography with a fenced Pandoc div:

```markdown
::: {#refs}
:::
```

## Settings

- **PDF open target**: Zotero reader (default), System default app, or Obsidian tab (only used when the PDF happens to be inside the vault). Alt-click on an "Open PDF" button flips to the non-default target.
- **Citation style**: dropdown with AMA (default), APA 7, Chicago (author-date / notes), Vancouver, IEEE, MLA, Harvard — or paste any CSL style ID Zotero knows (`http://www.zotero.org/styles/...`).
- **Abstract preview length**, **hover delay**, **cache TTL** — sliders in the settings tab.

## For Claude Code in Obsidian's embedded terminal

zoob treats the markdown file as the source of truth, so Claude Code working on the same vault sees exactly what the panel sees.

- Citations stay as literal `[@citekey]` text. The editor's CM6 decoration is visual only; it never rewrites file contents.
- `bib:` lives in frontmatter as plain YAML.
- The vault `modify` listener is debounced (~300 ms), so a flurry of external edits refreshes the panel once.
- Useful commands when you want Claude Code to "know" an item:
  - **Insert item metadata block** — writes a fenced ` ```zoob-meta ` block with the cited item's CSL-JSON right after the current paragraph. Claude Code can read it directly.
  - **Copy item as CSL-JSON** — same payload to the clipboard.
### Triggering a refresh from outside Obsidian

When Claude Code (or any other local tool) edits a note's citations on disk, Obsidian's `modify` listener picks it up — but the entries already in zoob's on-disk cache are stale until their TTL expires. Invalidate them explicitly with the `obsidian://zoob` protocol handler:

```bash
# refresh the currently-active note
open 'obsidian://zoob?action=refresh'

# refresh specific note(s) by vault-relative path
open 'obsidian://zoob?action=refresh&path=Notes/foo.md'
open 'obsidian://zoob?action=refresh&path=a.md&path=b.md'
open 'obsidian://zoob?action=refresh&paths=a.md,b.md'

# nuke the whole cache (use sparingly)
open 'obsidian://zoob?action=refresh-all'

# bring the references panel forward
open 'obsidian://zoob?action=open'
```

A Notice confirms how many citekeys were invalidated and for which note, so you can see the trigger landed. On Linux use `xdg-open` in place of `open`. The handler only responds to URIs opened by the local OS — it's not reachable over the network.

### Hitting BBT directly

If Claude Code wants to hit Zotero itself, use Better BibTeX's JSON-RPC directly. No plugin required:

```bash
curl -s -X POST http://127.0.0.1:23119/better-bibtex/json-rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"item.search","params":["transformer"]}'
```

Methods zoob uses (same surface is available to Claude Code): `api.ready`, `user.groups`, `item.search`, `item.export` (with translator `"Better CSL JSON"`), `item.attachments`, `item.notes`, `item.bibliography` (options: `{ id, contentType }` — `format` is not a valid key and will 400 on schema validation), `item.collections`.

BBT also exposes the Cite-As-You-Write picker as a plain HTTP endpoint — `GET /better-bibtex/cayw?format=pandoc&brackets=1`. The request hangs until the user picks in Zotero, then returns the formatted citation. BBT refuses requests with browser-like User-Agent headers (anti-CSRF) — send a non-browser UA like `curl/*` or a custom app name.

## Build & install

```bash
npm install
npm run dev           # watch build → main.js
# or
npm run build         # typecheck + production bundle
```

Install into a vault by copying `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/zoob/`, then enabling the plugin in Community Plugins.

To auto-deploy on every build, drop one line into `.deploy-path` in the repo root:

```
/absolute/path/to/<vault>/.obsidian/plugins/zoob
```

(Or set `ZOOB_VAULT_PLUGIN_DIR` in the environment.) Each successful build copies the three artifacts there. Symlinks into a vault work inconsistently with Obsidian's plugin loader, so copying is the reliable default.

## Out of scope (v1)

- Per-item literature notes, templating engines, writing back to Zotero.
- Zotero Web API / cloud sync.
- Mobile (Better BibTeX is desktop only).
- Custom in-Obsidian PDF viewer for files outside the vault.

## License

MIT
