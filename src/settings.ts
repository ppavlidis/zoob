import { App, PluginSettingTab, Setting, requestUrl } from "obsidian";
import type ZoobPlugin from "./main";
import { clearRefsBlockCache } from "./editor/RefsBlockPostProcessor";

export type PdfOpenTarget = "zotero" | "system" | "obsidian";
export type BibDensity = "compact" | "detailed";

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
        // 1) BBT JSON-RPC probe via Obsidian requestUrl.
        lines.push("[1] BBT JSON-RPC (requestUrl) → api.ready");
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
        } catch (e) {
          lines.push(`    ERROR: ${(e as Error).message}`);
        }
        lines.push("");
        // 2) Same via native fetch (for comparison — should fail if CORS).
        lines.push("[2] BBT JSON-RPC (native fetch) → user.groups");
        try {
          const r = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "user.groups", params: [], id: 2 }),
          });
          const body = await r.text();
          lines.push(`    status: ${r.status}`);
          lines.push(`    body: ${truncate(body, 300)}`);
        } catch (e) {
          lines.push(`    ERROR: ${(e as Error).message}`);
        }
        lines.push("");
        // 3) Zotero local server root — confirms Zotero itself is up even if BBT isn't.
        lines.push(`[3] Zotero local server GET ${zoteroBase}/`);
        try {
          const r = await requestUrl({ url: `${zoteroBase}/`, method: "GET", throw: false });
          lines.push(`    status: ${r.status}`);
          lines.push(`    body: ${truncate(r.text ?? "", 200)}`);
        } catch (e) {
          lines.push(`    ERROR: ${(e as Error).message}`);
        }
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
