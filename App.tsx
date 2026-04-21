import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
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

// Invisible worker component — registers the alignment hook inside the
// context tree (usePlaybackState requires being under a rendered tree) and
// drains the queue while the app is foreground or playing audio.
function AlignmentWorker() {
  useOpportunisticAlignment();
  return null;
}

export default function App() {
  useEffect(() => {
    installAlignmentPipeline();
  }, []);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <NowPlayingProvider>
          <AlignmentWorker />
          <NavigationContainer ref={navigationRef}>
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
