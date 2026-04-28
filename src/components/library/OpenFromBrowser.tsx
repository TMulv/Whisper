import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
  Pressable,
  ActivityIndicator,
  LayoutChangeEvent,
  Alert,
} from 'react-native';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  getRecentPicks,
  listCachedFiles,
  classifyName,
  clearRecentPicks,
  type RecentPick,
  type CachedFile,
  type PickKind,
} from '@/services/storage/recentPicksService';

dayjs.extend(relativeTime);

// ── Palette ───────────────────────────────────────────────────────────────────
// Antiquarian library — deep ink, aged parchment, brass foil.
const C = {
  ink: '#09090F',
  vellum: '#0F0F1A',
  chamber: '#14141F',
  rail: '#1C1C2E',
  rule: '#26263A',
  brass: '#C9A96E',
  brassDim: '#6A5832',
  brassSoft: '#8A7545',
  parchment: '#F0E6D4',
  quill: '#B5A58A',
  muted: '#7A6E62',
  faint: '#3A3530',
  success: '#7AB097',
  ember: '#D47B5F',
};

export interface Selection {
  uri: string;
  name: string;
}

interface BookBrief {
  id: string;
  title: string;
  epubPath: string;
  audioPath: string;
  addedAt: number;
  updatedAt: number;
}

type TabKey = 'recents' | 'downloads' | 'documents' | 'cloud';

interface CloudSource {
  key: 'nextcloud' | 'googledrive' | 'icloud';
  label: string;
  badge: string;
  available: boolean;
  onOpen: () => void;
}

