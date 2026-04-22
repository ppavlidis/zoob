import { App, PluginSettingTab, Setting, requestUrl } from "obsidian";
import type ZoobPlugin from "./main";
import { clearRefsBlockCache } from "./editor/RefsBlockPostProcessor";

export type PdfOpenTarget = "zotero" | "system" | "obsidian";
export type BibDensity = "compact" | "detailed";
export type BibSortOrder = "document" | "author";

export interface ZoobSettings {
  bbtEndpoint: string;
  cslStyleId: string;        // CSL style URI/ID as BBT recognizes it
  cslCustomId: string;       // if user enters a custom style; preferred when non-empty
  pdfOpenTarget: PdfOpenTarget;
  abstractPreviewChars: number;
  hoverDelayMs: number;
  cacheTtlMs: number;
  citationRegex: string;     // advanced override
  /** If an item has more than this many authors, middle authors are replaced with "…". 0 disables. */
  authorCompactThreshold: number;
  /** When compacting, how many leading authors to keep (the last author is always preserved). */
  authorCompactKeepFirst: number;
  /** Side-panel layout: compact one-line rows, or detailed rich cards. */
  bibDensity: BibDensity;
  /** Side-panel ordering: cite-order in the document, or alphabetical by first author. */
  bibSortOrder: BibSortOrder;
  /**
   * Whether to show the "Cited by N" badge backed by Semantic Scholar. Off by
   * default — S2's free graph API is a shared, rate-limited public good and
   * zoob shouldn't hit it unless the user has opted in.
   */
  showCitationCounts: boolean;
  /**
   * How long a cached Semantic Scholar result stays fresh before the next
   * lookup re-hits the API, in days. Special value 0 means "never refresh
   * after the first successful check" (infinite TTL), which is kind to S2's
   * shared endpoint for a user who rarely cares about exact count deltas.
   * The user can still force a refresh per-item via click-to-retry on a `?`
   * badge — that path invalidates the entry regardless of TTL.
   */
  s2CacheTtlDays: number;
}

export const DEFAULT_SETTINGS: ZoobSettings = {
  bbtEndpoint: "http://127.0.0.1:23119/better-bibtex/json-rpc",
  cslStyleId: "http://www.zotero.org/styles/american-medical-association",
  cslCustomId: "",
  pdfOpenTarget: "zotero",
  abstractPreviewChars: 240,
  hoverDelayMs: 250,
  cacheTtlMs: 5 * 60 * 1000,
  citationRegex: "\\[-?@([\\w][\\w:.#$%&\\-+?<>~/]*)\\]",
  authorCompactThreshold: 10,
  authorCompactKeepFirst: 7,
  bibDensity: "compact",
  bibSortOrder: "document",
  showCitationCounts: false,
  s2CacheTtlDays: 30,
};

export interface CslStyleOption {
  label: string;
  id: string;
}

export const CSL_STYLES: CslStyleOption[] = [
  { label: "AMA (American Medical Association)", id: "http://www.zotero.org/styles/american-medical-association" },
  { label: "APA 7", id: "http://www.zotero.org/styles/apa" },
  { label: "Chicago — author-date", id: "http://www.zotero.org/styles/chicago-author-date" },
  { label: "Chicago — notes & bibliography", id: "http://www.zotero.org/styles/chicago-note-bibliography" },
  { label: "Vancouver", id: "http://www.zotero.org/styles/vancouver" },
  { label: "IEEE", id: "http://www.zotero.org/styles/ieee" },
  { label: "MLA 9", id: "http://www.zotero.org/styles/modern-language-association" },
  { label: "Harvard — Cite Them Right", id: "http://www.zotero.org/styles/harvard-cite-them-right" },
  { label: "CSE — Name-Year (biology journals)", id: "http://www.zotero.org/styles/council-of-science-editors-author-date" },
  { label: "PNAS", id: "http://www.zotero.org/styles/pnas" },
  { label: "Genetics", id: "http://www.zotero.org/styles/genetics" },
];

