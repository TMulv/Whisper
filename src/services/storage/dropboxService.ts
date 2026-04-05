import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { DROPBOX_API_BASE, DROPBOX_CONTENT_API_BASE, DROPBOX_FOLDER } from '@/constants/config';
import { logger } from '@/utils/logger';

WebBrowser.maybeCompleteAuthSession();

const DROPBOX_ACCESS_TOKEN_KEY = 'dropbox_access_token';
const DROPBOX_REFRESH_TOKEN_KEY = 'dropbox_refresh_token';

export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync(DROPBOX_ACCESS_TOKEN_KEY);
}

export async function storeTokens(accessToken: string, refreshToken?: string): Promise<void> {
  await SecureStore.setItemAsync(DROPBOX_ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) {
    await SecureStore.setItemAsync(DROPBOX_REFRESH_TOKEN_KEY, refreshToken);
  }
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(DROPBOX_ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(DROPBOX_REFRESH_TOKEN_KEY);
}

async function getHeaders(): Promise<Record<string, string>> {
  const token = await getStoredToken();
  if (!token) throw new Error('Not authenticated with Dropbox');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export interface DropboxEntry {
  '.tag': 'file' | 'folder';
  name: string;
  path_lower: string;
  path_display: string;
  size?: number;
  client_modified?: string;
}

export async function listFolder(path: string = DROPBOX_FOLDER): Promise<DropboxEntry[]> {
  const headers = await getHeaders();
  const response = await fetch(`${DROPBOX_API_BASE}/files/list_folder`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path, recursive: false }),
  });

  if (!response.ok) {
    throw new Error(`Dropbox listFolder failed: ${response.status}`);
  }

  const data = await response.json();
  return data.entries as DropboxEntry[];
}

export async function downloadFile(dropboxPath: string, localDest: string): Promise<string> {
  const token = await getStoredToken();
  if (!token) throw new Error('Not authenticated with Dropbox');

  const response = await fetch(`${DROPBOX_CONTENT_API_BASE}/files/download`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }),
    },
  });

  if (!response.ok) {
    throw new Error(`Dropbox download failed: ${response.status}`);
  }

  const blob = await response.blob();
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = () => {
      // In React Native, write via expo-file-system separately after getting blob
      resolve(localDest);
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

export async function getTemporaryLink(dropboxPath: string): Promise<string> {
  const headers = await getHeaders();
  const response = await fetch(`${DROPBOX_API_BASE}/files/get_temporary_link`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: dropboxPath }),
  });

  if (!response.ok) {
    throw new Error(`Dropbox get_temporary_link failed: ${response.status}`);
  }

  const data = await response.json();
  return data.link as string;
}

export function isConnected(): boolean {
  // Will be wired to useNetworkStatus in Phase 1
  return true;
}
