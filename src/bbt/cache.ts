import type { App } from "obsidian";
import type { ZoobItem } from "./types";

interface Entry {
  item: ZoobItem;
  at: number;
}

interface DiskShape {
  version: number;
  entries: Record<string, Entry>;
}

const DISK_VERSION = 1;

/**
 * In-memory LRU-ish cache for hydrated items, optionally backed by a JSON file
 * on disk so the cache survives Obsidian restarts. Without the disk layer we
 * re-pay the full BBT cost on every app restart; with it, a warm citekey
 * costs zero RPCs on the render path.
 *
 * Disk writes are debounced — a burst of `put`/`putMany` calls collapse into a
 * single write.
 */
export class ItemCache {
  private map = new Map<string, Entry>();
  private app?: App;
  private diskPath?: string;
  private saveTimer: number | null = null;
  private saveDelayMs = 800;

  constructor(private ttlMs: number) {}

  setTTL(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  /** Bind the cache to a disk file. Loads any existing entries. */
  async attachDisk(app: App, diskPath: string): Promise<void> {
    this.app = app;
    this.diskPath = diskPath;
    try {
      const raw = (await app.vault.adapter.exists(diskPath))
        ? await app.vault.adapter.read(diskPath)
        : null;
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<DiskShape>;
      if (parsed.version !== DISK_VERSION || !parsed.entries) return;
      // Load everything; TTL is applied on read, not on load, so settings-level
      // TTL changes take effect without wiping the file.
      for (const [k, v] of Object.entries(parsed.entries)) {
        if (v && v.item && typeof v.at === "number") {
          this.map.set(k, v as Entry);
        }
      }
    } catch {
      // Corrupt cache file — ignore and carry on with an empty cache.
    }
  }

  /** Flush any pending write and wait for it. Call on plugin unload. */
  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveNow();
  }

  get(citekey: string): ZoobItem | undefined {
    const e = this.map.get(citekey);
    if (!e) return undefined;
    if (Date.now() - e.at > this.ttlMs) {
      this.map.delete(citekey);
      this.scheduleSave();
      return undefined;
    }
    return e.item;
  }

  getMany(citekeys: string[]): { hits: ZoobItem[]; misses: string[] } {
    const hits: ZoobItem[] = [];
    const misses: string[] = [];
    for (const k of citekeys) {
      const v = this.get(k);
      if (v) hits.push(v);
      else misses.push(k);
    }
    return { hits, misses };
  }

  put(item: ZoobItem) {
    this.map.set(item.citekey, { item, at: Date.now() });
    this.scheduleSave();
  }

  putMany(items: ZoobItem[]) {
    for (const it of items) {
      this.map.set(it.citekey, { item: it, at: Date.now() });
    }
    if (items.length > 0) this.scheduleSave();
  }

  invalidate(citekey?: string) {
    if (citekey) this.map.delete(citekey);
    else this.map.clear();
    this.scheduleSave();
  }

  private scheduleSave() {
    if (!this.app || !this.diskPath) return;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, this.saveDelayMs);
  }

  private async saveNow(): Promise<void> {
    if (!this.app || !this.diskPath) return;
    // Prune expired on write so the file doesn't balloon with dead entries.
    const cutoff = Date.now() - this.ttlMs;
    const entries: Record<string, Entry> = {};
    for (const [k, v] of this.map) {
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
