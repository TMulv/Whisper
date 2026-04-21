import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AI_PROMPTS, type AIPromptId } from '@/services/ai/aiPrompts';
import { runPrompt, AIError } from '@/services/ai/aiService';
import { hasApiKey } from '@/services/ai/aiStorage';

const C = {
  bg: '#0E0E18',
  surface: '#17172A',
  surfaceHigh: '#20203A',
  border: '#2A2A44',
  gold: '#C9A96E',
  goldDim: '#6A5832',
  text: '#F0E6D4',
  textMuted: '#9A8E82',
  textFaint: '#5A5044',
  red: '#E85555',
  accent: '#6B9FD4',
};

export interface AIChapterContext {
  bookTitle: string;
  author: string;
  chapterTitle: string;
  chapterIndex: number;
  totalChapters: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  chapterContext: AIChapterContext;
  /**
   * Returns the plain-text of the chapter (or concatenated chapters) to feed
   * the AI for the active prompt. Receives the prompt id so the caller can
   * load different text for "story so far" vs "jump ahead" vs a chapter recap.
   * Return null for metadata-only reasoning.
   */
  loadChapterText?: (promptId: AIPromptId) => Promise<string | null>;
  onOpenSettings?: () => void;
  /**
   * When set, the modal skips the prompt menu and auto-runs this prompt as
   * soon as it opens. Back button closes the modal instead of returning to
   * the menu.
   */
  autoRunPromptId?: AIPromptId;
}

type ModalView = 'menu' | 'result';

