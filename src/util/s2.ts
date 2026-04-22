import { requestUrl, type App } from "obsidian";

// Semantic Scholar graph API client (unauthenticated).
// Rate-limited (~100 req / 5 min shared pool); we cache aggressively to be a
// good citizen — a warmed cache survives Obsidian restart via disk backing.
// Docs: https://api.semanticscholar.org/api-docs/graph

export interface S2Paper {
  paperId: string;         // used to build https://www.semanticscholar.org/paper/<paperId>
  citationCount: number;
}

interface CacheEntry {
  at: number;
  value: S2Paper | null;   // null = confirmed miss (don't retry within TTL)
}

interface DiskShape {
  version: number;
  entries: Record<string, CacheEntry>;
}

// Default TTL when the user hasn't customized: 30 days. Citation counts drift
// slowly, and avoiding rate-limit spam matters more than having a perfectly
// up-to-date number. Click-to-retry on a `?` badge lets the user force a
// refresh before the TTL expires anyway. TTL is configurable via
// `setTTL(days)` from settings; 0 means "never refresh after first check".
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Negative (never-expire) sentinel uses Infinity in the TTL check.
const NEVER_MS = Infinity;
const DISK_VERSION = 1;
const FIELDS = "paperId,citationCount";

class S2Client {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<S2Paper | null>>();
  private app?: App;
  private diskPath?: string;
  private saveTimer: number | null = null;
  private saveDelayMs = 1500;
  private ttlMs: number = DEFAULT_TTL_MS;

  /**
   * Set the cache freshness window. `days === 0` means "never refresh after
   * first check" — cached hits live forever (until cleared by the user via
   * click-to-retry or a manual file delete).
   */
  setTTL(days: number): void {
    this.ttlMs = days <= 0 ? NEVER_MS : days * 24 * 60 * 60 * 1000;
  }

  async byDOI(doi: string): Promise<S2Paper | null> {
    return this.cached(`doi:${doi.toLowerCase()}`, () =>
      this.fetchPaper(`DOI:${encodeURIComponent(doi)}`),
    );
  }

  async byTitle(title: string): Promise<S2Paper | null> {
    const key = `title:${title.toLowerCase().slice(0, 120)}`;
    return this.cached(key, () => this.searchByTitle(title));
  }

  /** Best-effort lookup: DOI wins; fall back to title search. */
  async lookup(doi?: string, title?: string): Promise<S2Paper | null> {
    if (doi) {
      const r = await this.byDOI(doi);
      if (r) return r;
    }
    if (title) return this.byTitle(title);
    return null;
  }

  /**
   * Drop cached entries for the given DOI and/or title so the next `lookup`
   * hits the network. Used to power a click-to-retry on the "Cited by: ?"
   * badge — a `?` usually means a prior lookup was rate-limited or failed and
   * the negative result is pinned in-cache.
   */
  invalidate(doi?: string, title?: string): void {
    let dirty = false;
    if (doi && this.cache.delete(`doi:${doi.toLowerCase()}`)) dirty = true;
    if (title && this.cache.delete(`title:${title.toLowerCase().slice(0, 120)}`)) dirty = true;
    if (dirty) this.scheduleSave();
  }

  /**
   * Bind the cache to a disk file. Loads any existing entries so a warm cache
   * survives Obsidian restarts. Same pattern as `ItemCache` in bbt/cache.ts.
   */
  async attachDisk(app: App, diskPath: string): Promise<void> {
    this.app = app;
    this.diskPath = diskPath;
    try {
      const exists = await app.vault.adapter.exists(diskPath);
      if (!exists) return;
      const raw = await app.vault.adapter.read(diskPath);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<DiskShape>;
      if (parsed.version !== DISK_VERSION || !parsed.entries) return;
      for (const [k, v] of Object.entries(parsed.entries)) {
        if (v && typeof v.at === "number") {
          this.cache.set(k, v as CacheEntry);
        }
      }
    } catch {
      // Corrupt cache file — ignore and carry on with an empty cache.
    }
  }

  /** Flush any pending write. Call on plugin unload. */
  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveNow();
  }

  private async cached(
    key: string,
    fetcher: () => Promise<S2Paper | null>,
  ): Promise<S2Paper | null> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = (async () => {
      try {
        const v = await fetcher();
        this.cache.set(key, { at: Date.now(), value: v });
        this.scheduleSave();
        return v;
      } catch {
        this.cache.set(key, { at: Date.now(), value: null });
        this.scheduleSave();
        return null;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  private async fetchPaper(id: string): Promise<S2Paper | null> {
    const url = `https://api.semanticscholar.org/graph/v1/paper/${id}?fields=${FIELDS}`;
    const res = await requestUrl({ url, method: "GET", throw: false });
    if (res.status !== 200) return null;
    const body = JSON.parse(res.text ?? "null");
    if (!body || typeof body.paperId !== "string") return null;
    return { paperId: body.paperId, citationCount: Number(body.citationCount ?? 0) };
  }

  private async searchByTitle(title: string): Promise<S2Paper | null> {
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&limit=1&fields=${FIELDS}`;
    const res = await requestUrl({ url, method: "GET", throw: false });
    if (res.status !== 200) return null;
    const body = JSON.parse(res.text ?? "null");
    const hit = body?.data?.[0];
    if (!hit || typeof hit.paperId !== "string") return null;
    return { paperId: hit.paperId, citationCount: Number(hit.citationCount ?? 0) };
  }

  private scheduleSave(): void {
    if (!this.app || !this.diskPath) return;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, this.saveDelayMs);
  }

  private async saveNow(): Promise<void> {
    if (!this.app || !this.diskPath) return;
    // Prune expired on write so the file doesn't balloon forever. With TTL
    // set to "never" (Infinity), nothing is expired — cutoff becomes -Inf
    // and every entry is kept.
    const cutoff = this.ttlMs === NEVER_MS ? -Infinity : Date.now() - this.ttlMs;
    const entries: Record<string, CacheEntry> = {};
    for (const [k, v] of this.cache) {
      if (v.at >= cutoff) entries[k] = v;
    }
    const shape: DiskShape = { version: DISK_VERSION, entries };
    try {
      await this.app.vault.adapter.write(this.diskPath, JSON.stringify(shape));
    } catch {
      // Don't block the user on a cache-write failure.
    }
  }
}

export const s2 = new S2Client();

export function s2PaperUrl(paperId: string): string {
  return `https://www.semanticscholar.org/paper/${paperId}`;
}
