import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '@/utils/logger';

const API_KEY_STORE = 'anthropic_api_key';
const MODEL_KEY = '@whisper/ai_model';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export const AI_MODELS = [
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Haiku 4.5',
    tagline: 'Fast and affordable. Best for quick recaps.',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    tagline: 'Balanced — deeper analysis, still fast.',
  },
  {
    id: 'claude-opus-4-7',
    label: 'Opus 4.7',
    tagline: 'Most capable. Slower, higher cost.',
  },
] as const;

export type AIModelId = (typeof AI_MODELS)[number]['id'];

export async function getApiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(API_KEY_STORE);
  } catch (err) {
    logger.warn('Failed to read AI api key', err);
    return null;
  }
}

export async function saveApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(API_KEY_STORE, key.trim());
}

export async function clearApiKey(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(API_KEY_STORE);
  } catch (err) {
    logger.warn('Failed to clear AI api key', err);
  }
}

export async function hasApiKey(): Promise<boolean> {
  const k = await getApiKey();
  return !!k && k.length > 0;
}

export async function getModel(): Promise<AIModelId> {
  const stored = await AsyncStorage.getItem(MODEL_KEY);
  if (stored && AI_MODELS.some((m) => m.id === stored)) {
    return stored as AIModelId;
  }
  return DEFAULT_MODEL;
}

export async function saveModel(id: AIModelId): Promise<void> {
  await AsyncStorage.setItem(MODEL_KEY, id);
}
