import { requestUrl } from "obsidian";
import type {
  BBTAttachment,
  BBTCollection,
  BBTLibrary,
  BBTNote,
  CSLItem,
  ZoobItem,
} from "./types";

// Better BibTeX JSON-RPC client.
//
// Docs: https://retorque.re/zotero-better-bibtex/exporting/json-rpc/
// Endpoint is always local HTTP. Methods take positional arrays in the JSON-RPC
// `params` field; responses are standard JSON-RPC 2.0.

export interface BBTClientOptions {
  endpoint: string;   // e.g. http://127.0.0.1:23119/better-bibtex/json-rpc
  timeoutMs?: number; // per-request timeout; default 8000
}

export class BBTError extends Error {
  constructor(public code: number | string, message: string, public data?: unknown) {
    super(message);
    this.name = "BBTError";
  }
}

export class BBTConnectionError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "BBTConnectionError";
  }
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

export class BBTClient {
  private nextId = 1;
  /**
   * Memoized libraries list. BBT's `user.groups` is not cheap on large libraries
   * (it walks every collection tree), and we only need it once to resolve a
   * `bib:` frontmatter path to a libraryID. Cached for the plugin's lifetime;
   * manual refresh (or endpoint change) clears it.
   */
  private librariesCache: Promise<BBTLibrary[]> | null = null;

  constructor(private opts: BBTClientOptions) {}

  setEndpoint(endpoint: string) {
    this.opts.endpoint = endpoint;
    this.librariesCache = null;
  }

  /** Clear transient caches. Called on manual refresh. */
  clearCaches(): void {
    this.librariesCache = null;
  }

  private async call<T>(method: string, params: unknown[] = [], timeoutMs?: number): Promise<T> {
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", method, params, id });
    // Use Obsidian's requestUrl to bypass Electron's CORS on localhost fetches.
    // requestUrl has no built-in timeout and will hang indefinitely if Zotero
    // is busy (e.g. indexer locks search). Race against a timer so callers can
    // surface a clear error instead of hanging the UI.
    const effectiveTimeout = timeoutMs ?? this.opts.timeoutMs ?? 15000;
    let res;
    try {
      res = await Promise.race([
        requestUrl({
          url: this.opts.endpoint,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body,
          throw: false,
        }),
        new Promise<never>((_, reject) =>
          window.setTimeout(
            () => reject(new BBTConnectionError(`Better BibTeX ${method} timed out after ${effectiveTimeout}ms`)),
            effectiveTimeout,
          ),
        ),
      ]);
    } catch (e) {
      if (e instanceof BBTConnectionError) throw e;
      throw new BBTConnectionError(
        `Could not reach Better BibTeX at ${this.opts.endpoint}. Is Zotero running with BBT installed?`,
        e,
      );
    }
    if (res.status < 200 || res.status >= 300) {
      throw new BBTConnectionError(
        `Better BibTeX returned HTTP ${res.status}`,
      );
    }
    // Parse text explicitly — avoid requestUrl's lazy `.json` getter which
    // throws a raw SyntaxError past our catch on malformed bodies.
    const text = typeof res.text === "string" ? res.text : "";
    if (!text) {
      throw new BBTConnectionError(`Better BibTeX returned an empty response`);
    }
    let payload: JsonRpcResponse<T>;
    try {
      payload = JSON.parse(text) as JsonRpcResponse<T>;
    } catch (e) {
      throw new BBTConnectionError(
        `Better BibTeX returned non-JSON response (${(e as Error).message})`,
      );
    }
    if (payload.error) {
      throw new BBTError(payload.error.code, payload.error.message, payload.error.data);
    }
    return payload.result as T;
  }

  /** Health check. Returns true on success; throws BBTConnectionError otherwise. */
  async ready(): Promise<boolean> {
    // BBT's `api.ready` exists on recent versions; fall back to user.groups which
    // is a universally-present method and also validates BBT is responsive.
    try {
      await this.call<unknown>("api.ready", []);
      return true;
    } catch (e) {
      if (e instanceof BBTError) {
        // Method missing or similar — try a cheap fallback.
        await this.call<unknown>("user.groups", []);
        return true;
      }
      throw e;
    }
  }

