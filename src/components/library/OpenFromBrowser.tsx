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
} from 'react-native';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  getRecentPicks,
  listCachedFiles,
  classifyName,
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

// ── Selection slot card ───────────────────────────────────────────────────────

interface SlotProps {
  kind: PickKind;
  label: string;
  selection: Selection | null;
  onClear: () => void;
}

function SelectionSlot({ kind, label, selection, onClear }: SlotProps) {
  const filled = selection !== null;
  const glow = useRef(new Animated.Value(filled ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(glow, {
      toValue: filled ? 1 : 0,
      duration: 360,
      useNativeDriver: false,
    }).start();
  }, [filled]);

  const borderColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [C.rule, C.brass],
  });
  const bg = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [C.vellum, C.chamber],
  });

  return (
    <Animated.View
      style={[
        styles.slot,
        {
          borderColor,
          backgroundColor: bg,
          borderStyle: filled ? 'solid' : 'dashed',
        },
      ]}
    >
      <View style={styles.slotBadge}>
        <Text style={styles.slotBadgeGlyph}>{kind === 'epub' ? '📖' : '🎧'}</Text>
      </View>
      <View style={styles.slotBody}>
        <Text style={styles.slotLabel}>{label}</Text>
        {filled ? (
          <Text style={styles.slotName} numberOfLines={1} ellipsizeMode="middle">
            {stripExt(selection!.name)}
          </Text>
        ) : (
          <Text style={styles.slotEmpty}>Tap a file below to pair</Text>
        )}
      </View>
      {filled ? (
        <TouchableOpacity
          onPress={onClear}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.slotClear}
        >
          <Text style={styles.slotClearGlyph}>×</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.slotIndicator}>
          <View style={[styles.slotIndicatorDot, { opacity: 0.4 }]} />
          <View style={[styles.slotIndicatorDot, { opacity: 0.25 }]} />
          <View style={[styles.slotIndicatorDot, { opacity: 0.15 }]} />
        </View>
      )}
    </Animated.View>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

const TABS: Array<{ key: TabKey; label: string; glyph: string }> = [
  { key: 'recents', label: 'Recents', glyph: '◷' },
  { key: 'downloads', label: 'Downloads', glyph: '↓' },
  { key: 'documents', label: 'Documents', glyph: '◰' },
  { key: 'cloud', label: 'Cloud', glyph: '☁' },
];

interface TabBarProps {
  active: TabKey;
  onChange: (key: TabKey) => void;
  counts: Record<TabKey, number | null>;
}

