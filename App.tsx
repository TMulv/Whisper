import React from 'react';
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

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <NowPlayingProvider>
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