  /**
   * Invoke Better BibTeX's CAYW ("Cite As You Write") picker — the same dialog
   * Zotero offers Word / Google Docs / LibreOffice. Zotero comes forward with
   * a rich live-search box; the HTTP request hangs until the user confirms or
   * cancels. Returns the formatted citation string (or empty on cancel/esc).
   *
   * The endpoint is a separate HTTP path on BBT's server, not a JSON-RPC
   * method. Derive its base URL from our configured JSON-RPC endpoint so a
   * non-default host/port in settings still works.
   *
   * No application-level timeout: the user is allowed to take as long as they
   * want to pick. Only the inner requestUrl network timeout applies.
   */
  async cayw(params: { format?: string; brackets?: boolean; minimize?: boolean } = {}): Promise<string> {
    const qp = new URLSearchParams();
    qp.set("format", params.format ?? "pandoc");
    if (params.brackets) qp.set("brackets", "1");
    if (params.minimize) qp.set("minimize", "true");
    const base = this.caywBase();
    const url = `${base}?${qp.toString()}`;
    let res;
    try {
      res = await requestUrl({
        url,
        method: "GET",
        // BBT's CAYW rejects browser-like User-Agents with HTTP 403 as an
        // anti-CSRF measure (stops a malicious webpage from invoking the
        // picker behind the user's back). Obsidian's requestUrl defaults to
        // Electron's Chrome UA, which trips the block. Identify ourselves
        // as a non-browser client so BBT serves us like a CLI tool.
        headers: { "User-Agent": "zoob-obsidian-plugin" },
        throw: false,
      });
    } catch (e) {
      throw new BBTConnectionError(
        `Could not reach Better BibTeX CAYW at ${base}. Is Zotero running?`,
        e,
      );
    }
    if (res.status < 200 || res.status >= 300) {
      throw new BBTConnectionError(`Better BibTeX CAYW returned HTTP ${res.status}`);
    }
    return (typeof res.text === "string" ? res.text : "").trim();
  }

  /** Derive `http://host:port/better-bibtex/cayw` from the JSON-RPC endpoint. */
  private caywBase(): string {
    try {
      const u = new URL(this.opts.endpoint);
      return `${u.protocol}//${u.host}/better-bibtex/cayw`;
    } catch {
      return "http://127.0.0.1:23119/better-bibtex/cayw";
    }
  }

  /** All libraries + nested collections. Memoized per plugin lifetime. */
  libraries(): Promise<BBTLibrary[]> {
    if (!this.librariesCache) {
      this.librariesCache = (async () => {
        const raw = await this.call<BBTLibrary[] | Record<string, BBTLibrary>>(
          "user.groups",
          [],
        );
        return Array.isArray(raw) ? raw : Object.values(raw);
      })().catch((e) => {
        // Don't pin a failed promise — try again next call.
        this.librariesCache = null;
        throw e;
      });
    }
    return this.librariesCache;
  }

  /** Fuzzy item search. BBT returns an array of lightweight item descriptors. */
  async search(
    query: string,
    libraryID?: number,
    timeoutMs?: number,
  ): Promise<Array<{ citekey: string; title?: string; author?: string; date?: string; itemType?: string }>> {
    const params: unknown[] = libraryID != null ? [query, libraryID] : [query];
    const raw = await this.call<unknown>("item.search", params, timeoutMs);
    if (!Array.isArray(raw)) return [];
    return (raw as Array<Record<string, unknown>>).map((r) => ({
      citekey: String(r.citekey ?? r["citation-key"] ?? r.citationKey ?? ""),
      title: typeof r.title === "string" ? r.title : undefined,
      author: typeof r.author === "string" ? r.author : undefined,
      date: typeof r.date === "string" ? r.date : undefined,
      itemType: typeof r.itemType === "string" ? r.itemType : undefined,
    })).filter((x) => x.citekey);
  }

