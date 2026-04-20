import * as SecureStore from 'expo-secure-store';
import { logger } from '@/utils/logger';

// ── Secure store keys ────────────────────────────────────────────────────────

const NC_SERVER_KEY = 'nextcloud_server_url';
const NC_USERNAME_KEY = 'nextcloud_username';
const NC_PASSWORD_KEY = 'nextcloud_app_password';

export const NEXTCLOUD_BOOKS_FOLDER = 'Books';

// ── Types ────────────────────────────────────────────────────────────────────

export interface NextcloudEntry {
  type: 'file' | 'folder';
  name: string;
  /** Full WebDAV path, e.g. /remote.php/dav/files/user/Books/MyBook/ */
  path: string;
  size?: number;
  lastModified?: string;
}

// ── Credentials ──────────────────────────────────────────────────────────────

export async function saveCredentials(
  serverUrl: string,
  username: string,
  appPassword: string,
): Promise<void> {
  const normalizedUrl = serverUrl.replace(/\/$/, '');
  await SecureStore.setItemAsync(NC_SERVER_KEY, normalizedUrl);
  await SecureStore.setItemAsync(NC_USERNAME_KEY, username);
  await SecureStore.setItemAsync(NC_PASSWORD_KEY, appPassword);
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(NC_SERVER_KEY);
  await SecureStore.deleteItemAsync(NC_USERNAME_KEY);
  await SecureStore.deleteItemAsync(NC_PASSWORD_KEY);
}

export async function isAuthenticated(): Promise<boolean> {
  const server = await SecureStore.getItemAsync(NC_SERVER_KEY);
  const user = await SecureStore.getItemAsync(NC_USERNAME_KEY);
  const pass = await SecureStore.getItemAsync(NC_PASSWORD_KEY);
  return !!(server && user && pass);
}

export async function getCredentials(): Promise<{
  serverUrl: string;
  username: string;
  appPassword: string;
} | null> {
  const serverUrl = await SecureStore.getItemAsync(NC_SERVER_KEY);
  const username = await SecureStore.getItemAsync(NC_USERNAME_KEY);
  const appPassword = await SecureStore.getItemAsync(NC_PASSWORD_KEY);
  if (!serverUrl || !username || !appPassword) return null;
  return { serverUrl, username, appPassword };
}

// ── Auth helpers ─────────────────────────────────────────────────────────────

function basicAuthHeader(username: string, password: string): string {
  return 'Basic ' + btoa(`${username}:${password}`);
}

function webdavUrl(serverUrl: string, username: string, path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${serverUrl}/remote.php/dav/files/${encodeURIComponent(username)}${cleanPath}`;
}

// ── WebDAV XML parser ────────────────────────────────────────────────────────

function parseWebDAVResponse(xml: string, skipHref: string): NextcloudEntry[] {
  const entries: NextcloudEntry[] = [];
  const responseRegex = /<d:response>([\s\S]*?)<\/d:response>/gi;
  let match: RegExpExecArray | null;

  while ((match = responseRegex.exec(xml)) !== null) {
    const block = match[1];

    const hrefMatch = block.match(/<d:href>([\s\S]*?)<\/d:href>/i);
    if (!hrefMatch) continue;

    const href = decodeURIComponent(hrefMatch[1].trim());
    const normalizedHref = href.replace(/\/$/, '');
    const normalizedSkip = skipHref.replace(/\/$/, '');
    if (normalizedHref === normalizedSkip) continue;

    const isCollection = /<d:collection\s*\/>/i.test(block);
    const sizeMatch = block.match(/<d:getcontentlength>([\s\S]*?)<\/d:getcontentlength>/i);
    const modifiedMatch = block.match(/<d:getlastmodified>([\s\S]*?)<\/d:getlastmodified>/i);

    const parts = href.replace(/\/$/, '').split('/');
    const name = parts[parts.length - 1];

    entries.push({
      type: isCollection ? 'folder' : 'file',
      name,
      path: href,
      size: sizeMatch ? parseInt(sizeMatch[1], 10) : undefined,
      lastModified: modifiedMatch ? modifiedMatch[1].trim() : undefined,
    });
  }

  return entries;
}

// ── Connection test ──────────────────────────────────────────────────────────

export async function testConnection(
  serverUrl: string,
  username: string,
  appPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const normalizedUrl = serverUrl.replace(/\/$/, '');
  const url = `${normalizedUrl}/remote.php/dav/files/${encodeURIComponent(username)}/`;

  try {
    const response = await fetch(url, {
      method: 'PROPFIND',
      headers: {
        Authorization: basicAuthHeader(username, appPassword),
        Depth: '0',
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>`,
    });

    if (response.ok || response.status === 207) return { ok: true };
    if (response.status === 401) return { ok: false, error: 'Invalid username or app password.' };
    if (response.status === 404) return { ok: false, error: 'Server URL not found. Check the address.' };
    return { ok: false, error: `Server returned ${response.status}.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not reach server: ${msg}` };
  }
}

// ── File operations ──────────────────────────────────────────────────────────

export async function listFolder(folderPath: string = NEXTCLOUD_BOOKS_FOLDER): Promise<NextcloudEntry[]> {
  const creds = await getCredentials();
  if (!creds) throw new Error('Not connected to Nextcloud. Add your server in Settings.');

  const { serverUrl, username, appPassword } = creds;
  const url = webdavUrl(serverUrl, username, folderPath);
  const skipHref = `/remote.php/dav/files/${encodeURIComponent(username)}/${folderPath.replace(/^\//, '').replace(/\/$/, '')}`;

  const response = await fetch(url, {
    method: 'PROPFIND',
    headers: {
      Authorization: basicAuthHeader(username, appPassword),
      Depth: '1',
      'Content-Type': 'application/xml',
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getlastmodified/>
    <d:displayname/>
  </d:prop>
</d:propfind>`,
  });

  if (!response.ok && response.status !== 207) {
    if (response.status === 404) {
      throw new Error(`Folder "${folderPath}" not found on Nextcloud.`);
    }
    throw new Error(`Nextcloud PROPFIND failed (${response.status})`);
  }

  const xml = await response.text();
  return parseWebDAVResponse(xml, skipHref);
}

export async function listBooks(): Promise<NextcloudEntry[]> {
  try {
    const entries = await listFolder(NEXTCLOUD_BOOKS_FOLDER);
    return entries.filter((e) => e.type === 'folder');
  } catch (err) {
    logger.warn('Nextcloud listBooks failed', err);
    return [];
  }
}

export async function listBookFiles(folderPath: string): Promise<NextcloudEntry[]> {
  const entries = await listFolder(folderPath);
  return entries.filter((e) => e.type === 'file');
}

/**
 * Download a file from Nextcloud to a local URI.
 * `remotePath` is either a full WebDAV path (/remote.php/dav/...) or a relative path.
 */
export async function downloadFile(remotePath: string, localUri: string): Promise<string> {
  const creds = await getCredentials();
  if (!creds) throw new Error('Not connected to Nextcloud');

  const { serverUrl, username, appPassword } = creds;
  const downloadUrl = remotePath.startsWith('http')
    ? remotePath
    : `${serverUrl}${remotePath}`;

  const { File } = await import('expo-file-system');
  const destFile = new File(localUri);

  const downloaded = await File.downloadFileAsync(downloadUrl, destFile, {
    headers: { Authorization: basicAuthHeader(username, appPassword) },
  } as Parameters<typeof File.downloadFileAsync>[2]);

  return downloaded.uri;
}
