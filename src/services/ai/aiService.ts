import { logger } from '@/utils/logger';
import { getApiKey, getModel, type AIModelId } from './aiStorage';
import { SYSTEM_PROMPT, getPrompt, type AIPromptContext, type AIPromptId } from './aiPrompts';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const MAX_CHAPTER_CHARS = 120_000;

export interface AIStreamChunk {
  type: 'text' | 'done' | 'error';
  text?: string;
  message?: string;
}

export interface RunPromptOptions {
  promptId: AIPromptId;
  context: AIPromptContext;
  signal?: AbortSignal;
  onChunk?: (chunk: AIStreamChunk) => void;
}

export class AIError extends Error {
  readonly code: 'no_key' | 'network' | 'auth' | 'server' | 'unknown';
  constructor(message: string, code: AIError['code']) {
    super(message);
    this.code = code;
  }
}

function truncate(text: string | null): string | null {
  if (!text) return null;
  if (text.length <= MAX_CHAPTER_CHARS) return text;
  const keepHead = Math.floor(MAX_CHAPTER_CHARS * 0.85);
  const keepTail = MAX_CHAPTER_CHARS - keepHead;
  return `${text.slice(0, keepHead)}\n\n[…chapter truncated…]\n\n${text.slice(-keepTail)}`;
}

export async function runPrompt(opts: RunPromptOptions): Promise<string> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new AIError('Add your Anthropic API key in Settings to use AI insights.', 'no_key');
  }
  const model = await getModel();
  const spec = getPrompt(opts.promptId);

  const ctx: AIPromptContext = { ...opts.context, chapterText: truncate(opts.context.chapterText) };
  const userText = spec.userMessage(ctx);

  return await streamClaude({
    apiKey,
    model,
    system: SYSTEM_PROMPT,
    userText,
    signal: opts.signal,
    onChunk: opts.onChunk,
  });
}

interface StreamArgs {
  apiKey: string;
  model: AIModelId;
  system: string;
  userText: string;
  signal?: AbortSignal;
  onChunk?: (chunk: AIStreamChunk) => void;
}

async function streamClaude(args: StreamArgs): Promise<string> {
  const body = {
    model: args.model,
    max_tokens: 1024,
    stream: true,
    system: args.system,
    messages: [{ role: 'user', content: args.userText }],
  };

  let resp: Response;
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': args.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: args.signal,
    });
  } catch (err) {
    logger.warn('AI fetch failed', err);
    throw new AIError('Network error. Check your connection and try again.', 'network');
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    logger.warn('AI bad status', { status: resp.status, text });
    if (resp.status === 401) {
      throw new AIError('API key rejected. Re-enter your key in Settings.', 'auth');
    }
    if (resp.status >= 500) {
      throw new AIError('Anthropic had a hiccup. Try again in a moment.', 'server');
    }
    throw new AIError(`Request failed (${resp.status}).`, 'unknown');
  }

  const body2 = resp.body;
  if (!body2) {
    const full = await resp.text();
    const extracted = extractFromFullBody(full);
    args.onChunk?.({ type: 'text', text: extracted });
    args.onChunk?.({ type: 'done' });
    return extracted;
  }

  const reader = body2.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const evt = JSON.parse(data);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            const text = evt.delta.text as string;
            full += text;
            args.onChunk?.({ type: 'text', text });
          } else if (evt.type === 'message_stop') {
            args.onChunk?.({ type: 'done' });
          }
        } catch (err) {
          logger.warn('AI stream parse', err);
        }
      }
    }
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      return full;
    }
    logger.warn('AI stream read error', err);
    throw new AIError('Lost connection mid-response. Try again.', 'network');
  }
  return full;
}

function extractFromFullBody(text: string): string {
  try {
    const obj = JSON.parse(text);
    const blocks = obj?.content;
    if (Array.isArray(blocks)) {
      return blocks
        .filter((b) => b?.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
    }
  } catch {}
  return '';
}
