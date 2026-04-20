import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { logger } from '@/utils/logger';

WebBrowser.maybeCompleteAuthSession();

// ── Key constants ────────────────────────────────────────────────────────────

const GD_ACCESS_TOKEN_KEY = 'gdrive_access_token';
const GD_REFRESH_TOKEN_KEY = 'gdrive_refresh_token';
const GD_TOKEN_EXPIRY_KEY = 'gdrive_token_expiry';

const GD_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GD_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GD_API_BASE = 'https://www.googleapis.com/drive/v3';

export const GDRIVE_BOOKS_FOLDER_NAME = 'Books';

function getClientId(): string {
  return Constants.expoConfig?.extra?.googleDriveClientId ?? '';
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface DriveEntry {
  type: 'file' | 'folder';
  id: string;
  name: string;
  size?: number;
  modifiedTime?: string;
  mimeType: string;
}

// ── Token storage ────────────────────────────────────────────────────────────

export async function getStoredAccessToken(): Promise<string | null> {
  try {
    const token = await SecureStore.getItemAsync(GD_ACCESS_TOKEN_KEY);
    const expiry = await SecureStore.getItemAsync(GD_TOKEN_EXPIRY_KEY);
    if (!token) return null;
    if (expiry && Date.now() > parseInt(expiry, 10)) {
      return refreshAccessToken();
    }
    return token;
  } catch {
    return null;
  }
}

export async function storeTokens(
  accessToken: string,
  refreshToken?: string,
  expiresInSeconds?: number,
): Promise<void> {
  await SecureStore.setItemAsync(GD_ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) {
    await SecureStore.setItemAsync(GD_REFRESH_TOKEN_KEY, refreshToken);
  }
  if (expiresInSeconds) {
    const expiry = Date.now() + expiresInSeconds * 1000;
    await SecureStore.setItemAsync(GD_TOKEN_EXPIRY_KEY, String(expiry));
  }
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(GD_ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(GD_REFRESH_TOKEN_KEY);
  await SecureStore.deleteItemAsync(GD_TOKEN_EXPIRY_KEY);
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await SecureStore.getItemAsync(GD_ACCESS_TOKEN_KEY);
  return !!token;
}

// ── OAuth2 PKCE flow ─────────────────────────────────────────────────────────

export async function authenticate(): Promise<boolean> {
  const clientId = getClientId();
  if (!clientId) {
    logger.error('Google Drive client ID not configured. Set GOOGLE_DRIVE_CLIENT_ID in app config.');
    return false;
  }

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'whisper', path: 'gdrive-auth' });
  const codeVerifier = await generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
    codeChallenge,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
    ],
    extraParams: { access_type: 'offline', prompt: 'consent' },
  });

  const discovery = {
    authorizationEndpoint: GD_AUTH_ENDPOINT,
    tokenEndpoint: GD_TOKEN_ENDPOINT,
  };

  try {
    const result = await request.promptAsync(discovery);
    if (result.type !== 'success' || !result.params.code) {
      logger.warn('Google Drive auth cancelled or failed', result.type);
      return false;
    }

    const tokenResponse = await fetch(GD_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: result.params.code,
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      logger.error('Google Drive token exchange failed', await tokenResponse.text());
      return false;
    }

    const tokenData = await tokenResponse.json();
    await storeTokens(tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);
    logger.info('Google Drive authentication successful');
    return true;
  } catch (err) {
    logger.error('Google Drive authenticate error', err);
    return false;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const clientId = getClientId();
  const refreshToken = await SecureStore.getItemAsync(GD_REFRESH_TOKEN_KEY);
  if (!refreshToken || !clientId) return null;

  try {
    const response = await fetch(GD_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
    });

    if (!response.ok) {
      logger.warn('Google Drive token refresh failed — clearing tokens');
      await clearTokens();
      return null;
    }

    const data = await response.json();
    await storeTokens(data.access_token, undefined, data.expires_in);
    return data.access_token as string;
  } catch (err) {
    logger.error('Google Drive refreshAccessToken error', err);
    return null;
  }
}

// ── PKCE helpers ─────────────────────────────────────────────────────────────

async function generateCodeVerifier(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return base64UrlEncode(bytes);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── API helpers ──────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getStoredAccessToken();
  if (!token) throw new Error('Not authenticated with Google Drive. Please connect in Settings.');
  return { Authorization: `Bearer ${token}` };
}

// ── File operations ──────────────────────────────────────────────────────────

async function listFilesInFolder(folderId: string): Promise<DriveEntry[]> {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,size,modifiedTime)',
    pageSize: '200',
  });

  const response = await fetch(`${GD_API_BASE}/files?${params}`, { headers });
  if (!response.ok) {
    throw new Error(`Google Drive list failed (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  return (data.files as Array<{
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
  }>).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    type: f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
    size: f.size ? parseInt(f.size, 10) : undefined,
    modifiedTime: f.modifiedTime,
  }));
}

async function findFolderByName(name: string, parentId: string = 'root'): Promise<string | null> {
  const headers = await getAuthHeaders();
  const params = new URLSearchParams({
    q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id,name)',
  });

  const response = await fetch(`${GD_API_BASE}/files?${params}`, { headers });
  if (!response.ok) return null;

  const data = await response.json();
  return data.files?.[0]?.id ?? null;
}

/**
 * List all book folders inside the "Books" folder in Google Drive root.
 */
export async function listBooks(): Promise<DriveEntry[]> {
  try {
    const booksFolderId = await findFolderByName(GDRIVE_BOOKS_FOLDER_NAME);
    if (!booksFolderId) {
      logger.warn('Google Drive: "Books" folder not found at root');
      return [];
    }
    const entries = await listFilesInFolder(booksFolderId);
    return entries.filter((e) => e.type === 'folder');
  } catch (err) {
    logger.warn('Google Drive listBooks failed', err);
    return [];
  }
}

/**
 * List files inside a specific book folder.
 */
export async function listBookFiles(folderId: string): Promise<DriveEntry[]> {
  const entries = await listFilesInFolder(folderId);
  return entries.filter((e) => e.type === 'file');
}

/**
 * Download a Google Drive file to a local URI.
 */
export async function downloadFile(fileId: string, localUri: string): Promise<string> {
  const token = await getStoredAccessToken();
  if (!token) throw new Error('Not authenticated with Google Drive');

  const { File } = await import('expo-file-system');
  const destFile = new File(localUri);

  const downloaded = await File.downloadFileAsync(
    `${GD_API_BASE}/files/${fileId}?alt=media`,
    destFile,
    { headers: { Authorization: `Bearer ${token}` } } as Parameters<typeof File.downloadFileAsync>[2],
  );

  return downloaded.uri;
}
