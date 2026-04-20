import { logger } from '@/utils/logger';

const GOOGLE_BOOKS_API = 'https://www.googleapis.com/books/v1/volumes';

export async function fetchBookCover(title: string, author?: string): Promise<string | null> {
  try {
    const q = author
      ? `intitle:${encodeURIComponent(title)}+inauthor:${encodeURIComponent(author)}`
      : `intitle:${encodeURIComponent(title)}`;

    const res = await fetch(`${GOOGLE_BOOKS_API}?q=${q}&maxResults=3&fields=items(volumeInfo/imageLinks)`);
    if (!res.ok) return null;

    const data = await res.json();
    const items: Array<{ volumeInfo: { imageLinks?: { thumbnail?: string; smallThumbnail?: string } } }> =
      data.items ?? [];

    for (const item of items) {
      const links = item.volumeInfo?.imageLinks;
      const url = links?.thumbnail ?? links?.smallThumbnail;
      if (url) {
        // Google Books returns http:// — upgrade to https
        return url.replace(/^http:\/\//, 'https://');
      }
    }

    return null;
  } catch (err) {
    logger.error('fetchBookCover failed', err);
    return null;
  }
}
