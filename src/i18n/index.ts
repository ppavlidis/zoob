// Tiny i18n shim. One module-level "current language" used by every call site.
//
// Usage:
//   import { t, plural, setLang } from "./i18n";
//   setLang("auto");                           // or "en" / "fr" / "es"
//   t("ribbon.tooltip");                       // → "zoob: references"
//   t("notice.cslCopied", { citekey: "x" });   // → substitutes ${citekey}
//   t(plural(n, "card.notes_one", "card.notes_other"), { count: n });
//
// Philosophy: no formatter, no ICU, no externals. Placeholders are `${name}`
// string.replace'd at lookup time. Plurals use CLDR's "one"/"other" split
// which covers en/fr/es for the cardinals we have (notes, annotations,
// citations, days, citekeys refreshed). French treats 0 as "one" grammatically
// (0 note, 0 citation) so we honor that for French only.

import { STRINGS, type StringKey } from "./strings";

export type Lang = "en" | "fr" | "es";
export type LangSetting = Lang | "auto";

let currentLang: Lang = "en";

/** Resolve a LangSetting to a concrete Lang. "auto" follows Obsidian's UI language. */
export function resolveLang(setting: LangSetting): Lang {
  if (setting === "en" || setting === "fr" || setting === "es") return setting;
  return pickSystemLang();
}

/**
 * Pick a language to match Obsidian's own UI. Obsidian stores the user's chosen
 * interface language in `localStorage` under the key "language" (undocumented
 * but stable — widely used by community plugins). If that's missing or unknown
 * to us, fall back to `navigator.language` (OS locale), then English. Matching
 * Obsidian's UI is what a user means by "auto" — running macOS in French but
 * Obsidian in English shouldn't make zoob's panel French.
 */
export function pickSystemLang(): Lang {
  const fromObsidian = typeof window !== "undefined"
    ? window.localStorage?.getItem("language")
    : null;
  const fromNavigator = typeof navigator !== "undefined" ? navigator.language : null;
  const raw = fromObsidian || fromNavigator || "en";
  const base = raw.toLowerCase().split("-")[0];
  if (base === "fr") return "fr";
  if (base === "es") return "es";
  return "en";
}

/** Called by the plugin on load and whenever the Language setting changes. */
export function setLang(setting: LangSetting): Lang {
  currentLang = resolveLang(setting);
  return currentLang;
}

export function getLang(): Lang {
  return currentLang;
}

type SubstParams = Record<string, string | number>;

/**
 * Look up a key and substitute `${name}` placeholders from `params`. If the
 * current language has no entry for `key`, falls back to English. Unknown
 * placeholders are left as-is so bugs are visible rather than silent.
 */
export function t(key: StringKey, params?: SubstParams): string {
  const entry = STRINGS[key];
  if (!entry) {
    // Not a known key — return it so the missing string is visible in UI.
    return String(key);
  }
  const template = entry[currentLang] || entry.en;
  if (!params) return template;
  return template.replace(/\$\{(\w+)\}/g, (whole, name) => {
    const v = params[name];
    return v == null ? whole : String(v);
  });
}

/**
 * Pick the `_one` or `_other` variant of a plural key based on CLDR rules for
 * the current language. Pass both key suffixes so TypeScript checks them.
 * French: 0 and 1 → one. English/Spanish: 1 → one, everything else → other.
 */
export function plural<K extends StringKey, O extends StringKey>(
  n: number,
  oneKey: K,
  otherKey: O,
): K | O {
  if (currentLang === "fr") {
    return n === 0 || n === 1 ? oneKey : otherKey;
  }
  return n === 1 ? oneKey : otherKey;
}