/** Returns the effective CSL style id (custom overrides dropdown). */
export function effectiveCslId(s: ZoobSettings): string {
  return s.cslCustomId.trim() || s.cslStyleId;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

export class ZoobSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ZoobPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "zoob" });
    containerEl.createEl("p", {
      text: "Zotero bibliography inside Obsidian via Better BibTeX. Zotero must be running with the Better BibTeX extension installed.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Better BibTeX endpoint")
      .setDesc("JSON-RPC URL. Leave as default unless you've remapped Zotero's port.")
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_SETTINGS.bbtEndpoint)
          .setValue(this.plugin.settings.bbtEndpoint)
          .onChange(async (v) => {
            this.plugin.settings.bbtEndpoint = v || DEFAULT_SETTINGS.bbtEndpoint;
            this.plugin.bbt.setEndpoint(this.plugin.settings.bbtEndpoint);
            await this.plugin.saveSettings();
          }),
      );

    // Test connection: runs a JSON-RPC probe and a plain GET, shows raw results.
    const testSetting = new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Pings the BBT endpoint and a Zotero-local-API fallback. Useful for diagnosing panel errors.");
    const testOut = containerEl.createEl("pre", { cls: "zoob-settings__test-output" });
    testOut.style.whiteSpace = "pre-wrap";
    testOut.style.fontSize = "var(--font-ui-smaller)";
    testOut.style.background = "var(--background-secondary)";
    testOut.style.padding = "8px";
    testOut.style.borderRadius = "6px";
    testOut.style.marginBottom = "1.5em";
    testOut.style.display = "none";
    testSetting.addButton((b) =>
      b.setButtonText("Run test").onClick(async () => {
        testOut.style.display = "";
        testOut.setText("Testing…");
        const lines: string[] = [];
        const endpoint = this.plugin.settings.bbtEndpoint;
        const zoteroBase = endpoint.replace(/\/better-bibtex\/json-rpc.*$/, "");
        lines.push(`Endpoint: ${endpoint}`);
        lines.push("");
        // Each probe annotates its own verdict line so the user doesn't have
        // to know that a native-fetch CORS failure and a "/" 404 are both the
        // expected normal state when everything is healthy.

        // 1) BBT JSON-RPC probe via Obsidian requestUrl. This is the only
        //    probe zoob actually depends on; passing here means the plugin
        //    will work.
        lines.push("[1] BBT JSON-RPC (requestUrl) → api.ready");
        let p1Ok = false;
        try {
          const r = await requestUrl({
            url: endpoint,
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "api.ready", params: [], id: 1 }),
            throw: false,
          });
          lines.push(`    status: ${r.status}`);
          lines.push(`    body: ${truncate(r.text ?? "", 300)}`);
          p1Ok = r.status === 200 && (r.text ?? "").includes("\"result\"");
          lines.push(p1Ok
            ? "    ✓ OK — zoob is wired up correctly."
            : "    ✗ FAIL — Zotero or Better BibTeX isn't responding. Make sure Zotero is running and BBT is installed.");
        } catch (e) {
          lines.push(`    ERROR: ${(e as Error).message}`);
          lines.push("    ✗ FAIL — couldn't reach the BBT endpoint.");
        }
        lines.push("");

        // 2) Same via native fetch. Expected to fail with a CORS error when
        //    Zotero's allow-list doesn't include Obsidian's renderer origin.
        //    This is a diagnostic — zoob uses requestUrl precisely to bypass
        //    it — not a failure mode.
        lines.push("[2] BBT JSON-RPC (native fetch) → user.groups  [diagnostic — CORS is expected to block this]");
        try {
          const r = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "user.groups", params: [], id: 2 }),
          });
          const body = await r.text();
          lines.push(`    status: ${r.status}`);
          lines.push(`    body: ${truncate(body, 300)}`);
          lines.push("    ℹ Unusual: CORS is normally blocking. Not a problem.");
        } catch (e) {
          lines.push(`    blocked: ${(e as Error).message}`);
          lines.push("    ✓ Expected — zoob doesn't use native fetch.");
        }
        lines.push("");

        // 3) Hit Zotero's local server root. A 404 "No endpoint found" is the
        //    *healthy* response: Zotero is up and answering, it just doesn't
        //    serve anything at /. Anything else (connection refused, DNS
        //    failure) means Zotero itself isn't running.
        lines.push(`[3] Zotero local server GET ${zoteroBase}/  [probe — any HTTP response means Zotero is running]`);
        try {
          const r = await requestUrl({ url: `${zoteroBase}/`, method: "GET", throw: false });
          lines.push(`    status: ${r.status}`);
          lines.push(`    body: ${truncate(r.text ?? "", 200)}`);
          // A 404 with a "No endpoint found" style body is the expected normal.
          // Any HTTP status at all means the server is listening.
          lines.push("    ✓ Zotero's local server is reachable (any HTTP status here means it's up).");
        } catch (e) {
          lines.push(`    ERROR: ${(e as Error).message}`);
          lines.push("    ✗ Zotero's local server isn't answering — is Zotero running?");
        }
        lines.push("");

        // Net verdict — the only thing that matters for zoob's day-to-day.
        lines.push(p1Ok
          ? "Overall: ✓ healthy. zoob will work. [2] and [3] are diagnostics, not failures."
          : "Overall: ✗ not healthy. zoob needs [1] to pass. See the hint on that row.");
        testOut.setText(lines.join("\n"));
      }),
    );

    new Setting(containerEl)
      .setName("Bibliography density")
      .setDesc("Compact shows one-line rows. Detailed shows rich cards with abstract, tags, annotations, and full actions.")
      .addDropdown((d) => {
        d.addOption("compact", "Compact")
          .addOption("detailed", "Detailed")
          .setValue(this.plugin.settings.bibDensity)
          .onChange(async (v) => {
            this.plugin.settings.bibDensity = v as BibDensity;
            await this.plugin.saveSettings();
            this.plugin.rerenderBibView();
          });
      });

    new Setting(containerEl)
      .setName("Bibliography sort order")
      .setDesc("Order of entries in the side panel. Cite order follows first occurrence of each citekey in the note; author order sorts alphabetically by first author, then year.")
      .addDropdown((d) => {
        d.addOption("document", "Cite order in document")
          .addOption("author", "Alphabetical by first author")
          .setValue(this.plugin.settings.bibSortOrder)
          .onChange(async (v) => {
            this.plugin.settings.bibSortOrder = v as BibSortOrder;
            await this.plugin.saveSettings();
            this.plugin.rerenderBibView();
          });
      });

    new Setting(containerEl)
      .setName("PDF open target")
      .setDesc(
        "Where the Open PDF button sends attachments. Alt-click on a card toggles to the non-default target.",
      )
      .addDropdown((d) => {
        d.addOption("zotero", "Zotero reader (default)")
          .addOption("system", "System default app")
          .addOption("obsidian", "Obsidian tab (only if file is in the vault)")
          .setValue(this.plugin.settings.pdfOpenTarget)
          .onChange(async (v) => {
            this.plugin.settings.pdfOpenTarget = v as PdfOpenTarget;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Citation style")
      .setDesc("Style used for the references panel, hover card footer, and the ::: {#refs} block.")
      .addDropdown((d) => {
        for (const s of CSL_STYLES) d.addOption(s.id, s.label);
        d.setValue(this.plugin.settings.cslStyleId).onChange(async (v) => {
          this.plugin.settings.cslStyleId = v;
          await this.plugin.saveSettings();
          this.plugin.cache.invalidate();
          clearRefsBlockCache();
          this.plugin.refreshBibView(true);
          this.plugin.refreshRefsBlocks();
        });
      });

    new Setting(containerEl)
      .setName("Custom CSL style ID")
      .setDesc(
        "Overrides the dropdown. Any style ID Zotero recognizes (e.g. http://www.zotero.org/styles/nature).",
      )
      .addText((t) =>
        t
          .setPlaceholder("leave blank to use the dropdown")
          .setValue(this.plugin.settings.cslCustomId)
          .onChange(async (v) => {
            this.plugin.settings.cslCustomId = v.trim();
            await this.plugin.saveSettings();
            this.plugin.cache.invalidate();
            clearRefsBlockCache();
            this.plugin.refreshBibView(true);
            this.plugin.refreshRefsBlocks();
          }),
      );

    new Setting(containerEl)
      .setName("Compact long author lists")
      .setDesc(
        "When an item has more than this many authors, the bibliography entry shows only the first N, a “…”, and the last author (which is often the senior author). Set to 0 to disable.",
      )
      .addSlider((s) =>
        s
          .setLimits(0, 30, 1)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.authorCompactThreshold)
          .onChange(async (v) => {
            this.plugin.settings.authorCompactThreshold = v;
            await this.plugin.saveSettings();
            this.plugin.rerenderBibView();
          }),
      );

    new Setting(containerEl)
      .setName("Authors to keep at the start")
      .setDesc("When compacting, how many leading authors to show before the “…”.")
      .addSlider((s) =>
        s
          .setLimits(1, 15, 1)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.authorCompactKeepFirst)
          .onChange(async (v) => {
            this.plugin.settings.authorCompactKeepFirst = v;
            await this.plugin.saveSettings();
            this.plugin.rerenderBibView();
          }),
      );

    new Setting(containerEl)
      .setName("Show Semantic Scholar citation counts")
      .setDesc(
        "When on, hover cards show a \"Cited by N\" badge fetched from Semantic Scholar's free graph API. Off by default to be kind to their shared, rate-limited public endpoint.",
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.showCitationCounts)
          .onChange(async (v) => {
            this.plugin.settings.showCitationCounts = v;
            await this.plugin.saveSettings();
            this.plugin.rerenderBibView();
          }),
      );

    // Slider for the S2 cache freshness window. "Never refresh" (the 0 end of
    // the slider) pins a successful count forever; the user's click-to-retry
    // on a `?` badge still invalidates the entry, so the escape hatch is there
    // even at the "never" setting.
    const s2TtlSetting = new Setting(containerEl)
      .setName("Refresh citation counts every");
    const renderDesc = (days: number): string =>
      days === 0
        ? "Never after the first successful check — keeps S2 traffic to a minimum. Click a `?` badge to force a retry on individual items."
        : `${days} day${days === 1 ? "" : "s"} — a cached count is re-fetched from Semantic Scholar after this window expires.`;
    s2TtlSetting.setDesc(renderDesc(this.plugin.settings.s2CacheTtlDays));
    s2TtlSetting.addSlider((s) =>
      s
        .setLimits(0, 365, 1)
        .setDynamicTooltip()
        .setValue(this.plugin.settings.s2CacheTtlDays)
        .onChange(async (v) => {
          this.plugin.settings.s2CacheTtlDays = v;
          await this.plugin.saveSettings();
          s2TtlSetting.setDesc(renderDesc(v));
        }),
    );

    new Setting(containerEl)
      .setName("Abstract preview length")
      .setDesc("Characters of abstract shown in the hover card before truncating.")
      .addSlider((s) =>
        s
          .setLimits(80, 600, 20)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.abstractPreviewChars)
          .onChange(async (v) => {
            this.plugin.settings.abstractPreviewChars = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Hover delay (ms)")
      .setDesc("How long to wait before popping the citation hover card.")
      .addSlider((s) =>
        s
          .setLimits(0, 800, 25)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.hoverDelayMs)
          .onChange(async (v) => {
            this.plugin.settings.hoverDelayMs = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Cache TTL (minutes)")
      .setDesc("How long hydrated items live before re-fetching from Zotero.")
      .addSlider((s) =>
        s
          .setLimits(1, 60, 1)
          .setDynamicTooltip()
          .setValue(Math.round(this.plugin.settings.cacheTtlMs / 60000))
          .onChange(async (v) => {
            this.plugin.settings.cacheTtlMs = v * 60_000;
            this.plugin.cache.setTTL(this.plugin.settings.cacheTtlMs);
            await this.plugin.saveSettings();
          }),
      );

  }
}