  /**
   * Resolve a citekey → Zotero item key via item.search. BBT's CSL `id` for
   * search results is a URL like http://zotero.org/users/302138/items/U2R8UEEP;
   * we extract the trailing key. Returns undefined if no exact match.
   */
  async resolveItemKey(citekey: string, libraryID?: number): Promise<string | undefined> {
    const params: unknown[] = libraryID != null ? [citekey, libraryID] : [citekey];
    let raw: unknown;
    try {
      raw = await this.call<unknown>("item.search", params);
    } catch {
      return undefined;
    }
    if (!Array.isArray(raw)) return undefined;
    for (const r of raw as Array<Record<string, unknown>>) {
      const ck = r["citation-key"] ?? r.citekey ?? r.citationKey;
      if (ck !== citekey) continue;
      const id = typeof r.id === "string" ? r.id : "";
      const m = id.match(/\/items\/([^/?#]+)/);
      if (m) return m[1];
    }
    return undefined;
  }

  /**
   * Export items as CSL-JSON via the "Better CSL JSON" translator. If BBT
   * reports "not found: …" for some citekeys (e.g. because the wrong library
   * is specified in frontmatter), strip those and retry so the rest still
   * render. Call sites can detect misses by comparing input citekeys to the
   * returned items' `citation-key` fields.
   */
  async exportCSL(citekeys: string[], libraryID?: number): Promise<CSLItem[]> {
    if (citekeys.length === 0) return [];
    const translator = "Better CSL JSON";
    const params: unknown[] =
      libraryID != null ? [citekeys, translator, libraryID] : [citekeys, translator];
    let raw: unknown;
    try {
      raw = await this.call<unknown>("item.export", params);
    } catch (e) {
      if (e instanceof BBTError) {
        const missing = parseMissingCitekeys(e.message);
        if (missing.length > 0 && missing.length < citekeys.length) {
          const remaining = citekeys.filter((k) => !missing.includes(k));
          return this.exportCSL(remaining, libraryID);
        }
        if (missing.length > 0) return []; // all missing — return empty rather than throw
      }
      throw e;
    }
    // BBT sometimes returns a JSON string, sometimes an array; handle both.
    // Also: `item.export` can return a 2-tuple [status, payload] in some
    // BBT versions — unwrap if so.
    let payload: unknown = raw;
    if (Array.isArray(payload) && payload.length === 2 && typeof payload[0] === "number") {
      payload = payload[1];
    }
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        return [];
      }
    }
    if (Array.isArray(payload)) return payload as CSLItem[];
    // Some CSL exporters wrap in { items: [...] }.
    if (payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)) {
      return (payload as { items: CSLItem[] }).items;
    }
    return [];
  }

  /** Attachments for a single citekey. */
  async attachments(citekey: string, libraryID?: number): Promise<BBTAttachment[]> {
    const params: unknown[] = libraryID != null ? [citekey, libraryID] : [citekey];
    const raw = await this.call<unknown>("item.attachments", params);
    return Array.isArray(raw) ? (raw as BBTAttachment[]) : [];
  }

  /** Notes for one or more citekeys. */
  async notes(citekeys: string[], libraryID?: number): Promise<BBTNote[]> {
    if (citekeys.length === 0) return [];
    const params: unknown[] = libraryID != null ? [citekeys, libraryID] : [citekeys];
    try {
      const raw = await this.call<unknown>("item.notes", params);
      return Array.isArray(raw) ? (raw as BBTNote[]) : [];
    } catch (e) {
      // Older BBT versions may not expose item.notes; degrade quietly.
      if (e instanceof BBTError) return [];
      throw e;
    }
  }

  /** CSL-formatted bibliography string (HTML) for the given citekeys. */
  async bibliography(
    citekeys: string[],
    cslStyleId: string,
    libraryID?: number,
  ): Promise<string> {
    if (citekeys.length === 0) return "";
    // BBT's schema accepts `id` + `contentType` (html|text). `format` is not
    // a valid key and is rejected by the JSON-RPC schema validator.
    const options = { id: cslStyleId, contentType: "html" as const };
    const params: unknown[] =
      libraryID != null ? [citekeys, options, libraryID] : [citekeys, options];
    let raw: string | unknown;
    try {
      raw = await this.call<string>("item.bibliography", params);
    } catch (e) {
      if (e instanceof BBTError) {
        const missing = parseMissingCitekeys(e.message);
        if (missing.length > 0 && missing.length < citekeys.length) {
          const remaining = citekeys.filter((k) => !missing.includes(k));
          return this.bibliography(remaining, cslStyleId, libraryID);
        }
        if (missing.length > 0) return "";
      }
      throw e;
    }
    return typeof raw === "string" ? raw : "";
  }

