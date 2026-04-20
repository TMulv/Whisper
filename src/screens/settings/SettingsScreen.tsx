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
  TextInput,
  KeyboardAvoidingView,
  Switch,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { ThemeName } from '@/constants/theme';
import {
  isAuthenticated as isGDriveAuthenticated,
  authenticate as gdriveAuth,
  clearTokens as clearGDriveTokens,
} from '@/services/storage/googleDriveService';
import {
  isAuthenticated as isNextcloudAuthenticated,
  saveCredentials as saveNextcloudCredentials,
  clearCredentials as clearNextcloudCredentials,
  testConnection as testNextcloudConnection,
} from '@/services/storage/nextcloudService';
import { getStorageStats } from '@/services/storage/localStorageService';

const ICLOUD_ENABLED_KEY = '@whisper/icloud_enabled';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { themeName, setTheme } = useTheme();

  const [cacheStats, setCacheStats] = useState<{ totalMb: number; fileCount: number } | null>(null);

  // Google Drive
  const [gdriveConnected, setGdriveConnected] = useState(false);
  const [gdriveLoading, setGdriveLoading] = useState(false);

  // Nextcloud
  const [nextcloudConnected, setNextcloudConnected] = useState(false);
  const [nextcloudLoading, setNextcloudLoading] = useState(false);
  const [showNextcloudForm, setShowNextcloudForm] = useState(false);
  const [ncServer, setNcServer] = useState('');
  const [ncUsername, setNcUsername] = useState('');
  const [ncPassword, setNcPassword] = useState('');

  // iCloud (iOS only)
  const [icloudEnabled, setIcloudEnabled] = useState(false);

  useEffect(() => {
    isGDriveAuthenticated().then(setGdriveConnected);
    isNextcloudAuthenticated().then(setNextcloudConnected);
    getStorageStats().then(setCacheStats);
    if (Platform.OS === 'ios') {
      AsyncStorage.getItem(ICLOUD_ENABLED_KEY).then((v) => setIcloudEnabled(v === 'true'));
    }
  }, []);

  // ── Google Drive ─────────────────────────────────────────────────────────────

  const handleGDriveToggle = async () => {
    setGdriveLoading(true);
    try {
      if (gdriveConnected) {
        await clearGDriveTokens();
        setGdriveConnected(false);
      } else {
        const success = await gdriveAuth();
        setGdriveConnected(success);
        if (!success) Alert.alert('Google Drive', 'Connection was cancelled or failed.');
      }
    } catch {
      Alert.alert('Error', 'Google Drive connection failed.');
    } finally {
      setGdriveLoading(false);
    }
  };

  // ── Nextcloud ────────────────────────────────────────────────────────────────

  const handleNextcloudConnect = async () => {
    const server = ncServer.trim();
    const username = ncUsername.trim();
    const pass = ncPassword.trim();
    if (!server || !username || !pass) {
      Alert.alert('Missing Fields', 'Please fill in all three fields.');
      return;
    }
    setNextcloudLoading(true);
    try {
      const result = await testNextcloudConnection(server, username, pass);
      if (!result.ok) {
        Alert.alert('Connection Failed', result.error ?? 'Could not connect to Nextcloud.');
        return;
      }
      await saveNextcloudCredentials(server, username, pass);
      setNextcloudConnected(true);
      setShowNextcloudForm(false);
      setNcServer('');
      setNcUsername('');
      setNcPassword('');
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Connection failed.');
    } finally {
      setNextcloudLoading(false);
    }
  };

  const handleNextcloudDisconnect = async () => {
    await clearNextcloudCredentials();
    setNextcloudConnected(false);
  };

  // ── iCloud ───────────────────────────────────────────────────────────────────

  const handleICloudToggle = async (value: boolean) => {
    setIcloudEnabled(value);
    await AsyncStorage.setItem(ICLOUD_ENABLED_KEY, value ? 'true' : 'false');
  };

  // ── Sign out ─────────────────────────────────────────────────────────────────

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
      keyboardShouldPersistTaps="handled"
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

      {/* Google Drive */}
      <SettingsSection title="Google Drive">
        <ServiceRow
          label="Google Drive"
          connected={gdriveConnected}
          loading={gdriveLoading}
          onToggle={handleGDriveToggle}
        />
        {!gdriveConnected && (
          <Text style={styles.serviceHint}>
            Place books in a "Books" folder in your Google Drive. Each sub-folder should contain one .epub and one audio file.
          </Text>
        )}
      </SettingsSection>

      {/* Nextcloud */}
      <SettingsSection title="Nextcloud">
        {nextcloudConnected ? (
          <ServiceRow
            label="Nextcloud"
            connected
            loading={false}
            onToggle={handleNextcloudDisconnect}
          />
        ) : showNextcloudForm ? (
          <KeyboardAvoidingView behavior="padding">
            <Text style={styles.serviceHint}>
              Use an app password from Nextcloud Settings → Security → App passwords.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Server URL (https://cloud.example.com)"
              placeholderTextColor="#AAA"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              value={ncServer}
              onChangeText={setNcServer}
            />
            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor="#AAA"
              autoCapitalize="none"
              autoCorrect={false}
              value={ncUsername}
              onChangeText={setNcUsername}
            />
            <TextInput
              style={styles.input}
              placeholder="App password"
              placeholderTextColor="#AAA"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={ncPassword}
              onChangeText={setNcPassword}
            />
            <View style={styles.formBtns}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowNextcloudForm(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.serviceBtn, nextcloudLoading && styles.btnDisabled]}
                onPress={handleNextcloudConnect}
                disabled={nextcloudLoading}
                activeOpacity={0.8}
              >
                {nextcloudLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.serviceBtnText}>Connect</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        ) : (
          <>
            <View style={styles.serviceRow}>
              <View>
                <Text style={styles.serviceLabel}>Nextcloud</Text>
                <Text style={styles.serviceStatus}>Not connected</Text>
              </View>
              <TouchableOpacity
                style={styles.serviceBtn}
                onPress={() => setShowNextcloudForm(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.serviceBtnText}>Connect</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.serviceHint}>
              Place books in a "Books" folder on your Nextcloud. Each sub-folder should contain one .epub and one audio file.
            </Text>
          </>
        )}
      </SettingsSection>

      {/* iCloud Drive (iOS only) */}
      {Platform.OS === 'ios' && (
        <SettingsSection title="iCloud Drive">
          <View style={styles.switchRow}>
            <View>
              <Text style={styles.serviceLabel}>iCloud Drive</Text>
              <Text style={styles.serviceStatus}>
                {icloudEnabled ? 'Enabled' : 'Disabled'}
              </Text>
            </View>
            <Switch
              value={icloudEnabled}
              onValueChange={handleICloudToggle}
              trackColor={{ false: '#D0D0D0', true: '#1A1A2E' }}
              thumbColor="#fff"
            />
          </View>
          {icloudEnabled && (
            <Text style={styles.serviceHint}>
              Place books in an "iCloud Drive / Whisper / Books" folder. Each sub-folder should contain one .epub and one audio file.
            </Text>
          )}
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

function ServiceRow({
  label,
  connected,
  loading,
  onToggle,
}: {
  label: string;
  connected: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.serviceRow}>
      <View>
        <Text style={styles.serviceLabel}>{label}</Text>
        <Text style={styles.serviceStatus}>{connected ? 'Connected' : 'Not connected'}</Text>
      </View>
      <TouchableOpacity
        style={[styles.serviceBtn, connected && styles.serviceBtnDisconnect]}
        onPress={onToggle}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.serviceBtnText}>{connected ? 'Disconnect' : 'Connect'}</Text>
        )}
      </TouchableOpacity>
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

  themeRow: { flexDirection: 'row', gap: 8, paddingVertical: 12 },
  themeChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F0F0F0',
  },
  themeChipActive: { backgroundColor: '#1A1A2E' },
  themeChipText: { fontSize: 14, color: '#555', fontWeight: '500' },
  themeChipTextActive: { color: '#fff' },

  serviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
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
  serviceHint: {
    fontSize: 12,
    color: '#999',
    lineHeight: 17,
    paddingBottom: 12,
  },

  input: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1A1A1A',
    marginBottom: 8,
    backgroundColor: '#FAFAFA',
  },
  formBtns: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingTop: 4,
    paddingBottom: 8,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D0D0D0',
    alignItems: 'center',
  },
  cancelBtnText: { color: '#555', fontWeight: '500', fontSize: 14 },
  btnDisabled: { opacity: 0.6 },
});
