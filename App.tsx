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

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <NavigationContainer>
          <StatusBar style="auto" />
          <View style={styles.container}>
            <NetworkStatusBanner />
            <RootNavigator />
          </View>
        </NavigationContainer>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
