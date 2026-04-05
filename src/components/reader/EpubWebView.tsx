import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
  useEffect,
} from 'react';
import { StyleSheet, Platform } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import {
  JS_LOAD_BOOK,
  JS_GO_TO_CFI,
  JS_GO_TO_CHAPTER,
  JS_SET_FONT_SIZE,
  JS_SET_THEME,
} from '@/constants/epubInjection';
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
  goTo: (cfi: string) => void;
  goToChapter: (index: number) => void;
  setFontSize: (px: number) => void;
  setTheme: (theme: EpubTheme) => void;
}

interface Props {
  onReady?: () => void;
  onPositionChange?: (position: EpubPosition) => void;
  onChapterList?: (chapters: EpubChapter[]) => void;
  onError?: (message: string) => void;
}

// ── Bridge message types ──────────────────────────────────────────────────────

type BridgeMessage =
  | { type: 'BRIDGE_LOADED' }
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

  // Resolve the bundled html asset URI once on mount
  const [bridgeUri, setBridgeUri] = React.useState<string | null>(null);

  useEffect(() => {
    Asset.fromModule(require('../../../assets/epub-bridge/epub-bridge.html'))
      .downloadAsync()
      .then((asset: { localUri: string | null; uri: string }) => {
        setBridgeUri(asset.localUri ?? asset.uri);
      })
      .catch((err: unknown) => {
        logger.error('Failed to load epub-bridge asset', err);
        onError?.('Failed to load reader.');
      });
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
      // We pass the URI directly; the bridge receives it and calls ePub(url)
      inject(JS_LOAD_BOOK(localUri));
    },
    goTo: (cfi: string) => inject(JS_GO_TO_CFI(cfi)),
    goToChapter: (index: number) => inject(JS_GO_TO_CHAPTER(index)),
    setFontSize: (px: number) => inject(JS_SET_FONT_SIZE(px)),
    setTheme: (theme: EpubTheme) => inject(JS_SET_THEME(theme)),
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
          bridgeReadyRef.current = true;
          flushPending();
          break;

        case 'READY':
          onReady?.();
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
      // Allow loading local epub files by URL
      mixedContentMode="always"
      onMessage={handleMessage}
      onError={(e) => {
        logger.error('WebView error', e.nativeEvent);
        onError?.(e.nativeEvent.description ?? 'WebView crashed');
      }}
      // Disable bounce on iOS (epub paginates internally)
      scrollEnabled={false}
      bounces={false}
      // Performance
      renderToHardwareTextureAndroid
    />
  );
});

export default EpubWebView;

const styles = StyleSheet.create({
  webview: { flex: 1, backgroundColor: 'transparent' },
});