function TabBar({ active, onChange, counts }: TabBarProps) {
  const [widths, setWidths] = useState<Record<TabKey, number>>({
    recents: 0,
    downloads: 0,
    documents: 0,
    cloud: 0,
  });
  const [offsets, setOffsets] = useState<Record<TabKey, number>>({
    recents: 0,
    downloads: 0,
    documents: 0,
    cloud: 0,
  });

  const indicatorX = useRef(new Animated.Value(0)).current;
  const indicatorW = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const w = widths[active];
    const x = offsets[active];
    if (!w) return;
    Animated.parallel([
      Animated.spring(indicatorX, { toValue: x, tension: 180, friction: 20, useNativeDriver: false }),
      Animated.spring(indicatorW, { toValue: w, tension: 180, friction: 20, useNativeDriver: false }),
    ]).start();
  }, [active, widths, offsets]);

  const handleLayout = (key: TabKey) => (e: LayoutChangeEvent) => {
    const { width, x } = e.nativeEvent.layout;
    setWidths((prev) => ({ ...prev, [key]: width }));
    setOffsets((prev) => ({ ...prev, [key]: x }));
  };

  return (
    <View style={styles.tabBarWrap}>
      <View style={styles.tabBar}>
        {TABS.map((t) => {
          const isActive = active === t.key;
          const count = counts[t.key];
          return (
            <Pressable
              key={t.key}
              onPress={() => onChange(t.key)}
              onLayout={handleLayout(t.key)}
              style={styles.tab}
              android_ripple={{ color: C.rail, borderless: false }}
            >
              <Text style={styles.tabGlyph}>{t.glyph}</Text>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{t.label}</Text>
              {count !== null && count > 0 && (
                <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}>
                  <Text style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]}>
                    {count > 99 ? '99' : count}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
        <Animated.View
          style={[
            styles.tabIndicator,
            { transform: [{ translateX: indicatorX }], width: indicatorW },
          ]}
        >
          <View style={styles.tabIndicatorBar} />
          <View style={styles.tabIndicatorNub} />
        </Animated.View>
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

function Heading({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return (
    <View style={styles.heading}>
      {eyebrow ? <Text style={styles.headingEyebrow}>{eyebrow}</Text> : null}
      <View style={styles.headingRow}>
        <Text style={styles.headingTitle}>{title}</Text>
        <View style={styles.headingRule} />
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
  const [tab, setTab] = useState<TabKey>('recents');
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

  // Map cache URI → original filename using recent picks (cached files use UUID-based names).
  const nameByUri = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of recents) map.set(r.uri, r.name);
    return map;
  }, [recents]);

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

  const handleSelectFile = useCallback(
    (uri: string, name: string, forcedKind?: PickKind) => {
      const kind = forcedKind ?? classifyName(name);
      if (kind === 'epub') {
        if (epub?.uri === uri) onClearEpub();
        else onSelectEpub({ uri, name });
      } else if (kind === 'audio') {
        if (audio?.uri === uri) onClearAudio();
        else onSelectAudio({ uri, name });
      }
    },
    [epub, audio, onSelectEpub, onSelectAudio, onClearEpub, onClearAudio],
  );

  const handleBrowseDevice = useCallback(async () => {
    // Alternates between picking whichever slot is still empty, audio first if EPUB done.
    if (!epub) {
      const r = await onPickEpubDevice();
      if (r) onSelectEpub(r);
      loadRecents();
      loadCached();
      return;
    }
    if (!audio) {
      const r = await onPickAudioDevice();
      if (r) onSelectAudio(r);
      loadRecents();
      loadCached();
    }
  }, [epub, audio, onPickEpubDevice, onPickAudioDevice, onSelectEpub, onSelectAudio, loadRecents, loadCached]);

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
      const items = [
        ...recents.map((r) => ({
          uri: r.uri,
          name: r.name,
          kind: r.kind,
          size: r.sizeBytes,
          when: r.pickedAt,
          sub: 'Recent pick',
        })),
        ...recentBookFiles.map((r) => ({
          uri: r.uri,
          name: r.name,
          kind: r.kind,
          size: undefined,
          when: r.when,
          sub: r.via,
        })),
      ];

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

      return (
        <View style={styles.tabContent}>
          <Heading eyebrow="Recently opened" title="Quick picks" />
          {items.map((f, i) => (
            <FileRow
              key={`${f.uri}-${i}`}
              name={f.name}
              kind={f.kind}
              sizeBytes={f.size}
              whenTs={f.when}
              subLabel={f.sub}
              active={selectedUris.has(f.uri)}
              onPress={() => handleSelectFile(f.uri, f.name)}
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
                if (r) onSelectEpub(r);
                loadRecents();
                loadCached();
              }}
            >
              <View style={[styles.docMedallion, { borderColor: '#4A78C4' }]}>
                <Text style={styles.docMedallionGlyph}>📖</Text>
              </View>
              <Text style={[styles.docCardKind, { color: '#4A78C4' }]}>EPUB</Text>
              <Text style={styles.docCardTitle} numberOfLines={2}>
                {epub ? stripExt(epub.name) : 'Choose ebook'}
              </Text>
              <Text style={styles.docCardHint}>
                {epub ? 'Tap to change' : 'Open Files app'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.docCard, audio && styles.docCardFilled]}
              onPress={async () => {
                const r = await onPickAudioDevice();
                if (r) onSelectAudio(r);
                loadRecents();
                loadCached();
              }}
            >
              <View style={[styles.docMedallion, { borderColor: '#7AB097' }]}>
                <Text style={styles.docMedallionGlyph}>🎧</Text>
              </View>
              <Text style={[styles.docCardKind, { color: '#7AB097' }]}>AUDIO</Text>
              <Text style={styles.docCardTitle} numberOfLines={2}>
                {audio ? stripExt(audio.name) : 'Choose audio'}
              </Text>
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

  return (
    <View style={styles.root}>
      {/* Selection summary */}
      <View style={styles.slotRow}>
        <SelectionSlot kind="epub" label="TEXT" selection={epub} onClear={onClearEpub} />
        <View style={styles.slotBridge}>
          <View style={[styles.slotBridgeDot, (epub || audio) && styles.slotBridgeDotActive]} />
          <View style={styles.slotBridgeLine} />
          <View style={[styles.slotBridgeDot, bothReady && styles.slotBridgeDotActive]} />
        </View>
        <SelectionSlot kind="audio" label="AUDIO" selection={audio} onClear={onClearAudio} />
      </View>

      {/* Tab bar */}
      <TabBar active={tab} onChange={setTab} counts={counts} />

      {/* Tab content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {renderTab()}
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Action footer */}
      <View style={styles.footer}>
        <View style={styles.footerBar} />
        {bothReady ? (
          <TouchableOpacity
            style={[styles.primary, confirming && { opacity: 0.7 }]}
            onPress={onConfirm}
            disabled={confirming}
            activeOpacity={0.88}
          >
            {confirming ? (
              <ActivityIndicator size="small" color={C.ink} style={{ marginRight: 10 }} />
            ) : (
              <View style={styles.primaryGlyph}>
                <Text style={styles.primaryGlyphText}>✦</Text>
              </View>
            )}
            <Text style={styles.primaryText}>
              {confirming ? 'Adding to library' : 'Pair & add to library'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.footerHintRow}>
            <View style={styles.footerHintGlyph}>
              <Text style={styles.footerHintGlyphText}>
                {epub && !audio ? '🎧' : !epub && audio ? '📖' : '✦'}
              </Text>
            </View>
            <Text style={styles.footerHint}>
              {!epub && !audio
                ? 'Pick one ebook and its audio companion to pair'
                : epub && !audio
                ? 'One more — pick the matching audio file'
                : 'One more — pick the matching ebook'}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ink },

  // Selection slots
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
  },
  slot: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.2,
    borderRadius: 14,
    padding: 12,
    minHeight: 72,
  },
  slotBadge: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: C.ink,
    borderWidth: 1,
    borderColor: C.rule,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  slotBadgeGlyph: { fontSize: 18 },
  slotBody: { flex: 1 },
  slotLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: C.brassDim,
    letterSpacing: 2.4,
    marginBottom: 3,
  },
  slotName: {
    fontSize: 13,
    fontWeight: '600',
    color: C.parchment,
    letterSpacing: -0.1,
  },
  slotEmpty: {
    fontSize: 12,
    color: C.muted,
    fontStyle: 'italic',
  },
  slotClear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.brassDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  slotClearGlyph: {
    fontSize: 14,
    lineHeight: 16,
    color: C.brass,
    fontWeight: '300',
    marginTop: -1,
  },
  slotIndicator: {
    flexDirection: 'row',
    marginLeft: 6,
    gap: 2,
  },
  slotIndicatorDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: C.brass,
  },

  // Bridge between slots
  slotBridge: {
    width: 28,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotBridgeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.rule,
  },
  slotBridgeDotActive: {
    backgroundColor: C.brass,
  },
  slotBridgeLine: {
    width: 1,
    height: 18,
    backgroundColor: C.rule,
    marginVertical: 2,
  },

  // Tab bar
  tabBarWrap: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.rail,
    backgroundColor: C.vellum,
  },
  tabBar: {
    flexDirection: 'row',
    position: 'relative',
    paddingHorizontal: 6,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  tabGlyph: {
    fontSize: 12,
    color: C.muted,
    marginRight: 6,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.muted,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  tabLabelActive: {
    color: C.brass,
  },
  tabBadge: {
    marginLeft: 6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: C.rail,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeActive: {
    backgroundColor: C.brassDim,
  },
  tabBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: C.muted,
  },
  tabBadgeTextActive: {
    color: C.parchment,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    height: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIndicatorBar: {
    position: 'absolute',
    bottom: 0,
    left: 12,
    right: 12,
    height: 2,
    backgroundColor: C.brass,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  tabIndicatorNub: {
    position: 'absolute',
    bottom: -1,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.brass,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 18 },
  tabContent: {},

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
    fontSize: 20,
    fontWeight: '700',
    color: C.parchment,
    letterSpacing: -0.4,
  },
  headingRule: {
    flex: 1,
    height: 1,
    backgroundColor: C.rail,
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
  docMedallion: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  docMedallionGlyph: { fontSize: 18 },
  docCardKind: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 6,
  },
  docCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: C.parchment,
    letterSpacing: -0.2,
    lineHeight: 18,
    marginBottom: 8,
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

  // Footer
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: C.rail,
    backgroundColor: C.vellum,
  },
  footerBar: {
    width: 32,
    height: 3,
    borderRadius: 2,
    backgroundColor: C.rule,
    alignSelf: 'center',
    marginBottom: 12,
  },
  footerHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  footerHintGlyph: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: C.rail,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  footerHintGlyphText: {
    fontSize: 14,
  },
  footerHint: {
    flex: 1,
    fontSize: 13,
    color: C.quill,
    letterSpacing: -0.1,
    lineHeight: 18,
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.brass,
    borderRadius: 14,
    paddingVertical: 15,
  },
  primaryGlyph: {
    marginRight: 10,
  },
  primaryGlyphText: {
    fontSize: 14,
    color: C.ink,
  },
  primaryText: {
    fontSize: 15,
    fontWeight: '800',
    color: C.ink,
    letterSpacing: 0.4,
  },
});
