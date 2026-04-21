import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '@/utils/logger';

// ── Providers ───────────────────────────────────────────────────────────────

export type AIProvider = 'claude' | 'openai' | 'gemini';

export interface AIModelSpec {
  id: string;
  label: string;
  tier: 'fast' | 'medium' | 'best';
  tagline: string;
}

export interface AIProviderSpec {
  id: AIProvider;
  label: string;
  keyPlaceholder: string;
  keyPrefixHint: string;
  consoleUrl: string;
  models: readonly AIModelSpec[];
  defaultModel: string;
}

export const AI_PROVIDERS: readonly AIProviderSpec[] = [
  {
    id: 'claude',
    label: 'Claude',
    keyPlaceholder: 'sk-ant-…',
    keyPrefixHint: 'sk-ant-',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-sonnet-4-6',
    models: [
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', tier: 'fast', tagline: 'Fast and affordable.' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', tier: 'medium', tagline: 'Balanced — deeper analysis, still fast.' },
      { id: 'claude-opus-4-7', label: 'Opus 4.7', tier: 'best', tagline: 'Most capable. Slower, higher cost.' },
    ],
  },
  {
    id: 'openai',
    label: 'ChatGPT',
    keyPlaceholder: 'sk-…',
    keyPrefixHint: 'sk-',
    consoleUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', tier: 'fast', tagline: 'Fast and cheap.' },
      { id: 'gpt-4o', label: 'GPT-4o', tier: 'medium', tagline: 'Balanced — strong reasoning, fast.' },
      { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', tier: 'best', tagline: 'Deeper reasoning. Slower, pricier.' },
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    keyPlaceholder: 'AIza…',
    keyPrefixHint: 'AIza',
    consoleUrl: 'https://aistudio.google.com/app/apikey',
    defaultModel: 'gemini-1.5-pro',
    models: [
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', tier: 'fast', tagline: 'Fast and affordable.' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', tier: 'medium', tagline: 'Balanced — deeper analysis.' },
      { id: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash', tier: 'best', tagline: 'Newest. Longer context, experimental.' },
    ],
  },
] as const;

export function getProviderSpec(id: AIProvider): AIProviderSpec {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];
}

// ── Storage keys ────────────────────────────────────────────────────────────

const PROVIDER_KEY = '@whisper/ai_provider';
const MODEL_KEY_BY_PROVIDER = (p: AIProvider) => `@whisper/ai_model/${p}`;
const SECURE_KEY_BY_PROVIDER: Record<AIProvider, string> = {
  claude: 'anthropic_api_key',
  openai: 'openai_api_key',
  gemini: 'gemini_api_key',
};

// ── Provider selection ──────────────────────────────────────────────────────

export async function getProvider(): Promise<AIProvider> {
  const stored = await AsyncStorage.getItem(PROVIDER_KEY);
  if (stored && AI_PROVIDERS.some((p) => p.id === stored)) {
    return stored as AIProvider;
  }
  return 'claude';
}

export async function setProvider(id: AIProvider): Promise<void> {
  await AsyncStorage.setItem(PROVIDER_KEY, id);
}

// ── API keys ────────────────────────────────────────────────────────────────

export async function getApiKeyFor(provider: AIProvider): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECURE_KEY_BY_PROVIDER[provider]);
  } catch (err) {
    logger.warn(`Failed to read ${provider} api key`, err);
    return null;
  }
}

export async function saveApiKeyFor(provider: AIProvider, key: string): Promise<void> {
  await SecureStore.setItemAsync(SECURE_KEY_BY_PROVIDER[provider], key.trim());
}

export async function clearApiKeyFor(provider: AIProvider): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SECURE_KEY_BY_PROVIDER[provider]);
  } catch (err) {
    logger.warn(`Failed to clear ${provider} api key`, err);
  }
}

export async function hasApiKeyForActiveProvider(): Promise<boolean> {
  const provider = await getProvider();
  const k = await getApiKeyFor(provider);
  return !!k && k.length > 0;
}

// Convenience for the currently selected provider
export async function getActiveApiKey(): Promise<string | null> {
  const provider = await getProvider();
  return getApiKeyFor(provider);
}

// ── Model selection (advanced) ──────────────────────────────────────────────

export async function getModelFor(provider: AIProvider): Promise<string> {
  const spec = getProviderSpec(provider);
  const stored = await AsyncStorage.getItem(MODEL_KEY_BY_PROVIDER(provider));
  if (stored && spec.models.some((m) => m.id === stored)) {
    return stored;
  }
  return spec.defaultModel;
}

export async function saveModelFor(provider: AIProvider, modelId: string): Promise<void> {
  await AsyncStorage.setItem(MODEL_KEY_BY_PROVIDER(provider), modelId);
}

export async function resetModelFor(provider: AIProvider): Promise<void> {
  await AsyncStorage.removeItem(MODEL_KEY_BY_PROVIDER(provider));
}

// ── Legacy shims (kept for callers still importing old names) ──────────────

/** @deprecated Use hasApiKeyForActiveProvider. */
export async function hasApiKey(): Promise<boolean> {
  return hasApiKeyForActiveProvider();
}
