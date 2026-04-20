import { logger } from '@/utils/logger';

const OL_SEARCH = 'https://openlibrary.org/search.json';
const OL_COVER = 'https://covers.openlibrary.org/b/id';
const GOOGLE_BOOKS = 'https://www.googleapis.com/books/v1/volumes';
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

export interface CoverCandidate {
  id: string;
  coverUrl: string;
  title: string;
  author: string;
}

export class CoverLookupError extends Error {
  constructor(public readonly cause: 'network' | 'server') {
    super(cause === 'network' ? 'Network unavailable' : 'Provider unreachable');
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  logger.info('cover fetch →', url);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    logger.info(`cover fetch ← ${res.status} in ${Date.now() - startedAt}ms`);
    return res;
  } catch (err) {
    logger.warn(`cover fetch failed after ${Date.now() - startedAt}ms`, err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function searchOpenLibrary(query: string, limit: number, fallbackTitle: string, fallbackAuthor: string): Promise<CoverCandidate[]> {
  const url =
    `${OL_SEARCH}?q=${encodeURIComponent(query)}` +
    `&limit=${limit}` +
    `&fields=${encodeURIComponent('cover_i,title,author_name')}`;

  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new CoverLookupError('server');

  const data = await res.json();
  const docs: Array<{ cover_i?: number; title?: string; author_name?: string[] }> = data.docs ?? [];

  const seen = new Set<number>();
  const out: CoverCandidate[] = [];
  for (const doc of docs) {
    if (!doc.cover_i || seen.has(doc.cover_i)) continue;
    seen.add(doc.cover_i);
    out.push({
      id: `ol-${doc.cover_i}`,
      coverUrl: `${OL_COVER}/${doc.cover_i}-M.jpg`,
      title: doc.title ?? fallbackTitle,
      author: doc.author_name?.[0] ?? fallbackAuthor,
    });
  }
  return out;
}

async function searchWikipedia(query: string, limit: number, fallbackTitle: string, fallbackAuthor: string): Promise<CoverCandidate[]> {
  // Single request that searches + fetches page thumbnails (infobox images).
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: String(Math.min(limit, 10)),
    prop: 'pageimages',
    piprop: 'thumbnail',
    pithumbsize: '400',
    origin: '*',
  });

  const res = await fetchWithTimeout(`${WIKIPEDIA_API}?${params.toString()}`);
  if (!res.ok) throw new CoverLookupError('server');

  const data = await res.json();
  const pages: Record<string, {
    pageid?: number;
    title?: string;
    thumbnail?: { source?: string };
  }> = data.query?.pages ?? {};

  const out: CoverCandidate[] = [];
  for (const page of Object.values(pages)) {
    const src = page.thumbnail?.source;
    if (!src) continue;
    out.push({
      id: `wp-${page.pageid ?? src}`,
      coverUrl: src,
      title: page.title ?? fallbackTitle,
      author: fallbackAuthor,
    });
  }
  return out;
}

async function searchGoogleBooks(query: string, limit: number, fallbackTitle: string, fallbackAuthor: string): Promise<CoverCandidate[]> {
  const url = `${GOOGLE_BOOKS}?q=${encodeURIComponent(query)}&maxResults=${Math.min(limit, 40)}&printType=books`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new CoverLookupError('server');

  const data = await res.json();
  const items: Array<{
    id?: string;
    volumeInfo?: {
      title?: string;
      authors?: string[];
      imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    };
  }> = data.items ?? [];

  const out: CoverCandidate[] = [];
  for (const item of items) {
    const links = item.volumeInfo?.imageLinks;
    const raw = links?.thumbnail ?? links?.smallThumbnail;
    if (!raw) continue;
    // Upgrade to HTTPS and request a larger zoom for better quality
    const coverUrl = raw.replace(/^http:\/\//, 'https://').replace(/&edge=curl/, '');
    out.push({
      id: `gb-${item.id ?? coverUrl}`,
      coverUrl,
      title: item.volumeInfo?.title ?? fallbackTitle,
      author: item.volumeInfo?.authors?.[0] ?? fallbackAuthor,
    });
  }
  return out;
}

/**
 * Search candidate covers across Open Library, Google Books, and Wikipedia
 * in parallel. Any single provider returning results is enough to populate
 * the picker — we don't block on the slow/broken ones.
 *
 * Throws `CoverLookupError` only when *all* providers fail.
 */
export async function searchBookCovers(
  title: string,
  author?: string,
  limit: number = 18,
): Promise<CoverCandidate[]> {
  const query = [title, author].filter(Boolean).join(' ').trim();
  if (!query) return [];

  const providers = [
    searchOpenLibrary(query, limit, title, author ?? ''),
    searchGoogleBooks(query, limit, title, author ?? ''),
    searchWikipedia(query, limit, title, author ?? ''),
  ];

  const settled = await Promise.allSettled(providers);
  const merged: CoverCandidate[] = [];
  const errors: unknown[] = [];
  const seen = new Set<string>();

  for (const r of settled) {
    if (r.status === 'fulfilled') {
      for (const c of r.value) {
        if (seen.has(c.coverUrl)) continue;
        seen.add(c.coverUrl);
        merged.push(c);
      }
    } else {
      errors.push(r.reason);
    }
  }

  if (merged.length > 0) return merged;

  // All providers returned zero — figure out whether it was network or server
  if (errors.length === providers.length) {
    const isAbort = (e: unknown) =>
      e instanceof Error && (e.name === 'AbortError' || /network|failed/i.test(e.message));
    if (errors.every(isAbort)) throw new CoverLookupError('network');
    throw new CoverLookupError('server');
  }
  return [];
}

/** Convenience: first candidate only. Returns null on any failure. */
export async function fetchBookCover(title: string, author?: string): Promise<string | null> {
  try {
    const results = await searchBookCovers(title, author, 3);
    return results[0]?.coverUrl ?? null;
  } catch {
    return null;
  }
}
