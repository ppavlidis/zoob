import { requestUrl } from "obsidian";

// Semantic Scholar graph API client (unauthenticated).
// Rate-limited (~100 req / 5 min shared pool); fine for on-demand hover use.
// Docs: https://api.semanticscholar.org/api-docs/graph

export interface S2Paper {
  paperId: string;         // used to build https://www.semanticscholar.org/paper/<paperId>
  citationCount: number;
}

interface CacheEntry {
  at: number;
  value: S2Paper | null;   // null = confirmed miss (don't retry within TTL)
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24h — counts drift slowly
const FIELDS = "paperId,citationCount";

class S2Client {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<S2Paper | null>>();

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

  private async cached(
    key: string,
    fetcher: () => Promise<S2Paper | null>,
  ): Promise<S2Paper | null> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = (async () => {
      try {
        const v = await fetcher();
        this.cache.set(key, { at: Date.now(), value: v });
        return v;
      } catch {
        this.cache.set(key, { at: Date.now(), value: null });
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
}

export const s2 = new S2Client();

export function s2PaperUrl(paperId: string): string {
  return `https://www.semanticscholar.org/paper/${paperId}`;
}