  /** Collection paths for the given citekeys. */
  async collectionsOf(citekeys: string[], libraryID?: number): Promise<Record<string, string[]>> {
    if (citekeys.length === 0) return {};
    const params: unknown[] =
      libraryID != null ? [citekeys, libraryID] : [citekeys];
    try {
      const raw = await this.call<unknown>("item.collections", params);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return raw as Record<string, string[]>;
      }
      return {};
    } catch (e) {
      if (e instanceof BBTError) return {};
      throw e;
    }
  }

  /**
   * Hydrate a citekey list into ready-to-render ZoobItems. Batches exports and
   * fans out attachment/notes calls in parallel; preserves input order.
   * If `cslStyleId` is given, also fetches per-item CSL-formatted HTML.
   */
  async hydrate(
    citekeys: string[],
    libraryID?: number,
    cslStyleId?: string,
  ): Promise<ZoobItem[]> {
    const meta = await this.hydrateMeta(citekeys, libraryID, cslStyleId);
    return this.hydrateAttachments(meta);
  }

  /**
   * Fast first-pass hydration: fetches only CSL metadata and the formatted
   * bibliography HTML. No attachments, no notes, no Zotero item-key lookup.
   * Typically 1–2 JSON-RPC calls total, independent of citekey count.
   */
  async hydrateMeta(
    citekeys: string[],
    libraryID?: number,
    cslStyleId?: string,
  ): Promise<ZoobItem[]> {
    if (citekeys.length === 0) return [];
    const [cslItems, formatted] = await Promise.all([
      this.exportCSL(citekeys, libraryID),
      cslStyleId
        ? this.bibliography(citekeys, cslStyleId, libraryID).catch(() => "")
        : Promise.resolve(""),
    ]);
    const byKey = new Map<string, CSLItem>();
    for (const item of cslItems) {
      const key = String(item["citation-key"] ?? item.id ?? "");
      if (key) byKey.set(key, item);
    }
    const resolvedKeys = citekeys.filter((k) => byKey.has(k));
    if (resolvedKeys.length === 0) return [];
    const entries = formatted ? splitCslEntries(formatted) : [];
    return resolvedKeys.map((citekey, i) => {
      const csl = byKey.get(citekey) ?? ({ id: citekey, "citation-key": citekey } as CSLItem);
      return {
        citekey,
        libraryID,
        // Parse the zoteroKey out of CSL `id` when possible (URL of the form
        // `http://zotero.org/users/XXX/items/ABC12345`). Saves an `item.search`
        // round-trip per citekey during phase-2 attachment hydration.
        zoteroKey: parseZoteroKeyFromCslId(csl.id),
        csl,
        attachments: [],
        notes: [],
        formattedHtml: entries[i],
        hydratedLevel: "meta" as const,
      };
    });
  }

  /**
   * Upgrade meta-hydrated items with attachments + notes + Zotero item keys.
   * Returns new items with hydratedLevel="full". Items already "full" pass
   * through unchanged.
   */
  async hydrateAttachments(items: ZoobItem[]): Promise<ZoobItem[]> {
    const needs = items.filter((i) => i.hydratedLevel === "meta");
    if (needs.length === 0) return items;
    // Mixed-library bib: unusual. Use each item's own libraryID.
    const libraryID = needs[0]?.libraryID;
    const keys = needs.map((i) => i.citekey);
    const [attLists, noteBlocks] = await Promise.all([
      Promise.all(
        keys.map((k) =>
          this.attachments(k, libraryID).catch(() => [] as BBTAttachment[]),
        ),
      ),
      this.notes(keys, libraryID).catch(() => [] as BBTNote[]),
    ]);
    const parentKeyFromAtts = (atts: BBTAttachment[]): string | undefined =>
      atts.find((a) => typeof a.parentKey === "string")?.parentKey;
    // Prefer the zoteroKey we already parsed from CSL `id` in hydrateMeta;
    // fall back to the attachment's parentKey, then finally a search RPC.
    const itemKeys: (string | undefined)[] = await Promise.all(
      needs.map((item, i) => {
        if (item.zoteroKey) return Promise.resolve(item.zoteroKey);
        const fromAtt = parentKeyFromAtts(attLists[i] ?? []);
        return fromAtt ? Promise.resolve(fromAtt) : this.resolveItemKey(item.citekey, libraryID);
      }),
    );
    const notesByKey = new Map<string, BBTNote[]>();
    for (const n of noteBlocks) {
      const k = String(n.parentKey ?? "");
      if (!k) continue;
      const arr = notesByKey.get(k) ?? [];
      arr.push(n);
      notesByKey.set(k, arr);
    }
    const upgradedByKey = new Map<string, ZoobItem>();
    needs.forEach((item, i) => {
      const atts = attLists[i] ?? [];
      const zoteroKey = item.zoteroKey ?? parentKeyFromAtts(atts) ?? itemKeys[i];
      const notes = zoteroKey ? notesByKey.get(zoteroKey) ?? [] : [];
      upgradedByKey.set(item.citekey, {
        ...item,
        attachments: atts,
        notes,
        zoteroKey,
        hydratedLevel: "full",
      });
    });
    return items.map((i) => upgradedByKey.get(i.citekey) ?? i);
  }
}

