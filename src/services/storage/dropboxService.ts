import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { DROPBOX_API_BASE, DROPBOX_CONTENT_API_BASE, DROPBOX_FOLDER } from '@/constants/config';
import { logger } from '@/utils/logger';

WebBrowser.maybeCompleteAuthSession();

// ── Key constants ────────────────────────────────────────────────────────────

const DROPBOX_ACCESS_TOKEN_KEY = 'dropbox_access_token';
const DROPBOX_REFRESH_TOKEN_KEY = 'dropbox_refresh_token';
const DROPBOX_TOKEN_EXPIRY_KEY = 'dropbox_token_expiry';

const DROPBOX_AUTH_ENDPOINT = 'https://www.dropbox.com/oauth2/authorize';
const DROPBOX_TOKEN_ENDPOINT = 'https://api.dropboxapi.com/oauth2/token';

function getAppKey(): string {
  return Constants.expoConfig?.extra?.dropboxAppKey ?? '';
}

// ── Token storage ────────────────────────────────────────────────────────────

export async function getStoredAccessToken(): Promise<string | null> {
  try {
    const token = await SecureStore.getItemAsync(DROPBOX_ACCESS_TOKEN_KEY);
    const expiry = await SecureStore.getItemAsync(DROPBOX_TOKEN_EXPIRY_KEY);
    if (!token) return null;
    // If token has expiry and is expired, try refresh
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
  await SecureStore.setItemAsync(DROPBOX_ACCESS_TOKEN_KEY, accessToken);
  if (refreshToken) {
    await SecureStore.setItemAsync(DROPBOX_REFRESH_TOKEN_KEY, refreshToken);
  }
  if (expiresInSeconds) {
    const expiry = Date.now() + expiresInSeconds * 1000;
    await SecureStore.setItemAsync(DROPBOX_TOKEN_EXPIRY_KEY, String(expiry));
  }
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(DROPBOX_ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(DROPBOX_REFRESH_TOKEN_KEY);
  await SecureStore.deleteItemAsync(DROPBOX_TOKEN_EXPIRY_KEY);
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await SecureStore.getItemAsync(DROPBOX_ACCESS_TOKEN_KEY);
  return !!token;
}

// ── PKCE OAuth flow ──────────────────────────────────────────────────────────

/**
 * Launch the Dropbox OAuth PKCE flow.
 * Call this from a component that renders a button.
 * Returns true if authentication succeeded.
 */
export async function authenticate(): Promise<boolean> {
  const appKey = getAppKey();
  if (!appKey) {
    logger.error('Dropbox app key not configured. Set DROPBOX_APP_KEY in .env');
    return false;
  }

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'whisper', path: 'dropbox-auth' });

  // Generate PKCE verifier and challenge
  const codeVerifier = await generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const request = new AuthSession.AuthRequest({
    clientId: appKey,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    codeChallengeMethod: AuthSession.CodeChallengeMethod.S256,
    codeChallenge,
    scopes: ['files.content.read', 'files.content.write', 'files.metadata.read'],
    extraParams: { token_access_type: 'offline' },
  });

  const discovery = {
    authorizationEndpoint: DROPBOX_AUTH_ENDPOINT,
    tokenEndpoint: DROPBOX_TOKEN_ENDPOINT,
  };

  try {
    const result = await request.promptAsync(discovery);

    if (result.type !== 'success' || !result.params.code) {
      logger.warn('Dropbox auth cancelled or failed', result.type);
      return false;
    }

    // Exchange code for tokens
    const tokenResponse = await fetch(DROPBOX_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: result.params.code,
        grant_type: 'authorization_code',
        client_id: appKey,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      logger.error('Dropbox token exchange failed', await tokenResponse.text());
      return false;
    }

    const tokenData = await tokenResponse.json();
    await storeTokens(
      tokenData.access_token,
      tokenData.refresh_token,
      tokenData.expires_in,
    );

    logger.info('Dropbox authentication successful');
    return true;
  } catch (err) {
    logger.error('Dropbox authenticate error', err);
    return false;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const appKey = getAppKey();
  const refreshToken = await SecureStore.getItemAsync(DROPBOX_REFRESH_TOKEN_KEY);
  if (!refreshToken || !appKey) return null;

  try {
    const response = await fetch(DROPBOX_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: appKey,
      }).toString(),
    });

    if (!response.ok) {
      logger.warn('Dropbox token refresh failed — clearing tokens');
      await clearTokens();
      return null;
    }

    const data = await response.json();
    await storeTokens(data.access_token, undefined, data.expires_in);
    return data.access_token as string;
  } catch (err) {
    logger.error('Dropbox refreshAccessToken error', err);
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
  // Convert standard base64 to base64url
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── API helpers ──────────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getStoredAccessToken();
  if (!token) throw new Error('Not authenticated with Dropbox. Please connect your account in Settings.');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

// ── File operations ──────────────────────────────────────────────────────────

export interface DropboxEntry {
  '.tag': 'file' | 'folder';
  name: string;
  path_lower: string;
  path_display: string;
  size?: number;
  client_modified?: string;
}

export async function listFolder(path: string = DROPBOX_FOLDER): Promise<DropboxEntry[]> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${DROPBOX_API_BASE}/files/list_folder`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path, recursive: false }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Dropbox listFolder failed (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.entries as DropboxEntry[];
}

/**
 * Get a short-lived temporary download link for a Dropbox file.
 * Preferred for streaming large audio files without downloading first.
 */
export async function getTemporaryLink(dropboxPath: string): Promise<string> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${DROPBOX_API_BASE}/files/get_temporary_link`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: dropboxPath }),
  });

  if (!response.ok) {
    throw new Error(`Dropbox get_temporary_link failed (${response.status})`);
  }

  const data = await response.json();
  return data.link as string;
}

/**
 * Download a file from Dropbox directly to a local URI using expo-file-system.
 */
export async function downloadFile(
  dropboxPath: string,
  localUri: string,
): Promise<string> {
  const token = await getStoredAccessToken();
  if (!token) throw new Error('Not authenticated with Dropbox');

  const { File } = await import('expo-file-system');
  const destFile = new File(localUri);

  const downloaded = await File.downloadFileAsync(
    `${DROPBOX_CONTENT_API_BASE}/files/download`,
    destFile,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path: dropboxPath }),
      },
    } as Parameters<typeof File.downloadFileAsync>[2],
  );

  return downloaded.uri;
}

/**
 * List all book folders inside /Apps/Whisper/
 */
export async function listBooks(): Promise<DropboxEntry[]> {
  try {
    const entries = await listFolder(DROPBOX_FOLDER);
    return entries.filter((e) => e['.tag'] === 'folder');
  } catch (err) {
    logger.warn('Dropbox listBooks failed', err);
    return [];
  }
}

/**
 * List files inside a specific book folder.
 */
export async function listBookFiles(bookFolderPath: string): Promise<DropboxEntry[]> {
  const entries = await listFolder(bookFolderPath);
  return entries.filter((e) => e['.tag'] === 'file');
}
