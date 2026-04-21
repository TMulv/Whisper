import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
} from 'react-native';
import { LocalBook } from '@/types/book';
import ProgressBar from './ProgressBar';
import { formatDuration } from '@/utils/timeUtils';
import { getBookDisplay } from '@/utils/bookDisplay';

interface Props {
  book: LocalBook;
  percentComplete?: number;
  onPress: () => void;
  onLongPress?: () => void;
}

export default function BookCard({ book, percentComplete = 0, onPress, onLongPress }: Props) {
  const display = getBookDisplay(book);
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
      activeOpacity={0.75}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    >
      {/* Cover */}
      <View style={styles.coverContainer}>
        {book.coverUri ? (
          <Image source={{ uri: book.coverUri }} style={styles.cover} resizeMode="cover" />
        ) : (
          <View style={styles.coverPlaceholder}>
            <Text style={styles.coverInitial}>{display.title[0]?.toUpperCase() ?? '?'}</Text>
          </View>
        )}
        {/* Download indicator */}
        {!book.isDownloaded && (
          <View style={styles.downloadBadge}>
            {book.downloadProgress > 0 && book.downloadProgress < 1 ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.downloadIcon}>☁</Text>
            )}
          </View>
        )}
      </View>

      {/* Metadata */}
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={2}>{display.title}</Text>
        <Text style={styles.author} numberOfLines={1}>{display.author}</Text>

        <View style={styles.footer}>
          <Text style={styles.duration}>
            {formatDuration(book.totalDurationSeconds)}
          </Text>
          <Text style={styles.chapters}>{book.totalChapters} ch</Text>
        </View>

        {percentComplete > 0 && (
          <View style={styles.progress}>
            <ProgressBar progress={percentComplete} height={3} />
            <Text style={styles.progressText}>{Math.round(percentComplete * 100)}%</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  coverContainer: {
    width: 64,
    height: 88,
    borderRadius: 6,
    overflow: 'hidden',
    marginRight: 14,
    position: 'relative',
  },
  cover: { width: '100%', height: '100%' },
  coverPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1A1A2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverInitial: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
  },
  downloadBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadIcon: { color: '#fff', fontSize: 10 },
  meta: { flex: 1, justifyContent: 'space-between' },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1A1A1A',
    lineHeight: 20,
  },
  author: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  duration: { fontSize: 12, color: '#888' },
  chapters: { fontSize: 12, color: '#888' },
  progress: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressText: { fontSize: 11, color: '#888', width: 32 },
});
