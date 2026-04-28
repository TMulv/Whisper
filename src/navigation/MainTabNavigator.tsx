import React from 'react';
import { View, Pressable, StyleSheet, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BottomTabBar, BottomTabBarProps, BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MainTabParamList, LibraryStackParamList } from './types';
import LibraryScreen from '@/screens/library/LibraryScreen';
import BookDetailScreen from '@/screens/library/BookDetailScreen';
import SettingsScreen from '@/screens/settings/SettingsScreen';
import MiniPlayer from '@/components/player/MiniPlayer';
import { useNowPlaying } from '@/context/NowPlayingContext';
import { LibraryIcon, SettingsIcon } from '@/components/navigation/TabIcons';

// ── Library stack (Library → BookDetail → Reader) ────────────────────────────

const LibraryStack = createNativeStackNavigator<LibraryStackParamList>();

function LibraryNavigator() {
  return (
    <LibraryStack.Navigator>
      <LibraryStack.Screen
        name="LibraryHome"
        component={LibraryScreen}
        options={{ title: 'Library' }}
      />
      <LibraryStack.Screen
        name="BookDetail"
        component={BookDetailScreen}
        options={{ title: 'Book', headerBackTitle: 'Library' }}
      />
    </LibraryStack.Navigator>
  );
}

// ── Custom tab bar with floating MiniPlayer ──────────────────────────────────

function CustomTabBar(props: BottomTabBarProps) {
  const { book } = useNowPlaying();
  return (
    <View>
      {book && <MiniPlayer />}
      <View style={styles.barTopAccent} />
      <BottomTabBar {...props} />
    </View>
  );
}

// ── Add-tab placeholder (never actually rendered; tabPress is intercepted) ──

function AddTabPlaceholder() {
  return null;
}

// ── Raised Pair FAB — sits in the visual center, above the tab bar ───────────

function PairFab({ onPress, onLongPress, accessibilityState }: BottomTabBarButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityState={accessibilityState}
      accessibilityRole="button"
      accessibilityLabel="Pair audiobook and ebook"
      style={({ pressed }) => [
        styles.fabWrap,
        pressed && styles.fabWrapPressed,
      ]}
      hitSlop={8}
    >
      <View style={styles.fabHalo} />
      <View style={styles.fabCore}>
        <View style={styles.plusH} />
        <View style={styles.plusV} />
      </View>
    </Pressable>
  );
}

// ── Main tab navigator ───────────────────────────────────────────────────────

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#1A1A2E',
        tabBarInactiveTintColor: '#B5B0A8',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
          letterSpacing: 0.4,
          marginTop: 2,
        },
        tabBarStyle: {
          borderTopWidth: 0,
          backgroundColor: '#FAF7F1',
          height: 64 + (Platform.OS === 'ios' ? 18 : 0),
          paddingTop: 6,
        },
      }}
    >
      <Tab.Screen
        name="Library"
        component={LibraryNavigator}
        options={{
          title: 'Library',
          tabBarIcon: ({ focused }) => <LibraryIcon focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Add"
        component={AddTabPlaceholder}
        options={{
          tabBarLabel: () => null,
          tabBarIcon: () => <View style={styles.fabSpacer} />,
          tabBarAccessibilityLabel: 'Pair audiobook and ebook',
          tabBarButton: (props) => <PairFab {...props} />,
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate('Library', {
              screen: 'LibraryHome',
              params: { openAdd: Date.now() },
            });
          },
        })}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          headerShown: true,
          tabBarIcon: ({ focused }) => <SettingsIcon focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  barTopAccent: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E8E0D2',
  },
  fabSpacer: {
    width: 48,
    height: 48,
  },
  fabWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 0,
  },
  fabWrapPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
  fabHalo: {
    position: 'absolute',
    top: -18,
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FAF7F1',
  },
  fabCore: {
    position: 'absolute',
    top: -14,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#C9A96E',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3A2A10',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#A7874A',
  },
  plusH: {
    position: 'absolute',
    width: 22,
    height: 2.5,
    borderRadius: 1.5,
    backgroundColor: '#09090F',
  },
  plusV: {
    position: 'absolute',
    width: 2.5,
    height: 22,
    borderRadius: 1.5,
    backgroundColor: '#09090F',
  },
});
