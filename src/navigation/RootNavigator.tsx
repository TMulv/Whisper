import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList, AuthStackParamList } from './types';
import MainTabNavigator from './MainTabNavigator';
import SignInScreen from '@/screens/auth/SignInScreen';
import SignUpScreen from '@/screens/auth/SignUpScreen';
import BookSessionScreen from '@/screens/book/BookSessionScreen';
import { useAuth } from '@/hooks/useAuth';

const Root = createNativeStackNavigator<RootStackParamList>();
const Auth = createNativeStackNavigator<AuthStackParamList>();

const LOADING_VIDEO_SOURCE = Platform.select({
  ios: require('../../assets/moe-transparent.mp4'),
  default: require('../../assets/moe-transparent.webm'),
});

function AuthStack() {
  return (
    <Auth.Navigator screenOptions={{ headerShown: false }}>
      <Auth.Screen name="SignIn" component={SignInScreen} />
      <Auth.Screen name="SignUp" component={SignUpScreen} />
    </Auth.Navigator>
  );
}

export default function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.loading}>
        <Video
          source={LOADING_VIDEO_SOURCE}
          style={styles.loadingVideo}
          resizeMode={ResizeMode.CONTAIN}
          shouldPlay
          isLooping
          isMuted
        />
      </View>
    );
  }

  return (
    <Root.Navigator screenOptions={{ headerShown: false }}>
      {user ? (
        <>
          <Root.Screen name="Main" component={MainTabNavigator} />
          <Root.Screen
            name="BookSession"
            component={BookSessionScreen}
            options={{ animation: 'fade' }}
          />
        </>
      ) : (
        <Root.Screen name="Auth" component={AuthStack} />
      )}
    </Root.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  loadingVideo: {
    width: 280,
    height: 280,
  },
});
