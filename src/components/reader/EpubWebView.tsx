import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
  useEffect,
  useState,
} from 'react';
import { StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { File, Directory, Paths } from 'expo-file-system';
import {
  JS_LOAD_BOOK,
  JS_LOAD_BOOK_BASE64,
  JS_GO_TO_CFI,
  JS_GO_TO_CHAPTER,
  JS_SET_FONT_SIZE,
  JS_SET_THEME,
  JS_SET_FONT_FAMILY,
  JS_SET_MARGIN,
  JS_SET_LINE_HEIGHT,
  JS_SEARCH,
} from '@/constants/epubInjection';
import { EPUB_BRIDGE_HTML } from '@/constants/epubBridgeHtml';
import { EpubPosition } from '@/types/position';
import { Highlight } from '@/types/highlight';
import { logger } from '@/utils/logger';
import type { SearchResult } from '@/components/reader/EpubSearchDrawer';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EpubTheme = 'light' | 'dark' | 'sepia' | 'eink';

export interface EpubChapter {
  index: number;
  title: string;
  href: string;
}

export interface EpubWebViewRef {
  loadBook: (localUri: string) => void;
  loadBookBase64: (base64: string) => void;
  loadBookFromUri: (fileUri: string) => void;
  goTo: (cfi: string) => void;
  goToChapter: (index: number) => void;
  setFontSize: (px: number) => void;
  setLineHeight: (value: number) => void;
  setTheme: (theme: EpubTheme) => void;
  setFontFamily: (family: string) => void;
  setMargin: (margin: string) => void;
  getCurrentPosition: (timeoutMs?: number) => Promise<EpubPosition>;
  getChapterText: (index: number, timeoutMs?: number) => Promise<string>;
  getVisibleSnippet: (wordCount?: number, timeoutMs?: number) => Promise<string[]>;
  addHighlight: (id: string, cfiRange: string, color: string) => void;
  removeHighlight: (id: string) => void;
  loadHighlights: (highlights: Pick<Highlight, 'id' | 'cfiRange' | 'color'>[]) => void;
  search: (query: string, requestId: string) => void;
}

interface Props {
  onReady?: () => void;
  onBookReady?: () => void;
  onPositionChange?: (position: EpubPosition, programmatic: boolean) => void;
  onLocationsReady?: (totalLocations: number) => void;
  onChapterList?: (chapters: EpubChapter[]) => void;
  onWordLookup?: (word: string) => void;
  onParagraphTap?: (percentComplete: number, chapterIndex: number) => void;
  onTextSelected?: (cfiRange: string, text: string, chapterIndex: number) => void;
  onError?: (message: string) => void;
  onSearchResults?: (requestId: string, results: SearchResult[], done: boolean) => void;
  onSearchError?: (requestId: string, error: string) => void;
}

// ── Bridge message types ──────────────────────────────────────────────────────

type BridgeMessage =
  | { type: 'BRIDGE_LOADED'; v?: string }
  | { type: 'READY' }
  | { type: 'LOCATIONS_READY'; count: number; cfi: string; chapterIndex: number; charOffset: number; chapterFraction: number; percentComplete: number }
  | { type: 'POSITION_CHANGE'; cfi: string; chapterIndex: number; charOffset: number; chapterFraction: number; percentComplete: number; programmatic?: boolean }
  | { type: 'POSITION_RESULT'; requestId: string; ok: boolean; cfi?: string; chapterIndex?: number; charOffset?: number; chapterFraction?: number; percentComplete?: number; error?: string }
  | { type: 'CHAPTER_LIST'; chapters: EpubChapter[] }
  | { type: 'WORD_LOOKUP'; word: string }
  | { type: 'PARAGRAPH_TAP'; percentComplete: number; chapterIndex: number }
  | { type: 'TEXT_SELECTED'; cfiRange: string; text: string; chapterIndex: number }
  | { type: 'CHAPTER_TEXT'; requestId: string; ok: boolean; text?: string; title?: string; chapterIndex?: number; error?: string }
  | { type: 'SNIPPET_RESULT'; requestId: string; ok: boolean; words?: string[]; error?: string }
  | { type: 'SEARCH_RESULTS'; requestId: string; results: SearchResult[]; done: boolean }
  | { type: 'SEARCH_ERROR'; requestId: string; error: string }
  | { type: 'ERROR'; message: string };

// ── Component ─────────────────────────────────────────────────────────────────

const EpubWebView = forwardRef<EpubWebViewRef, Props>(function EpubWebView(
  { onReady, onBookReady, onPositionChange, onLocationsReady, onChapterList, onWordLookup, onParagraphTap, onTextSelected, onError, onSearchResults, onSearchError },
  ref,
) {
  const webViewRef = useRef<WebView>(null);
  const bridgeReadyRef = useRef(false);
  const pendingCommandsRef = useRef<string[]>([]);
  const pendingTextRequestsRef = useRef<
    Map<string, { resolve: (text: string) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>
  >(new Map());
  const pendingPositionRequestsRef = useRef<
    Map<string, { resolve: (pos: EpubPosition) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>
  >(new Map());
  const pendingSnippetRequestsRef = useRef<
    Map<string, { resolve: (words: string[]) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>
  >(new Map());

  // Resolve the bundled html asset URI once on mount. Loading via file URI
  // avoids passing 300+ KB of HTML through the React Native bridge, which on
  // Android was truncating the body and leaving JSZip/ePub/whisper undefined.
  const [bridgeUri, setBridgeUri] = useState<string | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Write the inline HTML string to a file: URI the WebView can load.
        // We can't use source.html (Android truncates ~300 KB bodies to ~3 KB)
        // and we can't use expo-asset.downloadAsync on a 330 KB HTML in dev
        // (Metro's asset server rejects the fetch). Writing to document dir
        // sidesteps both.
        const readerDir = new Directory(Paths.document, 'reader');
        if (!readerDir.exists) readerDir.create({ intermediates: true });
        const target = new File(readerDir, 'epub-bridge.html');
        if (target.exists) target.delete();
        target.create();
        target.write(EPUB_BRIDGE_HTML);
        if (cancelled) return;
        const finalUri = target.uri;
        logger.info('EpubWebView: bridge written', {
          finalUri,
          size: EPUB_BRIDGE_HTML.length,
        });
        setBridgeUri(finalUri);
      } catch (err) {
        logger.error('Failed to stage epub-bridge asset', err);
        onErrorRef.current?.('Failed to load reader.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Inject JS helper ──────────────────────────────────────────────────────
  const inject = useCallback((js: string) => {
    if (!bridgeReadyRef.current) {
      pendingCommandsRef.current.push(js);
      return;
    }
    webViewRef.current?.injectJavaScript(js);
  }, []);

  // Flush any commands queued before bridge was ready
  const flushPending = useCallback(() => {
    const cmds = pendingCommandsRef.current.splice(0);
    cmds.forEach((cmd) => webViewRef.current?.injectJavaScript(cmd));
  }, []);

  // ── Imperative API ────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    loadBook: (localUri: string) => {
      inject(JS_LOAD_BOOK(localUri));
    },
    loadBookBase64: (base64: string) => {
      // Android's evaluateJavascript() silently drops strings larger than ~1 MB.
      // Split into 200 KB chunks, reassemble in the WebView, then load.
      const CHUNK = 200_000;
      const total = Math.ceil(base64.length / CHUNK);
      inject('window._ebp=[]; true;');
      for (let i = 0; i < total; i++) {
        const slice = base64.slice(i * CHUNK, (i + 1) * CHUNK);
        inject('window._ebp.push(' + JSON.stringify(slice) + '); true;');
      }
      inject('window.whisper.loadBookFromBase64(window._ebp.join("")); window._ebp=null; true;');
    },
    loadBookFromUri: (fileUri: string) => {
      // Preferred path for large EPUBs: the WebView fetches the file directly
      // via its own file:// access instead of us shuttling 31 MB across the RN
      // bridge. Requires allowFileAccess(FromFileURLs) on the WebView.
      inject(`window.whisper.loadBookFromUri(${JSON.stringify(fileUri)}); true;`);
    },
    goTo: (cfi: string) => inject(JS_GO_TO_CFI(cfi)),
    goToChapter: (index: number) => inject(JS_GO_TO_CHAPTER(index)),
    setFontSize: (px: number) => inject(JS_SET_FONT_SIZE(px)),
    setLineHeight: (value: number) => inject(JS_SET_LINE_HEIGHT(value)),
    setTheme: (theme: EpubTheme) => inject(JS_SET_THEME(theme)),
    setFontFamily: (family: string) => inject(JS_SET_FONT_FAMILY(family)),
    setMargin: (margin: string) => inject(JS_SET_MARGIN(margin)),
    getCurrentPosition: (timeoutMs = 3000) => {
      const requestId = `pos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return new Promise<EpubPosition>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingPositionRequestsRef.current.delete(requestId);
          reject(new Error('Timed out getting current position'));
        }, timeoutMs);
        pendingPositionRequestsRef.current.set(requestId, { resolve, reject, timer });
        inject(`window.whisper.getCurrentPosition(${JSON.stringify(requestId)}); true;`);
      });
    },
    getChapterText: (index: number, timeoutMs = 15000) => {
      const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingTextRequestsRef.current.delete(requestId);
          reject(new Error('Timed out extracting chapter text'));
        }, timeoutMs);
        pendingTextRequestsRef.current.set(requestId, { resolve, reject, timer });
        inject(
          `window.whisper.getChapterText(${index}, ${JSON.stringify(requestId)}); true;`,
        );
      });
    },
    getVisibleSnippet: (wordCount = 8, timeoutMs = 3000) => {
      const requestId = `snip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return new Promise<string[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingSnippetRequestsRef.current.delete(requestId);
          reject(new Error('Timed out extracting visible snippet'));
        }, timeoutMs);
        pendingSnippetRequestsRef.current.set(requestId, { resolve, reject, timer });
        inject(
          `window.whisper.getVisibleSnippet(${JSON.stringify(requestId)}, ${wordCount}); true;`,
        );
      });
    },
    addHighlight: (id: string, cfiRange: string, color: string) => {
      inject(`window.whisper.addHighlight(${JSON.stringify(id)},${JSON.stringify(cfiRange)},${JSON.stringify(color)}); true;`);
    },
    removeHighlight: (id: string) => {
      inject(`window.whisper.removeHighlight(${JSON.stringify(id)}); true;`);
    },
    loadHighlights: (highlights: Pick<Highlight, 'id' | 'cfiRange' | 'color'>[]) => {
      inject(`window.whisper.loadHighlights(${JSON.stringify(highlights)}); true;`);
    },
    search: (query: string, requestId: string) => {
      webViewRef.current?.injectJavaScript(JS_SEARCH(query, requestId));
    },
  }));

  // ── Message handler ───────────────────────────────────────────────────────
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: BridgeMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        logger.warn('EpubWebView: non-JSON message', event.nativeEvent.data);
        return;
      }

      switch (msg.type) {
        case 'BRIDGE_LOADED':
          logger.info('EpubWebView: BRIDGE_LOADED', { v: msg.v ?? 'none' });
          bridgeReadyRef.current = true;
          flushPending();
          onReady?.();
          break;

        case 'READY':
          logger.info('EpubWebView: READY (book rendered)');
          onBookReady?.();
          break;

        case 'POSITION_CHANGE':
          logger.debug('EpubWebView: POSITION_CHANGE', {
            cfi: msg.cfi,
            chapterIndex: msg.chapterIndex,
            percentComplete: msg.percentComplete,
            chapterFraction: msg.chapterFraction,
            programmatic: msg.programmatic,
          });
          onPositionChange?.(
            {
              chapterIndex: msg.chapterIndex,
              cfi: msg.cfi,
              charOffset: msg.charOffset,
              chapterFraction: msg.chapterFraction,
              percentComplete: msg.percentComplete,
            },
            msg.programmatic ?? false,
          );
          break;

        case 'CHAPTER_LIST':
          logger.info('EpubWebView: CHAPTER_LIST', { count: msg.chapters?.length ?? 0 });
          onChapterList?.(msg.chapters);
          break;

        case 'WORD_LOOKUP':
          onWordLookup?.(msg.word);
          break;

        case 'PARAGRAPH_TAP':
          onParagraphTap?.(msg.percentComplete, msg.chapterIndex);
          break;

        case 'TEXT_SELECTED':
          onTextSelected?.(msg.cfiRange, msg.text, msg.chapterIndex);
          break;

        case 'POSITION_RESULT': {
          const pending = pendingPositionRequestsRef.current.get(msg.requestId);
          if (!pending) break;
          pendingPositionRequestsRef.current.delete(msg.requestId);
          clearTimeout(pending.timer);
          if (msg.ok) {
            pending.resolve({
              chapterIndex: msg.chapterIndex ?? 0,
              cfi: msg.cfi ?? '',
              charOffset: msg.charOffset ?? 0,
              chapterFraction: msg.chapterFraction ?? -1,
              percentComplete: msg.percentComplete ?? 0,
            });
          } else {
            pending.reject(new Error(msg.error ?? 'Failed to get current position'));
          }
          break;
        }

        case 'CHAPTER_TEXT': {
          const pending = pendingTextRequestsRef.current.get(msg.requestId);
          if (!pending) break;
          pendingTextRequestsRef.current.delete(msg.requestId);
          clearTimeout(pending.timer);
          if (msg.ok && typeof msg.text === 'string') {
            pending.resolve(msg.text);
          } else {
            pending.reject(new Error(msg.error ?? 'Failed to extract chapter text'));
          }
          break;
        }

        case 'SNIPPET_RESULT': {
          const pending = pendingSnippetRequestsRef.current.get(msg.requestId);
          if (!pending) break;
          pendingSnippetRequestsRef.current.delete(msg.requestId);
          clearTimeout(pending.timer);
          if (msg.ok && Array.isArray(msg.words)) {
            pending.resolve(msg.words);
          } else {
            pending.reject(new Error(msg.error ?? 'Failed to get visible snippet'));
          }
          break;
        }

        case 'LOCATIONS_READY':
          logger.info('EpubWebView: LOCATIONS_READY', {
            count: msg.count,
            hasCfi: !!msg.cfi,
            cfi: msg.cfi || '(empty)',
            chapterIndex: msg.chapterIndex,
            percentComplete: msg.percentComplete,
            chapterFraction: msg.chapterFraction,
          });
          // Update position with now-accurate percentComplete before signalling
          // ready, so both state changes land in the same React render batch.
          if (msg.cfi) {
            onPositionChange?.(
              {
                chapterIndex: msg.chapterIndex,
                cfi: msg.cfi,
                charOffset: msg.charOffset,
                chapterFraction: msg.chapterFraction,
                percentComplete: msg.percentComplete,
              },
              true,
            );
          } else {
            logger.warn('EpubWebView: LOCATIONS_READY had empty CFI — livePosition percentComplete will NOT be updated');
          }
          onLocationsReady?.(msg.count);
          break;

        case 'SEARCH_RESULTS':
          onSearchResults?.(msg.requestId, msg.results, msg.done);
          break;

        case 'SEARCH_ERROR':
          onSearchError?.(msg.requestId, msg.error);
          break;

        case 'ERROR':
          logger.error('EpubWebView bridge error:', msg.message);
          onError?.(msg.message);
          break;
      }
    },
    [onReady, onBookReady, onPositionChange, onLocationsReady, onChapterList, onWordLookup, onParagraphTap, onTextSelected, onError, onSearchResults, onSearchError, flushPending],
  );

  if (!bridgeUri) return null;

  return (
    <WebView
      ref={webViewRef}
      style={styles.webview}
      source={{ uri: bridgeUri }}
      originWhitelist={['*']}
      allowFileAccess
      allowUniversalAccessFromFileURLs
      allowFileAccessFromFileURLs
      javaScriptEnabled
      domStorageEnabled
      mixedContentMode="always"
      onMessage={handleMessage}
      onError={(e) => {
        logger.error('WebView error', e.nativeEvent);
        onError?.(e.nativeEvent.description ?? 'WebView crashed');
      }}
      onLoadStart={() => logger.info('EpubWebView: onLoadStart')}
      onLoadEnd={() => logger.info('EpubWebView: onLoadEnd')}
      onHttpError={(e) => logger.error('EpubWebView onHttpError', e.nativeEvent)}
      onRenderProcessGone={(e) => logger.error('EpubWebView onRenderProcessGone', e.nativeEvent)}
      scrollEnabled={false}
      bounces={false}
      renderToHardwareTextureAndroid
    />
  );
});

export default EpubWebView;

const styles = StyleSheet.create({
  webview: { flex: 1, backgroundColor: 'transparent' },
});
