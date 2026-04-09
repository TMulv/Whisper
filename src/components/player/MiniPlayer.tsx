import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useNowPlaying } from '@/context/NowPlayingContext';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { navigateRoot } from '@/navigation/navigationRef';

export default function MiniPlayer() {
  const { book } = useNowPlaying();
  const { isPlaying, position, duration, play, pause } = useAudioPlayer();

  if (!book) return null;

  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;

  const handlePlayPause = () => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  return (
    <Pressable
      style={styles.container}
      onPress={() => navigateRoot('Player', { bookId: book.id })}
    >
      {/* Cover art */}
      {book.coverUri ? (
        <Image source={{ uri: book.coverUri }} style={styles.cover} />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]}>
          <Text style={styles.coverInitial}>{book.title[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}

      {/* Title + author */}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{book.title}</Text>
        <Text style={styles.author} numberOfLines={1}>{book.author}</Text>
      </View>

      {/* Play / pause */}
      <TouchableOpacity
        style={styles.playBtn}
        onPress={handlePlayPause}
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
      >
        <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
      </TouchableOpacity>

      {/* Progress strip */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` as any }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E0E0E0',
    gap: 10,
  },

  cover: {
    width: 42,
    height: 42,
    borderRadius: 6,
  },
  coverPlaceholder: {
    backgroundColor: '#1A1A2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverInitial: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },

  info: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  author: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },

  playBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    fontSize: 20,
    color: '#1A1A2E',
  },

  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#E8E8E8',
  },
  progressFill: {
    height: 2,
    backgroundColor: '#1A1A2E',
  },
});
