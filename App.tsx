import React, { useEffect } from 'react';
import { View, StyleSheet, Linking } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  CormorantGaramond_400Regular,
  CormorantGaramond_400Regular_Italic,
  CormorantGaramond_600SemiBold,
} from '@expo-google-fonts/cormorant-garamond';
import { Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { Cinzel_400Regular, Cinzel_600SemiBold } from '@expo-google-fonts/cinzel';
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

// Invisible worker component — registers the alignment hook inside the
// context tree (usePlaybackState requires being under a rendered tree) and
// drains the queue while the app is foreground or playing audio.
function AlignmentWorker() {
  useOpportunisticAlignment();
  return null;
}

export default function App() {
  useFonts({
    CormorantGaramond_400Regular,
    CormorantGaramond_400Regular_Italic,
    CormorantGaramond_600SemiBold,
    Inter_500Medium,
    Inter_600SemiBold,
    Cinzel_400Regular,
    Cinzel_600SemiBold,
  });

  useEffect(() => {
    installAlignmentPipeline();

    // ── Incoming file handling ──────────────────────────────────────────
    // iOS delivers "Open With" / shared files via the Linking module. Both
    // cold-start (getInitialURL) and warm-start (addEventListener) paths
    // funnel into pendingImportStore, which LibraryScreen subscribes to.
    // Using a single sink avoids the double-dispatch race we hit before,
    // where a route-param path and a store-polling path ran concurrently
    // and each produced a different bookId for the same file.

    Linking.getInitialURL().then((url) => {
      if (!url) return;
      const file = classifyFileUrl(url);
      if (file) setPendingImport(file);
    });

    const sub = Linking.addEventListener('url', ({ url }) => {
      const file = classifyFileUrl(url);
      if (file) setPendingImport(file);
    });

    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <NowPlayingProvider>
          <AlignmentWorker />
          <NavigationContainer ref={navigationRef}>
            <StatusBar style="auto" />
            <View style={styles.container}>
              {/* <NetworkStatusBanner /> */}
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
