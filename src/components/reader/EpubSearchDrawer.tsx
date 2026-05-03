import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/hooks/useTheme';
import type { Theme } from '@/constants/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchResult = {
  cfi: string;
  excerpt: string;
  chapterIndex: number;
  chapterTitle: string;
};

export interface EpubSearchDrawerHandle {
  receiveResults: (requestId: string, results: SearchResult[], done: boolean) => void;
  receiveError: (requestId: string, error: string) => void;
}

interface EpubSearchDrawerProps {
  visible: boolean;
  onClose: () => void;
  /** Called with the search query — parent fires JS_SEARCH into the WebView */
  onSearch: (query: string, requestId: string) => void;
  chapters?: { title: string }[];
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type SearchStatus = 'idle' | 'searching' | 'results' | 'no-results' | 'error';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Splits `excerpt` into alternating plain/match segments and returns an array
 * of Text spans where the matched term is bolded in the primary color.
 */
function HighlightedExcerpt({
  excerpt,
  query,
  textColor,
  matchColor,
}: {
  excerpt: string;
  query: string;
  textColor: string;
  matchColor: string;
}): React.ReactElement {
  if (!query.trim()) {
    return <Text style={{ fontSize: 16, color: textColor }}>{excerpt}</Text>;
  }

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedQuery})`, 'gi');
  const parts = excerpt.split(regex);

  return (
    <Text style={{ fontSize: 16, color: textColor }}>
      {parts.map((part, index) => {
        const isMatch = regex.test(part);
        // Reset lastIndex because the same regex is reused
        regex.lastIndex = 0;
        if (isMatch && part.toLowerCase() === query.toLowerCase()) {
          return (
            <Text key={index} style={{ fontWeight: '700', color: matchColor }}>
              {part}
            </Text>
          );
        }
        return part;
      })}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const EpubSearchDrawer = forwardRef<EpubSearchDrawerHandle, EpubSearchDrawerProps>(
  function EpubSearchDrawer({ visible, onClose, onSearch }, ref) {
    const insets = useSafeAreaInsets();
    const { theme } = useTheme();

    // Animation — mirrors TopDrawerModal exactly
    const translate = useRef(new Animated.Value(visible ? 0 : -1)).current;
    const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;

    useEffect(() => {
      Animated.parallel([
        Animated.timing(translate, {
          toValue: visible ? 0 : -1,
          duration: 240,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: visible ? 1 : 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }, [visible, translate, opacity]);

    // Focus the input when the drawer becomes visible
    const inputRef = useRef<TextInput>(null);
    useEffect(() => {
      if (visible) {
        // Small delay so the animation has started before the keyboard opens
        const timer = setTimeout(() => inputRef.current?.focus(), 80);
        return () => clearTimeout(timer);
      }
    }, [visible]);

    // Search state
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState<SearchStatus>('idle');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [errorMessage, setErrorMessage] = useState('');
    const currentRequestIdRef = useRef<string | null>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Imperative handle for parent to stream results / errors
    useImperativeHandle(ref, () => ({
      receiveResults(requestId: string, incoming: SearchResult[], done: boolean) {
        if (requestId !== currentRequestIdRef.current) return; // stale — ignore
        setResults((prev) => [...prev, ...incoming]);
        if (done) {
          setStatus((prev) => {
            // Use a functional update so we always see the latest accumulated results
            // The actual count check happens after the next render, but we can
            // read 'incoming' + previous via a separate approach. Since we only
            // know "done" here without the accumulated total, we defer via a
            // separate effect below that watches (status, results) changes.
            return prev === 'searching' ? 'results' : prev;
          });
        }
      },
      receiveError(requestId: string, error: string) {
        if (requestId !== currentRequestIdRef.current) return; // stale — ignore
        setErrorMessage(error);
        setStatus('error');
      },
    }));

    // After status transitions to 'results', check whether we actually have any
    useEffect(() => {
      if (status === 'results' && results.length === 0) {
        setStatus('no-results');
      }
    }, [status, results.length]);

    // Debounced search trigger
    const handleQueryChange = useCallback(
      (text: string) => {
        setQuery(text);

        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current);
        }

        if (!text.trim()) {
          setStatus('idle');
          setResults([]);
          setErrorMessage('');
          currentRequestIdRef.current = null;
          return;
        }

        debounceTimerRef.current = setTimeout(() => {
          const requestId = Date.now().toString();
          currentRequestIdRef.current = requestId;
          setResults([]);
          setErrorMessage('');
          setStatus('searching');
          onSearch(text.trim(), requestId);
        }, 300);
      },
      [onSearch],
    );

    const handleClear = useCallback(() => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      setQuery('');
      setStatus('idle');
      setResults([]);
      setErrorMessage('');
      currentRequestIdRef.current = null;
    }, []);

    const handleRetry = useCallback(() => {
      if (!query.trim()) return;
      const requestId = Date.now().toString();
      currentRequestIdRef.current = requestId;
      setResults([]);
      setErrorMessage('');
      setStatus('searching');
      onSearch(query.trim(), requestId);
    }, [query, onSearch]);

    // Reset state when drawer closes
    useEffect(() => {
      if (!visible) {
        handleClear();
      }
    }, [visible, handleClear]);

    // Cleanup debounce timer on unmount
    useEffect(() => {
      return () => {
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current);
        }
      };
    }, []);

    // Status label text
    const statusText: string | null =
      status === 'searching'
        ? 'Searching…'
        : status === 'results'
        ? `${results.length} result${results.length !== 1 ? 's' : ''}`
        : null;

    const styles = useMemo(() => makeStyles(theme), [theme]);

    const renderItem = useCallback(
      ({ item }: { item: SearchResult }) => (
        <TouchableOpacity
          style={styles.resultRow}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${item.chapterTitle}: ${item.excerpt}`}
          onPress={() => {
            // Parent (Agent 3) will wire navigation via a separate prop if needed;
            // for now the press handler is left intentionally empty so the component
            // compiles cleanly — callers can wrap with an onResultPress prop later.
          }}
        >
          <Text style={styles.chapterLabel} numberOfLines={1}>
            {item.chapterTitle}
          </Text>
          <HighlightedExcerpt
            excerpt={item.excerpt}
            query={query}
            textColor={theme.colors.text}
            matchColor={theme.colors.primary}
          />
        </TouchableOpacity>
      ),
      [styles, query, theme.colors.text, theme.colors.primary],
    );

    const keyExtractor = useCallback((_: SearchResult, index: number) => String(index), []);

    return (
      <Modal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        {/* Backdrop */}
        <Animated.View
          style={[styles.backdrop, { opacity }]}
          pointerEvents={visible ? 'auto' : 'none'}
        >
          <TouchableWithoutFeedback onPress={onClose}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
        </Animated.View>

        {/* Panel */}
        <Animated.View
          pointerEvents={visible ? 'auto' : 'none'}
          style={[
            styles.panel,
            {
              paddingTop: insets.top,
              transform: [
                {
                  translateY: translate.interpolate({
                    inputRange: [-1, 0],
                    outputRange: [-900, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {/* Search input row */}
            <View style={styles.inputRow}>
              <Text style={styles.searchIcon}>{'🔍'}</Text>
              <TextInput
                ref={inputRef}
                style={styles.textInput}
                value={query}
                onChangeText={handleQueryChange}
                placeholder="Search in book…"
                placeholderTextColor={theme.colors.textSecondary}
                returnKeyType="search"
                autoFocus={false /* handled via ref.focus() in useEffect */}
                accessibilityLabel="Search in book"
                clearButtonMode="never"
                autoCorrect={false}
                autoCapitalize="none"
              />
              {query.length > 0 && (
                <TouchableOpacity
                  onPress={handleClear}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Clear search"
                >
                  <Text style={styles.clearButton}>{'✕'}</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Divider */}
            <View style={styles.divider} />

            {/* Status line */}
            {statusText !== null && (
              <Text
                style={styles.statusLine}
                accessibilityLiveRegion="polite"
              >
                {statusText}
              </Text>
            )}

            {/* Error state */}
            {status === 'error' && (
              <View style={styles.errorRow}>
                <Text style={styles.errorText}>{errorMessage}</Text>
                <TouchableOpacity onPress={handleRetry} style={styles.retryButton}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Empty / no-results state */}
            {status === 'no-results' && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyPrimary}>{`No results for “${query}”`}</Text>
                <Text style={styles.emptySecondary}>Try a different word or phrase.</Text>
              </View>
            )}

            {/* Results list */}
            {(status === 'results' || status === 'searching') && results.length > 0 && (
              <FlatList
                data={results}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                initialNumToRender={20}
                windowSize={5}
                keyboardShouldPersistTaps="handled"
                style={styles.list}
              />
            )}
          </KeyboardAvoidingView>
        </Animated.View>
      </Modal>
    );
  },
);

export default EpubSearchDrawer;

// ---------------------------------------------------------------------------
// Styles (theme-aware)
// ---------------------------------------------------------------------------

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.4)',
    },
    panel: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: theme.colors.background,
      borderBottomLeftRadius: 20,
      borderBottomRightRadius: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
      elevation: 12,
      maxHeight: '85%',
    },
    inputRow: {
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 16,
      marginTop: 12,
      marginBottom: 8,
      borderRadius: 8,
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 10,
      gap: 6,
    },
    searchIcon: {
      fontSize: 14,
    },
    textInput: {
      flex: 1,
      fontSize: theme.typography.fontSizeBody,
      color: theme.colors.text,
      paddingVertical: 0,
    },
    clearButton: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      paddingHorizontal: 4,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.border,
    },
    statusLine: {
      fontSize: theme.typography.fontSizeSmall,
      color: theme.colors.textSecondary,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 4,
    },
    list: {
      maxHeight: 420,
    },
    resultRow: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    chapterLabel: {
      fontSize: theme.typography.fontSizeSmall,
      color: theme.colors.textSecondary,
      marginBottom: 4,
    },
    errorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 12,
    },
    errorText: {
      flex: 1,
      fontSize: theme.typography.fontSizeSmall,
      color: theme.colors.error,
    },
    retryButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: theme.borderRadius.sm,
      borderWidth: 1,
      borderColor: theme.colors.error,
    },
    retryText: {
      fontSize: theme.typography.fontSizeSmall,
      color: theme.colors.error,
      fontWeight: '600',
    },
    emptyState: {
      padding: 32,
      alignItems: 'center',
    },
    emptyPrimary: {
      fontSize: theme.typography.fontSizeBody,
      color: theme.colors.text,
      fontWeight: '600',
      textAlign: 'center',
      marginBottom: 6,
    },
    emptySecondary: {
      fontSize: theme.typography.fontSizeSmall,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
  });
}
