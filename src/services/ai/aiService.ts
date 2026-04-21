import { logger } from '@/utils/logger';
import {
  getActiveApiKey,
  getProvider,
  getModelFor,
  type AIProvider,
} from './aiStorage';
import { SYSTEM_PROMPT, getPrompt, type AIPromptContext, type AIPromptId } from './aiPrompts';

const MAX_CHAPTER_CHARS = 120_000;

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const GEMINI_URL = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;

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
  const provider = await getProvider();
  const apiKey = await getActiveApiKey();
  if (!apiKey) {
    throw new AIError('Add your API key in Settings to use AI insights.', 'no_key');
  }
  const model = await getModelFor(provider);
  const spec = getPrompt(opts.promptId);
  const ctx: AIPromptContext = { ...opts.context, chapterText: truncate(opts.context.chapterText) };
  const userText = spec.userMessage(ctx);

  const streamArgs: StreamArgs = {
    apiKey,
    model,
    system: SYSTEM_PROMPT,
    userText,
    signal: opts.signal,
    onChunk: opts.onChunk,
  };

  switch (provider) {
    case 'claude':
      return streamClaude(streamArgs);
    case 'openai':
      return streamOpenAI(streamArgs);
    case 'gemini':
      return streamGemini(streamArgs);
  }
}

interface StreamArgs {
  apiKey: string;
  model: string;
  system: string;
  userText: string;
  signal?: AbortSignal;
  onChunk?: (chunk: AIStreamChunk) => void;
}

// ── Claude (Anthropic) ──────────────────────────────────────────────────────

async function streamClaude(args: StreamArgs): Promise<string> {
  const body = {
    model: args.model,
    max_tokens: 1024,
    stream: true,
    system: args.system,
    messages: [{ role: 'user', content: args.userText }],
  };

  const resp = await safeFetch(
    ANTHROPIC_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': args.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: args.signal,
    },
    'claude',
  );

  return consumeSSE(resp, args, (evt) => {
    if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
      return evt.delta.text as string;
    }
    return null;
  });
}

// ── OpenAI (ChatGPT) ────────────────────────────────────────────────────────

async function streamOpenAI(args: StreamArgs): Promise<string> {
  const body = {
    model: args.model,
    stream: true,
    messages: [
      { role: 'system', content: args.system },
      { role: 'user', content: args.userText },
    ],
    max_tokens: 1024,
  };

  const resp = await safeFetch(
    OPENAI_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: args.signal,
    },
    'openai',
  );

  return consumeSSE(resp, args, (evt) => {
    const delta = evt.choices?.[0]?.delta?.content;
    return typeof delta === 'string' ? delta : null;
  });
}

// ── Gemini (Google) ─────────────────────────────────────────────────────────

async function streamGemini(args: StreamArgs): Promise<string> {
  const body = {
    systemInstruction: { parts: [{ text: args.system }] },
    contents: [{ role: 'user', parts: [{ text: args.userText }] }],
    generationConfig: { maxOutputTokens: 1024 },
  };

  const resp = await safeFetch(
    GEMINI_URL(args.model, args.apiKey),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: args.signal,
    },
    'gemini',
  );

  return consumeSSE(resp, args, (evt) => {
    const parts = evt.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;
    const text = parts.map((p: { text?: string }) => p.text ?? '').join('');
    return text || null;
  });
}

// ── Shared HTTP + SSE ──────────────────────────────────────────────────────

async function safeFetch(url: string, init: RequestInit, provider: AIProvider): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch (err) {
    logger.warn(`AI fetch failed (${provider})`, err);
    throw new AIError('Network error. Check your connection and try again.', 'network');
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    logger.warn(`AI bad status (${provider})`, { status: resp.status, text });
    if (resp.status === 401 || resp.status === 403) {
      throw new AIError('API key rejected. Re-enter your key in Settings.', 'auth');
    }
    if (resp.status >= 500) {
      throw new AIError('The AI provider had a hiccup. Try again in a moment.', 'server');
    }
    throw new AIError(`Request failed (${resp.status}).`, 'unknown');
  }

  return resp;
}

async function consumeSSE(
  resp: Response,
  args: StreamArgs,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extract: (evt: any) => string | null,
): Promise<string> {
  const stream = resp.body;
  if (!stream) {
    const raw = await resp.text();
    const extracted = extractFromFullBody(raw);
    args.onChunk?.({ type: 'text', text: extracted });
    args.onChunk?.({ type: 'done' });
    return extracted;
  }

  const reader = stream.getReader();
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
          const text = extract(evt);
          if (text) {
            full += text;
            args.onChunk?.({ type: 'text', text });
          }
          if (evt.type === 'message_stop') {
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
  args.onChunk?.({ type: 'done' });
  return full;
}

function extractFromFullBody(text: string): string {
  try {
    const obj = JSON.parse(text);
    // Anthropic
    const blocks = obj?.content;
    if (Array.isArray(blocks)) {
      return blocks.filter((b) => b?.type === 'text').map((b) => b.text ?? '').join('');
    }
    // OpenAI
    const choice = obj?.choices?.[0]?.message?.content;
    if (typeof choice === 'string') return choice;
    // Gemini
    const parts = obj?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      return parts.map((p: { text?: string }) => p.text ?? '').join('');
    }
  } catch {}
  return '';
}
