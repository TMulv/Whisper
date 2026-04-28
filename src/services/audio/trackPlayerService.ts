import TrackPlayer, {
  Capability,
  Event,
  RepeatMode,
  Track,
} from 'react-native-track-player';
import { LocalBook } from '@/types/book';
import { M4BChapter } from '@/types/sync';
import { logger } from '@/utils/logger';
import { getBookDisplay } from '@/utils/bookDisplay';

// Module-level flag so we don't re-call TrackPlayer.setupPlayer() — it
// throws "already initialized" on the second call. Multiple call sites
// invoke this (NowPlayingContext on first play, audioProbe at import +
// self-heal) so it must be idempotent.
let _setupDone = false;

export async function setupPlayer(): Promise<boolean> {
  if (_setupDone) return true;
  try {
    try {
      await TrackPlayer.setupPlayer({
        maxCacheSize: 1024 * 5, // 5 MB
      });
    } catch (err) {
      // "The player has already been initialized via setupPlayer." is
      // benign — another caller beat us to it. Continue with options.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes('already been initialized')) {
        throw err;
      }
    }

    await TrackPlayer.updateOptions({
      capabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.Stop,
        Capability.SeekTo,
        Capability.SkipToNext,
        Capability.SkipToPrevious,
        Capability.JumpForward,
        Capability.JumpBackward,
      ],
      compactCapabilities: [
        Capability.Play,
        Capability.Pause,
        Capability.SkipToNext,
      ],
      forwardJumpInterval: 30,
      backwardJumpInterval: 30,
      progressUpdateEventInterval: 1,
    });

    await TrackPlayer.setRepeatMode(RepeatMode.Off);
    _setupDone = true;
    return true;
  } catch (err) {
    logger.error('setupPlayer failed', err);
    return false;
  }
}

export async function loadBook(
  book: LocalBook,
  chapters: M4BChapter[],
  startTimestamp: number = 0,
): Promise<void> {
  await TrackPlayer.reset();

  if (!book.localAudioUri) {
    throw new Error('No local audio URI available for book');
  }

  const display = getBookDisplay(book);
  const track: Track = {
    id: book.id,
    url: book.localAudioUri,
    title: display.title,
    artist: display.author,
    artwork: book.coverUri ?? undefined,
    duration: book.totalDurationSeconds,
  };

  await TrackPlayer.add(track);

  if (startTimestamp > 0) {
    await TrackPlayer.seekTo(startTimestamp);
  }
}

export async function seekToTimestamp(seconds: number): Promise<void> {
  await TrackPlayer.seekTo(seconds);
}

export async function seekToChapter(chapter: M4BChapter): Promise<void> {
  await TrackPlayer.seekTo(chapter.startSeconds);
}

export async function play(): Promise<void> {
  try {
    await TrackPlayer.play();
  } catch (err) {
    logger.error('TrackPlayer.play() failed', err);
    throw err;
  }
}

export async function pause(): Promise<void> {
  await TrackPlayer.pause();
}

export async function skipForward(seconds: number = 30): Promise<void> {
  const position = await TrackPlayer.getPosition();
  await TrackPlayer.seekTo(position + seconds);
}

export async function skipBackward(seconds: number = 30): Promise<void> {
  const position = await TrackPlayer.getPosition();
  await TrackPlayer.seekTo(Math.max(0, position - seconds));
}

export async function setRate(rate: number): Promise<void> {
  await TrackPlayer.setRate(rate);
}
