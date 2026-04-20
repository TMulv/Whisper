import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BottomTabBar, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { MainTabParamList, LibraryStackParamList } from './types';
import LibraryScreen from '@/screens/library/LibraryScreen';
import BookDetailScreen from '@/screens/library/BookDetailScreen';
import ReaderScreen from '@/screens/reader/ReaderScreen';
import SettingsScreen from '@/screens/settings/SettingsScreen';
import FilesScreen from '@/screens/files/FilesScreen';
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

// ── Add-tab placeholder (never actually rendered; tabPress is intercepted) ──

function AddTabPlaceholder() {
  return null;
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
        name="Files"
        component={FilesScreen}
        options={{ title: 'Files' }}
      />
      <Tab.Screen
        name="Add"
        component={AddTabPlaceholder}
        options={{
          tabBarLabel: 'Pair',
          tabBarIcon: () => (
            <View style={styles.addIcon}>
              <Text style={styles.addIconText}>+</Text>
            </View>
          ),
          tabBarAccessibilityLabel: 'Pair audiobook and ebook',
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
        options={{ title: 'Settings', headerShown: true }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  addIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#C9A96E',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -4,
  },
  addIconText: {
    color: '#09090F',
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '300',
  },
});
