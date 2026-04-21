// Drop-in overlay for book cover art: renders a SyncBadge that opens the
// SyncStatusSheet on tap. Stateless above the hook — library cards and detail
// screens can mount it without owning any sync wiring themselves.
//
// Intentionally positioned `absolute` inside its parent. Parents should wrap
// the cover in a `<View style={{ position: 'relative' }}>` and drop this in.

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useBookSyncStatus } from '@/hooks/useBookSyncStatus';
import SyncBadge from './SyncBadge';
import SyncStatusSheet from './SyncStatusSheet';

interface Props {
  userId: string | null;
  bookId: string | null;
  /** Hide once sync is complete (default true). */
  autoHideOnComplete?: boolean;
  /** Override the top/right inset on the badge anchor. */
  offset?: { top?: number; right?: number };
  size?: number;
}

export default function BookSyncIndicator({
  userId,
  bookId,
  autoHideOnComplete = true,
  offset,
  size = 28,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const { alignment, progress, processing, remoteStatus } = useBookSyncStatus(
    userId,
    bookId,
  );

  if (!alignment) return null;
  if (autoHideOnComplete && alignment.status === 'complete') return null;

  return (
    <>
      <View
        style={[
          styles.anchor,
          { top: offset?.top ?? 6, right: offset?.right ?? 6 },
        ]}
        pointerEvents="box-none"
      >
        <SyncBadge
          status={alignment.status}
          progress={progress}
          onPress={() => setSheetOpen(true)}
          size={size}
        />
      </View>
      <SyncStatusSheet
        visible={sheetOpen}
        alignment={alignment}
        remoteProcessing={
          processing || remoteStatus?.status === 'processing'
        }
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
  },
});
