export const SYNC_DEBOUNCE_MS = 3000;
export const POSITION_WRITE_DEBOUNCE_MS = 2000;
export const AUDIO_POSITION_THROTTLE_MS = 1000;

// If remote position is this many ms newer, auto-apply without prompt
export const AUTO_SYNC_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export const CACHE_DIR = 'whisper/';
export const MAX_CACHE_SIZE_MB = 2048;

export const OFFLINE_QUEUE_KEY = '@whisper/offline_queue';
export const BOOKS_CACHE_KEY = '@whisper/books_cache';
export const POSITIONS_CACHE_KEY = '@whisper/positions_cache';
export const THEME_PREF_KEY = '@whisper/theme_pref';
export const FONT_SIZE_KEY = '@whisper/font_size';
export const DEVICE_ID_KEY = '@whisper/device_id';

export const DROPBOX_API_BASE = 'https://api.dropboxapi.com/2';
export const DROPBOX_CONTENT_API_BASE = 'https://content.dropboxapi.com/2';
export const DROPBOX_FOLDER = '/Apps/Whisper';
