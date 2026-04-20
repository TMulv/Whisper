export interface AudnexusChapter {
  title: string;
  startSec: number;
  endSec: number;
}

export interface ChapterLookupResult {
  asin: string;
  chapters: AudnexusChapter[];
  isAccurate: boolean;
}

interface AudnexusChapterRaw {
  title: string;
  startOffsetSec: number;
  lengthMs: number;
}

interface AudnexusResponse {
  asin: string;
  chapters: AudnexusChapterRaw[];
  runtimeLengthSec: number;
  isAccurate: boolean;
}

interface AudibleProduct {
  asin: string;
  title?: string;
  authors?: Array<{ name: string }>;
}

interface AudibleCatalogResponse {
  products: AudibleProduct[];
  total_results: number;
}

const ASIN_RE = /B[0-9A-Z]{9}/;

function extractAsinFromPath(audioPath: string): string | null {
  const filename = audioPath.split('/').pop() ?? audioPath;
  const match = filename.match(ASIN_RE);
  return match ? match[0] : null;
}

async function searchAudibleCatalog(title: string, author: string): Promise<string | null> {
  const query = encodeURIComponent(`${title} ${author}`);
  const url =
    `https://api.audible.com/1.0/catalog/products` +
    `?keywords=${query}&num_results=5&response_groups=product_attrs,contributors`;

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;

  const data = (await res.json()) as AudibleCatalogResponse;
  if (!data.products || data.products.length === 0) return null;

  return data.products[0].asin;
}

async function fetchAudnexusChapters(asin: string): Promise<ChapterLookupResult | null> {
  const url = `https://api.audnex.us/books/${asin}/chapters`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;

  const data = (await res.json()) as AudnexusResponse;
  if (!data.chapters || data.chapters.length === 0) return null;

  const runtimeSec = data.runtimeLengthSec;
  const chapters: AudnexusChapter[] = data.chapters.map((ch, i, arr) => {
    const next = arr[i + 1];
    const endSec = next != null ? next.startOffsetSec : runtimeSec;
    return { title: ch.title, startSec: ch.startOffsetSec, endSec };
  });

  return { asin, chapters, isAccurate: data.isAccurate };
}

/**
 * Look up audiobook chapters from Audnexus.
 * ASIN resolution order: filename → Audible catalog API → manual fallback.
 */
export async function lookupChapters(
  title: string,
  author: string,
  audioPath?: string,
): Promise<ChapterLookupResult | null> {
  let asin = audioPath ? extractAsinFromPath(audioPath) : null;
  if (!asin) {
    asin = await searchAudibleCatalog(title, author);
  }
  if (!asin) return null;
  return fetchAudnexusChapters(asin);
}

/**
 * Look up chapters by a known Audible ASIN directly.
 */
export async function lookupChaptersByAsin(asin: string): Promise<ChapterLookupResult | null> {
  return fetchAudnexusChapters(asin.trim().toUpperCase());
}
