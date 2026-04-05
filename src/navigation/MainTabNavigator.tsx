import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MainTabParamList, LibraryStackParamList } from './types';
import LibraryScreen from '@/screens/library/LibraryScreen';
import BookDetailScreen from '@/screens/library/BookDetailScreen';
import ReaderScreen from '@/screens/reader/ReaderScreen';
import PlayerScreen from '@/screens/player/PlayerScreen';
import SettingsScreen from '@/screens/settings/SettingsScreen';

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

// ── Main tab navigator ───────────────────────────────────────────────────────

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator() {
  return (
    <Tab.Navigator
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
        name="Player"
        component={PlayerScreen}
        options={{ title: 'Player', headerShown: true }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings', headerShown: true }}
      />
    </Tab.Navigator>
  );
}
