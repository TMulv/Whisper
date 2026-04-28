import React from 'react';
import { View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList, AuthStackParamList } from './types';
import MainTabNavigator from './MainTabNavigator';
import SignInScreen from '@/screens/auth/SignInScreen';
import SignUpScreen from '@/screens/auth/SignUpScreen';
import BookSessionScreen from '@/screens/book/BookSessionScreen';
import { AnimatedLoader } from '@/components/common/AnimatedLoader';
import { useAuth } from '@/hooks/useAuth';

const Root = createNativeStackNavigator<RootStackParamList>();
const Auth = createNativeStackNavigator<AuthStackParamList>();

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
        <AnimatedLoader
          variant="random"
          color="#C9A96E"
          accent="#F0E6D4"
          size={72}
          message="Opening your library"
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
    backgroundColor: '#09090F',
  },
});
