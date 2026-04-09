import React from 'react';
import { View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BottomTabBar, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MainTabParamList, LibraryStackParamList } from './types';
import LibraryScreen from '@/screens/library/LibraryScreen';
import BookDetailScreen from '@/screens/library/BookDetailScreen';
import ReaderScreen from '@/screens/reader/ReaderScreen';
import SettingsScreen from '@/screens/settings/SettingsScreen';
import MiniPlayer from '@/components/player/MiniPlayer';
import { useNowPlaying } from '@/context/NowPlayingContext';

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
      <LibraryStack.Screen
        name="Reader"
        component={ReaderScreen}
        options={{ headerShown: false }}
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
      <BottomTabBar {...props} />
    </View>
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
        tabBarInactiveTintColor: '#999',
        tabBarStyle: { borderTopColor: '#E8E8E8' },
      }}
    >
      <Tab.Screen
        name="Library"
        component={LibraryNavigator}
        options={{ title: 'Library' }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings', headerShown: true }}
      />
    </Tab.Navigator>
  );
}
