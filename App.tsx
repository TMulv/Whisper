import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Linking } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
// Initialize Firebase (offline persistence, settings)
import '@/services/firebase/firebaseConfig';
import RootNavigator from '@/navigation/RootNavigator';
import NetworkStatusBanner from '@/components/common/NetworkStatusBanner';
import ErrorBoundary from '@/components/common/ErrorBoundary';
import { NowPlayingProvider } from '@/context/NowPlayingContext';
import { navigationRef } from '@/navigation/navigationRef';
import { installAlignmentPipeline } from '@/services/sync/alignmentInit';
import { useOpportunisticAlignment } from '@/hooks/useOpportunisticAlignment';
import {
  setPendingImport,
  type PendingImportFile,
} from '@/services/pendingImportStore';

// ── Incoming-file classification ─────────────────────────────────────────────

const AUDIO_EXT_RE = /\.(m4b|m4a|mp3|aac|ogg|flac|opus|wav)$/i;
const EPUB_EXT_RE = /\.epub$/i;

function classifyFileUrl(url: string): PendingImportFile | null {
  if (!url.startsWith('file://')) return null;
  // Decode percent-encoding so we can inspect the raw extension
  const decoded = decodeURIComponent(url);
  const name = decoded.split('/').pop() ?? '';
  if (EPUB_EXT_RE.test(name)) return { uri: url, name, kind: 'epub' };
  if (AUDIO_EXT_RE.test(name)) return { uri: url, name, kind: 'audio' };
  return null;
}

/** Navigate into LibraryHome with the pending file as a route param.
 *  Falls back to storing in the module store when navigation isn't ready yet. */
function dispatchIncomingFile(file: PendingImportFile) {
  if (navigationRef.isReady()) {
    // Navigate to LibraryHome with the file attached as a param.
    // React Navigation delivers nested-navigator params via the screen/params shape.
    (navigationRef as React.RefObject<any>).current?.navigate('Main', {
      screen: 'Library',
      params: { screen: 'LibraryHome', params: { incomingFile: file } },
    });
  } else {
    // Navigation isn't ready yet (cold start). Store the file so the
    // onReady callback can deliver it once navigation initialises.
    setPendingImport(file);
  }
}

// Invisible worker component — registers the alignment hook inside the
// context tree (usePlaybackState requires being under a rendered tree) and
// drains the queue while the app is foreground or playing audio.
function AlignmentWorker() {
  useOpportunisticAlignment();
  return null;
}

export default function App() {
  const coldStartFile = useRef<PendingImportFile | null>(null);

  useEffect(() => {
    installAlignmentPipeline();

    // ── Incoming file handling ──────────────────────────────────────────
    // iOS delivers "Open With" / shared files via the Linking module.
    // Both the cold-start URL (getInitialURL) and warm-start events (addEventListener)
    // are handled here. If navigation is not yet ready we store the file and
    // deliver it in NavigationContainer.onReady below.

    Linking.getInitialURL().then((url) => {
      if (!url) return;
      const file = classifyFileUrl(url);
      if (!file) return;
      if (navigationRef.isReady()) {
        dispatchIncomingFile(file);
      } else {
        coldStartFile.current = file;
        setPendingImport(file);
      }
    });

    const sub = Linking.addEventListener('url', ({ url }) => {
      const file = classifyFileUrl(url);
      if (file) dispatchIncomingFile(file);
    });

    return () => sub.remove();
  }, []);

  const handleNavigationReady = () => {
    const file = coldStartFile.current;
    if (file) {
      coldStartFile.current = null;
      dispatchIncomingFile(file);
    }
  };

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <NowPlayingProvider>
          <AlignmentWorker />
          <NavigationContainer ref={navigationRef} onReady={handleNavigationReady}>
            <StatusBar style="auto" />
            <View style={styles.container}>
              <NetworkStatusBanner />
              <RootNavigator />
            </View>
          </NavigationContainer>
        </NowPlayingProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
