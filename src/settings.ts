import { App, PluginSettingTab, Setting, requestUrl } from "obsidian";
import type ZoobPlugin from "./main";
import { clearRefsBlockCache } from "./editor/RefsBlockPostProcessor";
import { t, setLang, type LangSetting } from "./i18n";

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
  /**
   * Interface language. "auto" reads navigator.language at load time; the
   * three explicit values override. Panel, settings, notices, and commands
   * all honor it. Command names cannot be re-keyed live — Obsidian reads
   * them at addCommand() time — so a command-name change takes effect on
   * the next plugin reload.
   */
  language: LangSetting;
  /**
   * When on, reading mode renders `[@key]` as `(Author et al., Year)` instead
   * of the raw markdown. Live preview / source mode are unaffected — citations
   * stay as `[@key]` there so editing behaves normally. Multi-cite groups
   * render as `(Smith, 2020; Jones, 2021)`; `[-@key]` suppresses the author.
   */
  renderInlineCitations: boolean;
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
  language: "auto",
  renderInlineCitations: true,
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
      text: t("settings.intro"),
      cls: "setting-item-description",
    });

    // Language first — changing it re-renders this tab in-place so the user
    // can see the effect without navigating away. Command names and the
    // ribbon tooltip are read by Obsidian once per plugin load, so those
    // pick up the change on the next reload; everything else is live.
    new Setting(containerEl)
      .setName(t("settings.language.name"))
      .setDesc(t("settings.language.desc"))
      .addDropdown((d) => {
        d.addOption("auto", t("settings.language.auto"))
          .addOption("en", "English")
          .addOption("fr", "Français")
          .addOption("es", "Español")
          .setValue(this.plugin.settings.language)
          .onChange(async (v) => {
            this.plugin.settings.language = v as LangSetting;
            setLang(this.plugin.settings.language);
            await this.plugin.saveSettings();
            this.plugin.rerenderBibView();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.bbt.name"))
      .setDesc(t("settings.bbt.desc"))
      .addText((inp) =>
        inp
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
      .setName(t("settings.test.name"))
      .setDesc(t("settings.test.desc"));
    const testOut = containerEl.createEl("pre", { cls: "zoob-settings__test-output" });
    testOut.style.whiteSpace = "pre-wrap";
    testOut.style.fontSize = "var(--font-ui-smaller)";
    testOut.style.background = "var(--background-secondary)";
    testOut.style.padding = "8px";
    testOut.style.borderRadius = "6px";
    testOut.style.marginBottom = "1.5em";
    testOut.style.display = "none";
    testSetting.addButton((b) =>
      b.setButtonText(t("settings.test.run")).onClick(async () => {
        testOut.style.display = "";
        testOut.setText(t("settings.test.running"));
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
            ? `    ${t("settings.test.ok")}`
            : `    ${t("settings.test.fail")}`);
        } catch (e) {
          lines.push(`    ERROR: ${(e as Error).message}`);
          lines.push(`    ${t("settings.test.unreachable")}`);
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
          lines.push(`    ${t("settings.test.corsUnusual")}`);
        } catch (e) {
          lines.push(`    blocked: ${(e as Error).message}`);
          lines.push(`    ${t("settings.test.corsExpected")}`);
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
          lines.push(`    ${t("settings.test.zoteroOk")}`);
        } catch (e) {
          lines.push(`    ERROR: ${(e as Error).message}`);
          lines.push(`    ${t("settings.test.zoteroDown")}`);
        }
        lines.push("");

        // Net verdict — the only thing that matters for zoob's day-to-day.
        lines.push(p1Ok
          ? t("settings.test.verdictOk")
          : t("settings.test.verdictFail"));
        testOut.setText(lines.join("\n"));
      }),
    );

    new Setting(containerEl)
      .setName(t("settings.density.name"))
      .setDesc(t("settings.density.desc"))
      .addDropdown((d) => {
        d.addOption("compact", t("settings.density.compact"))
          .addOption("detailed", t("settings.density.detailed"))
          .setValue(this.plugin.settings.bibDensity)
          .onChange(async (v) => {
            this.plugin.settings.bibDensity = v as BibDensity;
            await this.plugin.saveSettings();
            this.plugin.rerenderBibView();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.sort.name"))
      .setDesc(t("settings.sort.desc"))
      .addDropdown((d) => {
        d.addOption("document", t("settings.sort.document"))
          .addOption("author", t("settings.sort.author"))
          .setValue(this.plugin.settings.bibSortOrder)
          .onChange(async (v) => {
            this.plugin.settings.bibSortOrder = v as BibSortOrder;
            await this.plugin.saveSettings();
            this.plugin.rerenderBibView();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.pdf.name"))
      .setDesc(t("settings.pdf.desc"))
      .addDropdown((d) => {
        d.addOption("zotero", t("settings.pdf.zotero"))
          .addOption("system", t("settings.pdf.system"))
          .addOption("obsidian", t("settings.pdf.obsidian"))
          .setValue(this.plugin.settings.pdfOpenTarget)
          .onChange(async (v) => {
            this.plugin.settings.pdfOpenTarget = v as PdfOpenTarget;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName(t("settings.style.name"))
      .setDesc(t("settings.style.desc"))
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
      .setName(t("settings.styleCustom.name"))
      .setDesc(t("settings.styleCustom.desc"))
      .addText((inp) =>
        inp
          .setPlaceholder(t("settings.styleCustom.placeholder"))
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
      .setName(t("settings.inlineCites.name"))
      .setDesc(t("settings.inlineCites.desc"))
      .addToggle((tog) =>
        tog
          .setValue(this.plugin.settings.renderInlineCitations)
          .onChange(async (v) => {
            this.plugin.settings.renderInlineCitations = v;
            await this.plugin.saveSettings();
            // Reading views only re-run post-processors on re-render, so nudge
            // the active preview so the change is visible immediately.
            this.plugin.refreshRefsBlocks();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.authorCompact.name"))
      .setDesc(t("settings.authorCompact.desc"))
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
      .setName(t("settings.authorKeep.name"))
      .setDesc(t("settings.authorKeep.desc"))
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
      .setName(t("settings.s2.name"))
      .setDesc(t("settings.s2.desc"))
      .addToggle((tog) =>
        tog
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
      .setName(t("settings.s2ttl.name"));
    const renderDesc = (days: number): string =>
      days === 0
        ? t("settings.s2ttl.never")
        : t(days === 1 ? "settings.s2ttl.desc_one" : "settings.s2ttl.desc_other", { days });
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
      .setName(t("settings.abstract.name"))
      .setDesc(t("settings.abstract.desc"))
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
      .setName(t("settings.hoverDelay.name"))
      .setDesc(t("settings.hoverDelay.desc"))
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
      .setName(t("settings.cacheTtl.name"))
      .setDesc(t("settings.cacheTtl.desc"))
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
