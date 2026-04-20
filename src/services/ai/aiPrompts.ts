export type AIPromptId =
  | 'recap'
  | 'metaphors'
  | 'bookclub'
  | 'themes'
  | 'characters'
  | 'vocabulary'
  | 'custom';

export interface AIPromptSpec {
  id: AIPromptId;
  icon: string;
  title: string;
  description: string;
  userMessage: (ctx: AIPromptContext) => string;
}

export interface AIPromptContext {
  bookTitle: string;
  author: string;
  chapterTitle: string;
  chapterIndex: number;
  totalChapters: number;
  chapterText: string | null;
  userQuestion?: string;
}

export const SYSTEM_PROMPT = `You are a thoughtful literary companion inside a reading app called Whisper. The reader is listening to an audiobook and/or reading the ebook. They want concise, spoiler-aware help to go deeper on what they just finished.

Ground rules:
- Only use content from the chapter the reader just finished. Do NOT reference later chapters, even if you know the book. If you don't have the chapter text, use only the chapter title/book metadata and say so briefly.
- Never spoil anything that happens after the current chapter.
- Be warm and direct. Skip preamble. Do not say "in this chapter" over and over.
- Use short paragraphs or tight bullets. No headings unless asked.
- When quoting, keep quotes under 20 words and use "quote" style.`;

function chapterHeader(ctx: AIPromptContext): string {
  const loc = `Chapter ${ctx.chapterIndex + 1} of ${ctx.totalChapters}${ctx.chapterTitle ? ` — "${ctx.chapterTitle}"` : ''}`;
  const meta = `Book: "${ctx.bookTitle}"${ctx.author ? ` by ${ctx.author}` : ''}\n${loc}`;
  if (ctx.chapterText && ctx.chapterText.length > 0) {
    return `${meta}\n\nChapter text:\n"""\n${ctx.chapterText}\n"""`;
  }
  return `${meta}\n\n(No chapter text is available — reason from the book metadata and your general knowledge, and be clear when you're uncertain.)`;
}

export const AI_PROMPTS: AIPromptSpec[] = [
  {
    id: 'recap',
    icon: '📝',
    title: 'Recap',
    description: 'What happened in the chapter I just finished.',
    userMessage: (ctx) =>
      `${chapterHeader(ctx)}\n\nGive me a short recap (4–6 sentences). Focus on plot beats and shifts in tone — not every detail. End with a one-line "where we leave off".`,
  },
  {
    id: 'metaphors',
    icon: '🪞',
    title: 'Metaphors & Symbols',
    description: 'Imagery, metaphor, and what it might mean.',
    userMessage: (ctx) =>
      `${chapterHeader(ctx)}\n\nSurface 3–5 notable metaphors, images, or symbols from this chapter. For each, give a tight name, a brief quote or paraphrase, and one sentence on what it seems to be doing thematically. Use a bulleted list.`,
  },
  {
    id: 'bookclub',
    icon: '💬',
    title: 'Book Club Questions',
    description: '5 questions that would spark real discussion.',
    userMessage: (ctx) =>
      `${chapterHeader(ctx)}\n\nWrite 5 book-club-style discussion questions grounded in this chapter. Prefer open-ended questions that invite interpretation, disagreement, or personal connection over yes/no recall. Number them.`,
  },
  {
    id: 'themes',
    icon: '🧭',
    title: 'Themes',
    description: 'The ideas this chapter is working on.',
    userMessage: (ctx) =>
      `${chapterHeader(ctx)}\n\nName 2–4 themes this chapter is developing. For each, write one sentence on how the chapter is pressing on it (what changes, what tension appears). Bullet list.`,
  },
  {
    id: 'characters',
    icon: '👤',
    title: 'Character Moves',
    description: 'Who mattered here and what shifted.',
    userMessage: (ctx) =>
      `${chapterHeader(ctx)}\n\nWho were the characters that mattered in this chapter, and what changed for each? One short bullet per character — action or shift, not a résumé. Skip characters who only appeared in passing.`,
  },
  {
    id: 'vocabulary',
    icon: '📖',
    title: 'Words to Know',
    description: 'Unusual or evocative language from the chapter.',
    userMessage: (ctx) =>
      `${chapterHeader(ctx)}\n\nPick 4–6 interesting words or phrases from this chapter that a curious reader might want to look up or savor. For each: the word, a brief gloss, and one line on why the author's choice lands. Skip plain vocabulary.`,
  },
  {
    id: 'custom',
    icon: '✨',
    title: 'Ask anything',
    description: 'Your own question about the chapter.',
    userMessage: (ctx) =>
      `${chapterHeader(ctx)}\n\nReader's question:\n${ctx.userQuestion?.trim() || '(no question provided)'}\n\nAnswer their question grounded in the chapter. If the chapter doesn't address it, say so and then give your best contextual answer.`,
  },
];

export function getPrompt(id: AIPromptId): AIPromptSpec {
  const found = AI_PROMPTS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown prompt id: ${id}`);
  return found;
}
