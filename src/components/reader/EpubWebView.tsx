import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
} from 'react';
import { StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import {
  JS_LOAD_BOOK,
  JS_LOAD_BOOK_BASE64,
  JS_GO_TO_CFI,
  JS_GO_TO_CHAPTER,
  JS_SET_FONT_SIZE,
  JS_SET_THEME,
  JS_HIGHLIGHT_PROGRESS,
  JS_CLEAR_HIGHLIGHT,
} from '@/constants/epubInjection';
import { EPUB_BRIDGE_HTML } from '@/constants/epubBridgeHtml';
import { EpubPosition } from '@/types/position';
import { logger } from '@/utils/logger';

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
  setTheme: (theme: EpubTheme) => void;
  highlightProgress: (ratio: number) => void;
  clearHighlight: () => void;
}

interface Props {
  onReady?: () => void;
  onPositionChange?: (position: EpubPosition) => void;
  onChapterList?: (chapters: EpubChapter[]) => void;
  onError?: (message: string) => void;
}

// ── Bridge message types ──────────────────────────────────────────────────────

type BridgeMessage =
  | { type: 'BRIDGE_LOADED'; v?: string }
  | { type: 'READY' }
  | { type: 'LOCATIONS_READY'; count: number }
  | { type: 'POSITION_CHANGE'; cfi: string; chapterIndex: number; charOffset: number; percentComplete: number }
  | { type: 'CHAPTER_LIST'; chapters: EpubChapter[] }
  | { type: 'ERROR'; message: string };

// ── Component ─────────────────────────────────────────────────────────────────

const EpubWebView = forwardRef<EpubWebViewRef, Props>(function EpubWebView(
  { onReady, onPositionChange, onChapterList, onError },
  ref,
) {
  const webViewRef = useRef<WebView>(null);
  const bridgeReadyRef = useRef(false);
  const pendingCommandsRef = useRef<string[]>([]);

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
    setTheme: (theme: EpubTheme) => inject(JS_SET_THEME(theme)),
    highlightProgress: (ratio: number) => inject(JS_HIGHLIGHT_PROGRESS(ratio)),
    clearHighlight: () => inject(JS_CLEAR_HIGHLIGHT),
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
          break;

        case 'POSITION_CHANGE':
          onPositionChange?.({
            chapterIndex: msg.chapterIndex,
            cfi: msg.cfi,
            charOffset: msg.charOffset,
            percentComplete: msg.percentComplete,
          });
          break;

        case 'CHAPTER_LIST':
          onChapterList?.(msg.chapters);
          break;

        case 'LOCATIONS_READY':
          logger.debug(`epub locations ready: ${msg.count}`);
          break;

        case 'ERROR':
          logger.error('EpubWebView bridge error:', msg.message);
          onError?.(msg.message);
          break;
      }
    },
    [onReady, onPositionChange, onChapterList, onError, flushPending],
  );

  return (
    <WebView
      ref={webViewRef}
      style={styles.webview}
      source={{ html: EPUB_BRIDGE_HTML, baseUrl: 'file:///' }}
      originWhitelist={['*']}
      allowFileAccess
      allowUniversalAccessFromFileURLs
      allowFileAccessFromFileURLs
      javaScriptEnabled
      domStorageEnabled
      mixedContentMode="always"
      onMessage={handleMessage}
      injectedJavaScript={`
        (function() {
          // Forward unhandled JS errors to React Native.
          // Ignore "Script error." (line 0) — these are cross-origin iframe errors
          // that epub.js triggers normally when rendering content; they are not fatal.
          window.onerror = function(msg, src, line) {
            if (!msg || msg === 'Script error.' || line === 0) return true;
            try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
              JSON.stringify({type:'ERROR', message:'JS: '+msg+' (line '+line+')'})
            ); } catch(e) {}
            return true;
          };
          // Replace the synchronous char-code loop with an async blob decode.
          // The original atob+loop blocks the UI thread for seconds on large EPUBs.
          window.whisper.loadBookFromBase64 = function(b64) {
            var self = this;
            fetch('data:application/epub+zip;base64,' + b64)
              .then(function(r) { return r.blob(); })
              .then(function(blob) {
                var url = URL.createObjectURL(blob);
                self.loadBook(url);
              })
              .catch(function(e) {
                try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
                  JSON.stringify({type:'ERROR', message:'decode failed: '+(e.message||e)})
                ); } catch(_) {}
              });
          };
        })();
        true;
      `}
      onError={(e) => {
        logger.error('WebView error', e.nativeEvent);
        onError?.(e.nativeEvent.description ?? 'WebView crashed');
      }}
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