/**
 * Parse the Zotero item key out of a CSL `id` URL such as
 * `http://zotero.org/users/302138/items/U2R8UEEP` or `…/groups/…/items/…`.
 * Returns undefined if the id isn't in that shape (BBT sometimes uses the
 * citekey itself as the id for unresolved items).
 */
function parseZoteroKeyFromCslId(id: unknown): string | undefined {
  if (typeof id !== "string") return undefined;
  const m = /\/items\/([A-Z0-9]{6,})(?:[/?#]|$)/i.exec(id);
  return m ? m[1] : undefined;
}

/**
 * Parse citekeys out of a BBT "not found: key1, key2" error message. Returns
 * an empty array if the message doesn't fit that shape.
 */
export function parseMissingCitekeys(message: string): string[] {
  const m = /not\s*found:\s*(.+?)(?:$|\n)/i.exec(message);
  if (!m) return [];
  return m[1]
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Extract each `<div class="csl-entry">…</div>` block from a BBT bibliography
 * HTML blob, preserving order. Uses DOMParser when available; falls back to
 * a non-greedy regex. Returns raw inner HTML strings (the entry div itself is
 * kept so list/hanging styles survive).
 */
function splitCslEntries(html: string): string[] {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nodes = doc.querySelectorAll(".csl-entry");
    if (nodes.length > 0) return Array.from(nodes).map((n) => n.outerHTML);
  } catch {
    /* fall through */
  }
  const out: string[] = [];
  const re = /<div[^>]*class="[^"]*csl-entry[^"]*"[^>]*>[\s\S]*?<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[0]);
  return out;
}

/**
 * Walk a library tree to find a collection by `"Library/Parent/Child"` path.
 * Matching is case-insensitive on names. Returns undefined if not found.
 * The library segment can be omitted — first matching collection wins.
 */
export function resolveCollection(
  libs: BBTLibrary[],
  path: string,
): { library: BBTLibrary; collection: BBTCollection } | undefined {
  const parts = path.split("/").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;

  // Coerce both sides to string; BBT has occasionally returned library/
  // collection entries without a `name`, which would otherwise throw here.
  const ciEq = (a: unknown, b: unknown) =>
    String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

  const searchIn = (
    lib: BBTLibrary,
    nodes: BBTCollection[] | undefined,
    names: string[],
  ): BBTCollection | undefined => {
    if (!nodes || nodes.length === 0 || names.length === 0) return undefined;
    const [head, ...rest] = names;
    for (const c of nodes) {
      if (ciEq(c.name, head)) {
        if (rest.length === 0) return c;
        const found = searchIn(lib, c.collections, rest);
        if (found) return found;
      }
    }
    return undefined;
  };

  // First try treating parts[0] as a library name.
  for (const lib of libs) {
    if (ciEq(lib.name, parts[0])) {
      const c = searchIn(lib, lib.collections, parts.slice(1));
      if (c) return { library: lib, collection: c };
    }
  }
  // Fallback: treat the whole path as relative to any library.
  for (const lib of libs) {
    const c = searchIn(lib, lib.collections, parts);
    if (c) return { library: lib, collection: c };
  }
  return undefined;
}
