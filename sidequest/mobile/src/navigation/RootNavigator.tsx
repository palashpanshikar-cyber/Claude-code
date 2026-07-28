import React, { useState } from 'react';
import { View } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { SignupScreen } from '../screens/SignupScreen';
import { FeedScreen } from '../screens/FeedScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { Loading } from '../components/States';
import { colors } from '../theme/theme';

const Tab = createBottomTabNavigator();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    border: colors.border,
    text: colors.text,
    primary: colors.accent,
  },
};

/**
 * The whole gate: no user means the auth screens, full stop.
 *
 * Kept as a conditional rather than a navigate() call so there is no moment
 * where a signed-out user can go "back" into the app.
 */
export function RootNavigator() {
  const { user, loading } = useAuth();
  const [showSignup, setShowSignup] = useState(false);

  // Waiting on the stored token. Rendering login here would flash it at
  // returning users on every cold start.
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <Loading />
      </View>
    );
  }

  if (!user) {
    return showSignup ? (
      <SignupScreen onSwitch={() => setShowSignup(false)} />
    ) : (
      <LoginScreen onSwitch={() => setShowSignup(true)} />
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        }}
      >
        <Tab.Screen
          name="Quests"
          component={FeedScreen}
          options={{ tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🗺️</Text> }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileScreen}
          options={{ tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>👤</Text> }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
