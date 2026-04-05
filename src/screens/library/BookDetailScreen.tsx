import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function BookDetailScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Book Detail</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
  },
});