interface Props {
  epub: Selection | null;
  audio: Selection | null;
  onPickEpubDevice: () => Promise<Selection | null>;
  onPickAudioDevice: () => Promise<Selection | null>;
  onSelectEpub: (sel: Selection) => void;
  onSelectAudio: (sel: Selection) => void;
  onClearEpub: () => void;
  onClearAudio: () => void;
  onConfirm: () => void;
  confirming?: boolean;
  recentBooks?: BookBrief[];
  cloudSources?: CloudSource[];
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatWhen(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  if (diff < 7 * 86_400_000) return dayjs(ts).fromNow();
  return dayjs(ts).format('MMM D, YYYY');
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function normalizeStem(name: string): string {
  return stripExt(name)
    .toLowerCase()
    .replace(/[\s_\-.()\[\]]+/g, ' ')
    .trim();
}

interface PartnerCandidate {
  uri: string;
  name: string;
  kind: PickKind;
}

function findPartner(
  selectedName: string,
  partnerKind: PickKind,
  candidates: PartnerCandidate[],
): { uri: string; name: string } | null {
  const target = normalizeStem(selectedName);
  if (!target) return null;
  const pool = candidates.filter((c) => c.kind === partnerKind);
  const exact = pool.find((c) => normalizeStem(c.name) === target);
  if (exact) return { uri: exact.uri, name: exact.name };
  const contained = pool.find((c) => {
    const n = normalizeStem(c.name);
    return n.length >= 4 && target.length >= 4 && (n.includes(target) || target.includes(n));
  });
  if (contained) return { uri: contained.uri, name: contained.name };
  return null;
}

// ── Selection slot card (hero card with large interaction area) ─────────────────

interface SlotProps {
  kind: PickKind;
  label: string;
  selection: Selection | null;
  onClear: () => void;
  onTap: () => Promise<void>;
}

function SelectionSlot({ kind, label, selection, onClear, onTap }: SlotProps) {
  const filled = selection !== null;
  const glow = useRef(new Animated.Value(filled ? 1 : 0)).current;
  const [loading, setLoading] = React.useState(false);

  useEffect(() => {
    Animated.timing(glow, {
      toValue: filled ? 1 : 0,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [filled]);

  const borderColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [C.faint, C.brass],
  });
  const bg = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [C.vellum, 'rgba(20, 20, 31, 0.8)'],
  });

  const handleTap = async () => {
    setLoading(true);
    try {
      await onTap();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Animated.View
      style={[
        styles.slotHero,
        {
          borderColor,
          backgroundColor: bg,
        },
      ]}
    >
      <Pressable
        onPress={handleTap}
        disabled={loading}
        style={styles.slotTouchable}
      >
        <View style={styles.slotContent}>
          <Text style={styles.slotIcon}>{kind === 'epub' ? '📖' : '🎧'}</Text>
          <Text style={styles.slotLabel}>{label}</Text>
          {filled ? (
            <Text style={styles.slotName} numberOfLines={2} ellipsizeMode="tail">
              {stripExt(selection!.name)}
            </Text>
          ) : (
            <Text style={styles.slotPrompt}>Tap to select</Text>
          )}
        </View>
        {loading && <ActivityIndicator color={C.brass} style={{ marginRight: 8 }} />}
        {filled && !loading && (
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              onClear();
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={styles.slotClearBtn}
          >
            <Text style={styles.slotClearGlyph}>✕</Text>
          </TouchableOpacity>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ── Browse options (minimal, secondary) ───────────────────────────────────────

interface BrowseOptionsProps {
  hasRecents: boolean;
  hasDownloads: boolean;
  hasCloud: boolean;
  onBrowseDevice: () => void;
  onBrowseDownloads: () => void;
  onBrowseCloud: () => void;
}

function BrowseOptions({
  hasRecents,
  hasDownloads,
  hasCloud,
  onBrowseDevice,
  onBrowseDownloads,
  onBrowseCloud,
}: BrowseOptionsProps) {
  return (
    <View style={styles.browseContainer}>
      <Text style={styles.browseHeading}>More options</Text>
      <View style={styles.browseGrid}>
        <Pressable
          onPress={onBrowseDevice}
          style={styles.browseTile}
          android_ripple={{ color: C.rail }}
        >
          <Text style={styles.browseTileIcon}>▦</Text>
          <Text style={styles.browseTileLabel}>Browse device</Text>
        </Pressable>
        {hasDownloads && (
          <Pressable
            onPress={onBrowseDownloads}
            style={styles.browseTile}
            android_ripple={{ color: C.rail }}
          >
            <Text style={styles.browseTileIcon}>↓</Text>
            <Text style={styles.browseTileLabel}>Downloaded</Text>
          </Pressable>
        )}
        {hasCloud && (
          <Pressable
            onPress={onBrowseCloud}
            style={styles.browseTile}
            android_ripple={{ color: C.rail }}
          >
            <Text style={styles.browseTileIcon}>☁</Text>
            <Text style={styles.browseTileLabel}>Cloud</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ── File row ──────────────────────────────────────────────────────────────────

interface FileRowProps {
  name: string;
  kind: PickKind;
  sizeBytes?: number;
  whenTs?: number;
  whenLabel?: string;
  subLabel?: string;
  active?: boolean;
  onPress: () => void;
  accent?: string;
}

function FileRow({
  name,
  kind,
  sizeBytes,
  whenTs,
  whenLabel,
  subLabel,
  active,
  onPress,
  accent,
}: FileRowProps) {
  const press = useRef(new Animated.Value(0)).current;

  const handleIn = () => {
    Animated.timing(press, { toValue: 1, duration: 120, useNativeDriver: true }).start();
  };
  const handleOut = () => {
    Animated.timing(press, { toValue: 0, duration: 180, useNativeDriver: true }).start();
  };

  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] });

  const meta: string[] = [];
  if (subLabel) meta.push(subLabel);
  if (typeof sizeBytes === 'number') meta.push(formatBytes(sizeBytes));
  meta.push(whenLabel ?? (whenTs ? formatWhen(whenTs) : ''));

  const kindAccent = accent ?? (kind === 'epub' ? '#4A78C4' : kind === 'audio' ? '#7AB097' : C.brass);
  const kindGlyph = kind === 'epub' ? '📖' : kind === 'audio' ? '🎧' : '◌';
  const kindLabel = kind === 'epub' ? 'EPUB' : kind === 'audio' ? 'AUDIO' : 'FILE';

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={handleIn}
        onPressOut={handleOut}
        style={[styles.fileRow, active && styles.fileRowActive]}
      >
        <View style={[styles.fileTick, { backgroundColor: kindAccent }]} />
        <View style={styles.fileIcon}>
          <Text style={styles.fileGlyph}>{kindGlyph}</Text>
        </View>
        <View style={styles.fileMeta}>
          <View style={styles.fileTopRow}>
            <Text style={[styles.fileKind, { color: kindAccent }]}>{kindLabel}</Text>
            {active && (
              <View style={styles.fileSelectedPill}>
                <Text style={styles.fileSelectedText}>SELECTED</Text>
              </View>
            )}
          </View>
          <Text style={styles.fileName} numberOfLines={1} ellipsizeMode="middle">
            {stripExt(name)}
          </Text>
          <Text style={styles.fileSub} numberOfLines={1}>
            {meta.filter(Boolean).join('  ·  ')}
          </Text>
        </View>
        <View style={styles.fileChev}>
          {active ? (
            <View style={styles.fileCheckCircle}>
              <Text style={styles.fileCheckGlyph}>✓</Text>
            </View>
          ) : (
            <Text style={styles.fileChevGlyph}>›</Text>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyPanel({
  glyph,
  title,
  body,
  actionLabel,
  onAction,
}: {
  glyph: string;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyMedallion}>
        <Text style={styles.emptyGlyph}>{glyph}</Text>
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {actionLabel && onAction && (
        <TouchableOpacity style={styles.emptyAction} onPress={onAction} activeOpacity={0.8}>
          <Text style={styles.emptyActionText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────

function Heading({
  eyebrow,
  title,
  actionLabel,
  onAction,
}: {
  eyebrow?: string;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.heading}>
      {eyebrow ? <Text style={styles.headingEyebrow}>{eyebrow}</Text> : null}
      <View style={styles.headingRow}>
        <Text style={styles.headingTitle}>{title}</Text>
        <View style={styles.headingRule} />
        {actionLabel && onAction ? (
          <TouchableOpacity
            onPress={onAction}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.headingAction}
            activeOpacity={0.7}
          >
            <Text style={styles.headingActionText}>{actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

// ── Cloud card ────────────────────────────────────────────────────────────────

function CloudCard({ source }: { source: CloudSource }) {
  return (
    <Pressable
      onPress={source.onOpen}
      disabled={!source.available}
      style={[styles.cloudCard, !source.available && styles.cloudCardDisabled]}
    >
      <View style={styles.cloudBadge}>
        <Text style={styles.cloudBadgeGlyph}>{source.badge}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cloudLabel}>{source.label}</Text>
        <Text style={styles.cloudStatus}>
          {source.available ? 'Browse folders' : 'Not connected — configure in Settings'}
        </Text>
      </View>
      <Text style={[styles.cloudChev, !source.available && { opacity: 0.25 }]}>›</Text>
    </Pressable>
  );
}

// ── Main browser ──────────────────────────────────────────────────────────────

export default function OpenFromBrowser({
  epub,
  audio,
  onPickEpubDevice,
  onPickAudioDevice,
  onSelectEpub,
  onSelectAudio,
  onClearEpub,
  onClearAudio,
  onConfirm,
  confirming,
  recentBooks = [],
  cloudSources = [],
}: Props) {
  const [recents, setRecents] = useState<RecentPick[]>([]);
  const [cached, setCached] = useState<CachedFile[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRecents = useCallback(async () => {
    const picks = await getRecentPicks();
    setRecents(picks);
  }, []);

  const loadCached = useCallback(() => {
    setCached(listCachedFiles());
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await loadRecents();
      if (!mounted) return;
      loadCached();
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [loadRecents, loadCached]);

  // Map cache URI → original filename. Cached files are named by UUID on disk; the
  // readable name comes from (1) recent picks, or (2) the paired book in the library.
  const nameByUri = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of recentBooks) {
      const title = b.title || 'Untitled';
      if (b.epubPath) map.set(b.epubPath, `${title}.epub`);
      if (b.audioPath) {
        const ext = b.audioPath.split('.').pop() || 'audio';
        map.set(b.audioPath, `${title}.${ext}`);
      }
    }
    // Recent picks win over library lookups — they hold the user's actual filename.
    for (const r of recents) map.set(r.uri, r.name);
    return map;
  }, [recents, recentBooks]);

  // Recent-book-paired files (EPUB + audio pairs) for the Recents tab.
  const recentBookFiles = useMemo(() => {
    const items: Array<{ uri: string; name: string; kind: PickKind; when: number; via: string }> = [];
    for (const b of recentBooks.slice(0, 6)) {
      const pairTitle = b.title || 'Untitled';
      if (b.epubPath) {
        items.push({
          uri: b.epubPath,
          name: `${pairTitle}.epub`,
          kind: 'epub',
          when: b.updatedAt ?? b.addedAt,
          via: `From "${pairTitle}"`,
        });
      }
      if (b.audioPath) {
        items.push({
          uri: b.audioPath,
          name: `${pairTitle}.audio`,
          kind: 'audio',
          when: b.updatedAt ?? b.addedAt,
          via: `From "${pairTitle}"`,
        });
      }
    }
    return items;
  }, [recentBooks]);

  const partnerCandidates = useMemo<PartnerCandidate[]>(() => {
    const byUri = new Map<string, PartnerCandidate>();
    for (const r of recents) {
      if (r.kind === 'other') continue;
      byUri.set(r.uri, { uri: r.uri, name: r.name, kind: r.kind });
    }
    for (const c of cached) {
      if (c.kind === 'other') continue;
      if (!byUri.has(c.uri)) {
        byUri.set(c.uri, { uri: c.uri, name: nameByUri.get(c.uri) ?? c.name, kind: c.kind });
      }
    }
    return Array.from(byUri.values());
  }, [recents, cached, nameByUri]);

  const selectEpubWithMatch = useCallback(
    (sel: Selection) => {
      onSelectEpub(sel);
      if (!audio) {
        const partner = findPartner(sel.name, 'audio', partnerCandidates);
        if (partner) onSelectAudio(partner);
      }
    },
    [onSelectEpub, onSelectAudio, audio, partnerCandidates],
  );

  const selectAudioWithMatch = useCallback(
    (sel: Selection) => {
      onSelectAudio(sel);
      if (!epub) {
        const partner = findPartner(sel.name, 'epub', partnerCandidates);
        if (partner) onSelectEpub(partner);
      }
    },
    [onSelectEpub, onSelectAudio, epub, partnerCandidates],
  );

  const handleSelectFile = useCallback(
    (uri: string, name: string, forcedKind?: PickKind) => {
      const kind = forcedKind ?? classifyName(name);
      if (kind === 'epub') {
        if (epub?.uri === uri) onClearEpub();
        else selectEpubWithMatch({ uri, name });
      } else if (kind === 'audio') {
        if (audio?.uri === uri) onClearAudio();
        else selectAudioWithMatch({ uri, name });
      }
    },
    [epub, audio, onClearEpub, onClearAudio, selectEpubWithMatch, selectAudioWithMatch],
  );

  const handleClearRecents = useCallback(() => {
    Alert.alert(
      'Clear recent picks?',
      'This removes the list of recently opened files. The files themselves stay where they are.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearRecentPicks();
            setRecents([]);
          },
        },
      ],
    );
  }, []);

  const handleBrowseDevice = useCallback(async () => {
    // Alternates between picking whichever slot is still empty, audio first if EPUB done.
    if (!epub) {
      const r = await onPickEpubDevice();
      if (r) selectEpubWithMatch(r);
      loadRecents();
      loadCached();
      return;
    }
    if (!audio) {
      const r = await onPickAudioDevice();
      if (r) selectAudioWithMatch(r);
      loadRecents();
      loadCached();
    }
  }, [epub, audio, onPickEpubDevice, onPickAudioDevice, selectEpubWithMatch, selectAudioWithMatch, loadRecents, loadCached]);

  const counts: Record<TabKey, number | null> = {
    recents: recents.length + recentBookFiles.length,
    downloads: cached.length,
    documents: null,
    cloud: cloudSources.filter((c) => c.available).length,
  };

  const bothReady = epub !== null && audio !== null;
  const selectedUris = new Set<string>();
  if (epub) selectedUris.add(epub.uri);
  if (audio) selectedUris.add(audio.uri);

  // ── Tab content render ─────────────────────────────────────────────────────
  const renderTab = () => {
    if (loading) {
      return (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={C.brass} />
          <Text style={styles.loadingText}>Gathering files…</Text>
        </View>
      );
    }

    if (tab === 'recents') {
      const seen = new Set<string>();
      const items: Array<{
        uri: string;
        name: string;
        kind: PickKind;
        size?: number;
        when: number;
        sub: string;
      }> = [];
      for (const r of recents) {
        if (seen.has(r.uri)) continue;
        seen.add(r.uri);
        items.push({
          uri: r.uri,
          name: r.name,
          kind: r.kind,
          size: r.sizeBytes,
          when: r.pickedAt,
          sub: 'Recent pick',
        });
      }
      for (const r of recentBookFiles) {
        if (seen.has(r.uri)) continue;
        seen.add(r.uri);
        items.push({
          uri: r.uri,
          name: r.name,
          kind: r.kind,
          size: undefined,
          when: r.when,
          sub: r.via,
        });
      }

      if (items.length === 0) {
        return (
          <EmptyPanel
            glyph="◷"
            title="No recent picks"
            body="Files you've pulled in recently — from Downloads, Documents, or cloud sources — will show up here for quick re-use."
            actionLabel="Browse device"
            onAction={handleBrowseDevice}
          />
        );
      }

      const canClear = recents.length > 0;
      return (
        <View style={styles.tabContent}>
          <Heading
            eyebrow="Recently opened"
            title="Quick picks"
            actionLabel={canClear ? 'Clear' : undefined}
            onAction={canClear ? handleClearRecents : undefined}
          />
          {items.map((f, i) => (
            <FileRow
              key={`${f.uri}-${i}`}
              name={f.name}
              kind={f.kind}
              sizeBytes={f.size}
              whenTs={f.when}
              subLabel={f.sub}
              active={selectedUris.has(f.uri)}
              onPress={() => handleSelectFile(f.uri, f.name, f.kind)}
            />
          ))}
        </View>
      );
    }

    if (tab === 'downloads') {
      if (cached.length === 0) {
        return (
          <EmptyPanel
            glyph="↓"
            title="No downloads yet"
            body="Files imported from cloud storage land here. Pull an EPUB and its audio companion in from Nextcloud, Drive, or iCloud."
          />
        );
      }

      const epubs = cached.filter((f) => f.kind === 'epub');
      const audios = cached.filter((f) => f.kind === 'audio');

      return (
        <View style={styles.tabContent}>
          {epubs.length > 0 && (
            <>
              <Heading eyebrow={`${epubs.length} files`} title="Text" />
              {epubs.map((f) => {
                const displayName = nameByUri.get(f.uri) ?? f.name;
                return (
                  <FileRow
                    key={f.uri}
                    name={displayName}
                    kind="epub"
                    sizeBytes={f.sizeBytes}
                    whenTs={f.modifiedAt}
                    subLabel="In Downloads"
                    active={selectedUris.has(f.uri)}
                    onPress={() => handleSelectFile(f.uri, displayName, 'epub')}
                  />
                );
              })}
            </>
          )}
          {audios.length > 0 && (
            <>
              <Heading eyebrow={`${audios.length} files`} title="Audio" />
              {audios.map((f) => {
                const displayName = nameByUri.get(f.uri) ?? f.name;
                return (
                  <FileRow
                    key={f.uri}
                    name={displayName}
                    kind="audio"
                    sizeBytes={f.sizeBytes}
                    whenTs={f.modifiedAt}
                    subLabel="In Downloads"
                    active={selectedUris.has(f.uri)}
                    onPress={() => handleSelectFile(f.uri, displayName, 'audio')}
                  />
                );
              })}
            </>
          )}
        </View>
      );
    }

    if (tab === 'documents') {
      return (
        <View style={styles.tabContent}>
          <Heading eyebrow="On this device" title="Browse files" />
          <View style={styles.docPair}>
            <Pressable
              style={[styles.docCard, epub && styles.docCardFilled]}
              onPress={async () => {
                const r = await onPickEpubDevice();
                if (r) selectEpubWithMatch(r);
                loadRecents();
                loadCached();
              }}
            >
              <View style={styles.docCardTop}>
                <View style={[styles.docMedallion, { borderColor: '#4A78C4' }]}>
                  <Text style={styles.docMedallionGlyph}>📖</Text>
                </View>
                <View style={[styles.docTypePill, { borderColor: '#4A78C4' + '55' }]}>
                  <Text style={[styles.docTypePillText, { color: '#4A78C4' }]}>EPUB</Text>
                </View>
              </View>
              {epub ? (
                <Text style={styles.docCardTitle} numberOfLines={3}>
                  {stripExt(epub.name) || 'Ebook selected'}
                </Text>
              ) : (
                <Text style={styles.docCardPlaceholder}>Choose ebook</Text>
              )}
              <Text style={styles.docCardHint}>
                {epub ? 'Tap to change' : 'Open Files app'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.docCard, audio && styles.docCardFilled]}
              onPress={async () => {
                const r = await onPickAudioDevice();
                if (r) selectAudioWithMatch(r);
                loadRecents();
                loadCached();
              }}
            >
              <View style={styles.docCardTop}>
                <View style={[styles.docMedallion, { borderColor: '#7AB097' }]}>
                  <Text style={styles.docMedallionGlyph}>🎧</Text>
                </View>
                <View style={[styles.docTypePill, { borderColor: '#7AB097' + '55' }]}>
                  <Text style={[styles.docTypePillText, { color: '#7AB097' }]}>AUDIO</Text>
                </View>
              </View>
              {audio ? (
                <Text style={styles.docCardTitle} numberOfLines={3}>
                  {stripExt(audio.name) || 'Audio selected'}
                </Text>
              ) : (
                <Text style={styles.docCardPlaceholder}>Choose audio</Text>
              )}
              <Text style={styles.docCardHint}>
                {audio ? 'Tap to change' : 'Open Files app'}
              </Text>
            </Pressable>
          </View>
          <View style={styles.docHintRow}>
            <View style={styles.docHintDot} />
            <Text style={styles.docHint}>
              Opens the system Files browser — pick from iCloud Drive, On My iPhone, or any folder provider.
            </Text>
          </View>
        </View>
      );
    }

    // Cloud
    if (cloudSources.length === 0 || cloudSources.every((c) => !c.available)) {
      return (
        <EmptyPanel
          glyph="☁"
          title="No cloud sources connected"
          body="Link Nextcloud, Google Drive, or iCloud from Settings to browse your remote library right from here."
        />
      );
    }
    return (
      <View style={styles.tabContent}>
        <Heading eyebrow="Linked services" title="Your cloud" />
        {cloudSources.map((s) => (
          <CloudCard key={s.key} source={s} />
        ))}
      </View>
    );
  };

  const showBrowseOptions = !loading && (cached.length > 0 || cloudSources.some((c) => c.available));

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.rootContent} showsVerticalScrollIndicator={false}>
      {/* ─────── Hero: Pairing Action ───────── */}
      <View style={styles.heroSection}>
        <View style={styles.slotPair}>
          <SelectionSlot
            kind="epub"
            label="Text"
            selection={epub}
            onClear={onClearEpub}
            onTap={async () => {
              const r = await onPickEpubDevice();
              if (r) selectEpubWithMatch(r);
              loadRecents();
              loadCached();
            }}
          />
          <SelectionSlot
            kind="audio"
            label="Audio"
            selection={audio}
            onClear={onClearAudio}
            onTap={async () => {
              const r = await onPickAudioDevice();
              if (r) selectAudioWithMatch(r);
              loadRecents();
              loadCached();
            }}
          />
        </View>

        {/* Status message */}
        <View style={styles.statusMessage}>
          <Text style={styles.statusText}>
            {bothReady
              ? '✓ Ready to pair'
              : epub && !audio
              ? 'Select audio to complete pairing'
              : !epub && audio
              ? 'Select text to complete pairing'
              : 'Select both to get started'}
          </Text>
        </View>

        {/* Primary action */}
        {bothReady && (
          <TouchableOpacity
            style={[styles.actionButton, confirming && styles.actionButtonDisabled]}
            onPress={onConfirm}
            disabled={confirming}
            activeOpacity={0.85}
          >
            {confirming ? (
              <>
                <ActivityIndicator size="small" color={C.ink} style={{ marginRight: 8 }} />
                <Text style={styles.actionButtonText}>Adding to library…</Text>
              </>
            ) : (
              <>
                <Text style={styles.actionButtonIcon}>→</Text>
                <Text style={styles.actionButtonText}>Add to library</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* ─────── Smart Recents (no tab switch needed) ───────── */}
      {!loading && recents.length > 0 && (
        <View style={styles.recentsSection}>
          <Heading
            eyebrow="Quick access"
            title="Recent files"
            actionLabel={recents.length > 0 ? 'Clear' : undefined}
            onAction={recents.length > 0 ? handleClearRecents : undefined}
          />
          {recents.slice(0, 4).map((r, i) => (
            <FileRow
              key={`${r.uri}-${i}`}
              name={r.name}
              kind={r.kind}
              sizeBytes={r.sizeBytes}
              whenTs={r.pickedAt}
              subLabel="Recent"
              active={selectedUris.has(r.uri)}
              onPress={() => handleSelectFile(r.uri, r.name)}
            />
          ))}
        </View>
      )}

      {/* ─────── Browse More Options ───────── */}
      {showBrowseOptions && (
        <BrowseOptions
          hasRecents={recents.length > 0}
          hasDownloads={cached.length > 0}
          hasCloud={cloudSources.some((c) => c.available)}
          onBrowseDevice={handleBrowseDevice}
          onBrowseDownloads={handleBrowseDevice}
          onBrowseCloud={handleBrowseDevice}
        />
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.ink,
  },
  rootContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },

  // ─────── Hero Section: Pairing Action ───────────
  heroSection: {
    marginBottom: 28,
  },
  slotPair: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },

  // Selection slot (large, hero style)
  slotHero: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 16,
    minHeight: 140,
    justifyContent: 'center',
  },
  slotTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  slotContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  slotLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: C.brassDim,
    letterSpacing: 2.2,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  slotName: {
    fontSize: 14,
    fontWeight: '700',
    color: C.parchment,
    letterSpacing: -0.2,
    textAlign: 'center',
    lineHeight: 20,
  },
  slotPrompt: {
    fontSize: 13,
    color: C.muted,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  slotClearBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(201, 169, 110, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotClearGlyph: {
    fontSize: 18,
    color: C.brass,
    fontWeight: '300',
    marginTop: -1,
  },

  // Status message
  statusMessage: {
    alignItems: 'center',
    paddingVertical: 12,
    marginBottom: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.rule,
  },
  statusText: {
    fontSize: 13,
    color: C.quill,
    letterSpacing: 0.2,
  },

  // Action button
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.brass,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  actionButtonDisabled: {
    opacity: 0.65,
  },
  actionButtonIcon: {
    fontSize: 16,
    color: C.ink,
    marginRight: 8,
    fontWeight: '500',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: C.ink,
    letterSpacing: 0.3,
  },

  // ─────── Recents Section ───────────
  recentsSection: {
    marginBottom: 24,
  },

  // ─────── Browse Options ───────────
  browseContainer: {
    marginBottom: 24,
  },
  browseHeading: {
    fontSize: 10,
    fontWeight: '800',
    color: C.brassDim,
    letterSpacing: 2.2,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  browseGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  browseTile: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.rail,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
  },
  browseTileIcon: {
    fontSize: 24,
    marginBottom: 6,
  },
  browseTileLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: C.parchment,
    textAlign: 'center',
    letterSpacing: -0.1,
  },

  // Heading
  heading: { marginTop: 8, marginBottom: 10 },
  headingEyebrow: {
    fontSize: 9,
    fontWeight: '800',
    color: C.brassDim,
    letterSpacing: 2.4,
    marginBottom: 4,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.parchment,
    letterSpacing: -0.3,
  },
  headingRule: {
    flex: 1,
    height: 1,
    backgroundColor: C.rail,
  },
  headingAction: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: C.brassDim,
    borderRadius: 12,
  },
  headingActionText: {
    fontSize: 10,
    fontWeight: '800',
    color: C.brass,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },

  // File row
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.vellum,
    borderWidth: 1,
    borderColor: C.rail,
    borderRadius: 12,
    paddingVertical: 12,
    paddingRight: 14,
    paddingLeft: 0,
    marginBottom: 8,
    overflow: 'hidden',
  },
  fileRowActive: {
    borderColor: C.brass,
    backgroundColor: C.chamber,
  },
  fileTick: {
    width: 3,
    alignSelf: 'stretch',
    marginRight: 12,
  },
  fileIcon: {
    width: 38,
    height: 38,
    borderRadius: 9,
    backgroundColor: C.ink,
    borderWidth: 1,
    borderColor: C.rail,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  fileGlyph: { fontSize: 16 },
  fileMeta: { flex: 1 },
  fileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  fileKind: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.6,
  },
  fileSelectedPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: C.brassDim,
  },
  fileSelectedText: {
    fontSize: 8,
    fontWeight: '800',
    color: C.parchment,
    letterSpacing: 1.2,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    color: C.parchment,
    letterSpacing: -0.15,
    marginBottom: 2,
  },
  fileSub: {
    fontSize: 11,
    color: C.muted,
    letterSpacing: 0.1,
  },
  fileChev: {
    marginLeft: 10,
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileChevGlyph: {
    fontSize: 20,
    color: C.faint,
    fontWeight: '300',
  },
  fileCheckCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.brass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileCheckGlyph: {
    fontSize: 12,
    fontWeight: '800',
    color: C.ink,
  },

  // Empty
  empty: {
    alignItems: 'center',
    paddingTop: 40,
    paddingHorizontal: 24,
  },
  emptyMedallion: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 1,
    borderColor: C.brassDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    backgroundColor: C.vellum,
  },
  emptyGlyph: {
    fontSize: 26,
    color: C.brass,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: C.parchment,
    letterSpacing: -0.2,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 13,
    color: C.muted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
    marginBottom: 18,
  },
  emptyAction: {
    borderWidth: 1,
    borderColor: C.brassDim,
    borderRadius: 20,
    paddingVertical: 9,
    paddingHorizontal: 18,
  },
  emptyActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: C.brass,
    letterSpacing: 0.6,
  },

  // Documents cards
  docPair: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  docCard: {
    flex: 1,
    backgroundColor: C.vellum,
    borderWidth: 1,
    borderColor: C.rail,
    borderRadius: 14,
    padding: 16,
    minHeight: 160,
  },
  docCardFilled: {
    borderColor: C.brassDim,
    backgroundColor: C.chamber,
  },
  docCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  docMedallion: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docMedallionGlyph: { fontSize: 17 },
  docTypePill: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  docTypePillText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  docCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: C.parchment,
    letterSpacing: -0.3,
    lineHeight: 20,
    marginBottom: 8,
    flex: 1,
  },
  docCardPlaceholder: {
    fontSize: 14,
    fontWeight: '500',
    color: C.muted,
    letterSpacing: -0.1,
    marginBottom: 8,
    flex: 1,
  },
  docCardHint: {
    fontSize: 11,
    color: C.muted,
    marginTop: 'auto',
  },
  docHintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: C.vellum,
    borderWidth: 1,
    borderColor: C.rail,
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  docHintDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: C.brass,
    marginTop: 6,
  },
  docHint: {
    flex: 1,
    fontSize: 12,
    color: C.quill,
    lineHeight: 18,
  },

  // Cloud
  cloudCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.vellum,
    borderWidth: 1,
    borderColor: C.rail,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cloudCardDisabled: { opacity: 0.45 },
  cloudBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.brassDim,
    backgroundColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cloudBadgeGlyph: {
    fontSize: 16,
    color: C.brass,
  },
  cloudLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: C.parchment,
    letterSpacing: -0.1,
    marginBottom: 2,
  },
  cloudStatus: {
    fontSize: 11,
    color: C.muted,
  },
  cloudChev: {
    fontSize: 22,
    color: C.brass,
    fontWeight: '300',
    marginLeft: 10,
  },

  // Loading
  loadingWrap: {
    alignItems: 'center',
    paddingTop: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 12,
    color: C.muted,
    letterSpacing: 0.4,
  },

});