export default function AIInsightsModal({
  visible,
  onClose,
  chapterContext,
  loadChapterText,
  onOpenSettings,
  autoRunPromptId,
}: Props) {
  const insets = useSafeAreaInsets();

  const [view, setView] = useState<ModalView>('menu');
  const [keyPresent, setKeyPresent] = useState<boolean | null>(null);
  const [activePromptId, setActivePromptId] = useState<AIPromptId | null>(null);
  const [promptLabel, setPromptLabel] = useState<string>('');
  const [customQuestion, setCustomQuestion] = useState('');
  const [response, setResponse] = useState('');
  const [running, setRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fetchingText, setFetchingText] = useState(false);
  const [textSource, setTextSource] = useState<'chapter' | 'metadata'>('metadata');

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!visible) return;
    hasApiKey().then(setKeyPresent);
  }, [visible]);

  // Reset when modal closes
  useEffect(() => {
    if (visible) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setView('menu');
    setActivePromptId(null);
    setResponse('');
    setRunning(false);
    setErrorMsg(null);
    setFetchingText(false);
    setCustomQuestion('');
  }, [visible]);

  const startPrompt = useCallback(
    async (id: AIPromptId, userQuestion?: string) => {
      const spec = AI_PROMPTS.find((p) => p.id === id);
      if (!spec) return;
      setActivePromptId(id);
      setPromptLabel(spec.title);
      setResponse('');
      setErrorMsg(null);
      setView('result');

      let chapterText: string | null = null;
      if (loadChapterText) {
        try {
          setFetchingText(true);
          chapterText = await loadChapterText(id);
        } catch {
          chapterText = null;
        } finally {
          setFetchingText(false);
        }
      }
      setTextSource(chapterText ? 'chapter' : 'metadata');

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      setRunning(true);

      try {
        await runPrompt({
          promptId: id,
          context: {
            ...chapterContext,
            chapterText,
            userQuestion,
          },
          signal: controller.signal,
          onChunk: (chunk) => {
            if (chunk.type === 'text' && chunk.text) {
              setResponse((prev) => prev + chunk.text);
            }
          },
        });
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return;
        if (err instanceof AIError) {
          setErrorMsg(err.message);
        } else {
          setErrorMsg('Something went wrong. Try again.');
        }
      } finally {
        setRunning(false);
      }
    },
    [chapterContext, loadChapterText],
  );

  // Auto-run a prompt when modal opens with autoRunPromptId set
  useEffect(() => {
    if (!visible || !autoRunPromptId || keyPresent !== true) return;
    if (activePromptId === autoRunPromptId) return;
    startPrompt(autoRunPromptId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, keyPresent, autoRunPromptId]);

  const handleBack = () => {
    abortRef.current?.abort();
    if (autoRunPromptId) {
      // In auto-run mode there is no menu to go back to — close instead.
      onClose();
      return;
    }
    setView('menu');
    setResponse('');
    setErrorMsg(null);
    setActivePromptId(null);
  };

  const regenerate = () => {
    if (!activePromptId) return;
    startPrompt(activePromptId, activePromptId === 'custom' ? customQuestion : undefined);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} onPress={onClose} activeOpacity={1} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            {view === 'result' ? (
              <TouchableOpacity
                onPress={handleBack}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={styles.headerLeft}
              >
                <Text style={styles.backArrow}>‹</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.headerLeft} />
            )}
            <Text style={styles.headerTitle}>
              {view === 'menu' ? 'Insights' : promptLabel}
            </Text>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={styles.headerRight}
            >
              <Text style={styles.closeIcon}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.contextHint} numberOfLines={1}>
            Ch. {chapterContext.chapterIndex + 1}
            {chapterContext.chapterTitle ? ` · ${chapterContext.chapterTitle}` : ''}
          </Text>

          {/* API key gate */}
          {keyPresent === false && (
            <View style={styles.keyGate}>
              <Text style={styles.keyGateTitle}>Add an AI API key</Text>
              <Text style={styles.keyGateBody}>
                Insights need a key from Claude, ChatGPT, or Gemini. Pick a provider in Settings and paste your key — you only pay for what you use (pennies per chapter).
              </Text>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => {
                  onClose();
                  onOpenSettings?.();
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryBtnText}>Open Settings</Text>
              </TouchableOpacity>
            </View>
          )}

          {keyPresent && view === 'menu' && (
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              keyboardVerticalOffset={40}
            >
              <ScrollView
                style={styles.menuScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {AI_PROMPTS.filter((p) => p.id !== 'custom').map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.promptCard}
                    onPress={() => startPrompt(p.id)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.promptIcon}>{p.icon}</Text>
                    <View style={styles.promptText}>
                      <Text style={styles.promptTitle}>{p.title}</Text>
                      <Text style={styles.promptDesc}>{p.description}</Text>
                    </View>
                    <Text style={styles.chev}>›</Text>
                  </TouchableOpacity>
                ))}

                {/* Custom prompt input */}
                <View style={styles.customCard}>
                  <Text style={styles.customLabel}>Ask anything about this chapter</Text>
                  <TextInput
                    style={styles.customInput}
                    placeholder="e.g. Why did she lie to him?"
                    placeholderTextColor={C.textFaint}
                    value={customQuestion}
                    onChangeText={setCustomQuestion}
                    multiline
                  />
                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      !customQuestion.trim() && styles.btnDisabled,
                    ]}
                    onPress={() => startPrompt('custom', customQuestion)}
                    disabled={!customQuestion.trim()}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.primaryBtnText}>Ask</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ height: 16 }} />
              </ScrollView>
            </KeyboardAvoidingView>
          )}

          {keyPresent && view === 'result' && (
            <ScrollView
              style={styles.resultScroll}
              contentContainerStyle={styles.resultContent}
              keyboardShouldPersistTaps="handled"
            >
              {fetchingText && (
                <View style={styles.statusRow}>
                  <ActivityIndicator size="small" color={C.gold} />
                  <Text style={styles.statusText}>Reading the chapter…</Text>
                </View>
              )}
              {!fetchingText && running && response.length === 0 && (
                <View style={styles.statusRow}>
                  <ActivityIndicator size="small" color={C.gold} />
                  <Text style={styles.statusText}>Thinking…</Text>
                </View>
              )}

              {response.length > 0 && (
                <>
                  <Text style={styles.responseText}>{response}</Text>
                  {running && <Text style={styles.caret}>▎</Text>}
                </>
              )}

              {!running && !errorMsg && response.length > 0 && textSource === 'metadata' && (
                <Text style={styles.footnote}>
                  * The ebook wasn't open, so Claude answered from book metadata and general knowledge. For best results, open the reader first.
                </Text>
              )}

              {errorMsg && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
              )}

              {!running && (response.length > 0 || errorMsg) && (
                <View style={styles.resultActions}>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={regenerate} activeOpacity={0.8}>
                    <Text style={styles.secondaryBtnText}>Try again</Text>
                  </TouchableOpacity>
                  {!autoRunPromptId && (
                    <TouchableOpacity style={styles.secondaryBtn} onPress={handleBack} activeOpacity={0.8}>
                      <Text style={styles.secondaryBtnText}>New prompt</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  backdropTap: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    paddingTop: 8,
    paddingHorizontal: 20,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.surfaceHigh,
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerLeft: { width: 40, alignItems: 'flex-start' },
  headerRight: { width: 40, alignItems: 'flex-end' },
  backArrow: { color: C.text, fontSize: 26, fontWeight: '300', lineHeight: 28 },
  closeIcon: { color: C.textMuted, fontSize: 18 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: C.text,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  contextHint: {
    color: C.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
  },

  keyGate: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 20,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  keyGateTitle: { color: C.text, fontSize: 16, fontWeight: '700', marginBottom: 6 },
  keyGateBody: { color: C.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 14 },

  menuScroll: { maxHeight: '100%' },
  promptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  promptIcon: { fontSize: 22, marginRight: 14 },
  promptText: { flex: 1 },
  promptTitle: { color: C.text, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  promptDesc: { color: C.textMuted, fontSize: 12, lineHeight: 17 },
  chev: { color: C.textFaint, fontSize: 22, marginLeft: 6 },

  customCard: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  customLabel: {
    color: C.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  customInput: {
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontSize: 14,
    minHeight: 70,
    textAlignVertical: 'top',
    marginBottom: 10,
  },

  primaryBtn: {
    backgroundColor: C.gold,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: C.bg, fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  btnDisabled: { opacity: 0.4 },

  resultScroll: { flexGrow: 0 },
  resultContent: { paddingVertical: 12, paddingBottom: 40 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 24,
    justifyContent: 'center',
  },
  statusText: { color: C.textMuted, fontSize: 13, marginLeft: 10 },

  responseText: {
    color: C.text,
    fontSize: 15,
    lineHeight: 23,
  },
  caret: { color: C.gold, fontSize: 15, lineHeight: 23 },
  footnote: {
    color: C.textFaint,
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 20,
    lineHeight: 16,
  },

  errorBox: {
    backgroundColor: 'rgba(232, 85, 85, 0.12)',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(232, 85, 85, 0.35)',
    marginTop: 10,
  },
  errorText: { color: C.red, fontSize: 13, lineHeight: 19 },

  resultActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  secondaryBtnText: { color: C.text, fontSize: 13, fontWeight: '600' },
});
