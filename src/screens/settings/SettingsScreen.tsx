import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { ThemeName } from '@/constants/theme';
import {
  isAuthenticated as isDropboxAuthenticated,
  authenticate as dropboxAuth,
  clearTokens as clearDropboxTokens,
} from '@/services/storage/dropboxService';
import { getStorageStats } from '@/services/storage/localStorageService';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { themeName, setTheme } = useTheme();

  const [dropboxConnected, setDropboxConnected] = useState(false);
  const [dropboxLoading, setDropboxLoading] = useState(false);
  const [cacheStats, setCacheStats] = useState<{ totalMb: number; fileCount: number } | null>(null);

  useEffect(() => {
    isDropboxAuthenticated().then(setDropboxConnected);
    getStorageStats().then(setCacheStats);
  }, []);

  const handleDropboxToggle = async () => {
    setDropboxLoading(true);
    try {
      if (dropboxConnected) {
        await clearDropboxTokens();
        setDropboxConnected(false);
      } else {
        const success = await dropboxAuth();
        setDropboxConnected(success);
        if (!success) Alert.alert('Dropbox', 'Connection was cancelled or failed.');
      }
    } catch (err) {
      Alert.alert('Error', 'Dropbox connection failed.');
    } finally {
      setDropboxLoading(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const THEMES: { value: ThemeName; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'eink', label: 'E-ink' },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
    >
      {/* Account */}
      <SettingsSection title="Account">
        <SettingsRow label="Email" value={user?.email ?? '—'} />
        <TouchableOpacity style={styles.destructiveRow} onPress={handleSignOut}>
          <Text style={styles.destructiveText}>Sign Out</Text>
        </TouchableOpacity>
      </SettingsSection>

      {/* Display */}
      <SettingsSection title="Display">
        <Text style={styles.rowLabel}>Theme</Text>
        <View style={styles.themeRow}>
          {THEMES.map((t) => (
            <TouchableOpacity
              key={t.value}
              style={[styles.themeChip, themeName === t.value && styles.themeChipActive]}
              onPress={() => setTheme(t.value)}
              activeOpacity={0.75}
            >
              <Text style={[styles.themeChipText, themeName === t.value && styles.themeChipTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </SettingsSection>

      {/* Storage */}
      <SettingsSection title="Storage">
        <SettingsRow
          label="Cache size"
          value={cacheStats ? `${cacheStats.totalMb.toFixed(1)} MB (${cacheStats.fileCount} files)` : '…'}
        />
      </SettingsSection>

      {/* Dropbox */}
      <SettingsSection title="Dropbox">
        <View style={styles.serviceRow}>
          <View>
            <Text style={styles.serviceLabel}>Dropbox</Text>
            <Text style={styles.serviceStatus}>
              {dropboxConnected ? 'Connected' : 'Not connected'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.serviceBtn, dropboxConnected && styles.serviceBtnDisconnect]}
            onPress={handleDropboxToggle}
            disabled={dropboxLoading}
            activeOpacity={0.8}
          >
            {dropboxLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.serviceBtnText}>
                {dropboxConnected ? 'Disconnect' : 'Connect'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </SettingsSection>

      {/* iCloud (iOS only) */}
      {Platform.OS === 'ios' && (
        <SettingsSection title="iCloud Drive">
          <Text style={styles.icloudNote}>
            iCloud Drive access is granted automatically when you pick a file from the Files app.
          </Text>
        </SettingsSection>
      )}
    </ScrollView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );
}

function SettingsRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },
  content: { paddingTop: 16 },
  section: { marginBottom: 24, paddingHorizontal: 20 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  sectionContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
    gap: 12,
  },
  rowLabel: { fontSize: 15, color: '#1A1A1A', fontWeight: '500' },
  rowValue: { fontSize: 15, color: '#888', flex: 1, textAlign: 'right' },
  destructiveRow: { paddingVertical: 13 },
  destructiveText: { fontSize: 15, color: '#C62828', fontWeight: '500' },

  // Theme picker
  themeRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 12,
  },
  themeChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F0F0F0',
  },
  themeChipActive: { backgroundColor: '#1A1A2E' },
  themeChipText: { fontSize: 14, color: '#555', fontWeight: '500' },
  themeChipTextActive: { color: '#fff' },

  // Service row
  serviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  serviceLabel: { fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  serviceStatus: { fontSize: 13, color: '#888', marginTop: 2 },
  serviceBtn: {
    backgroundColor: '#1A1A2E',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 90,
    alignItems: 'center',
  },
  serviceBtnDisconnect: { backgroundColor: '#B71C1C' },
  serviceBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  icloudNote: { fontSize: 13, color: '#888', lineHeight: 20, paddingVertical: 12 },
});
