import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';

interface Props {
  message?: string;
}

export default function LoadingOverlay({ message }: Props) {
  return (
    <View style={styles.overlay}>
      <ActivityIndicator size="large" color="#1A1A2E" />
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  message: {
    marginTop: 16,
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
});
