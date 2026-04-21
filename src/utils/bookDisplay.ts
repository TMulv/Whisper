export interface BookDisplay {
  title: string;
  author: string;
}

/**
 * Imported books typically have their title stored as "Title - Author" (from
 * folder names or filenames), while the stored `author` field is unreliable —
 * it often ends up holding narrator metadata from audio tags. Prefer the
 * parsed title/author when a separator is present.
 */
export function getBookDisplay(book: {
  title: string;
  author?: string | null;
}): BookDisplay {
  const rawTitle = (book.title ?? '').trim();
  const rawAuthor = (book.author ?? '').trim();

  const match = rawTitle.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (match) {
    return { title: match[1].trim(), author: match[2].trim() };
  }

  return { title: rawTitle, author: rawAuthor };
}
