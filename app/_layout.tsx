import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { Hind_500Medium } from '@expo-google-fonts/hind';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../context/AuthContext';
import { CategoriesProvider } from '../context/CategoriesContext';
import { COLORS, SCHEME } from '../constants/theme';
import { ResponsiveContainer } from '../components/ResponsiveContainer';

// Keep the splash up until the brand fonts are ready, so text never
// flashes in the system font first.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_700Bold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
    Hind_500Medium,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  // A font that fails to load falls back to the system font rather than
  // blocking the app.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <CategoriesProvider>
          <StatusBar style={SCHEME === 'dark' ? 'light' : 'dark'} />
          <ResponsiveContainer>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.bg } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="login" />
              <Stack.Screen name="register" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="input-expenses" options={{ presentation: 'modal' }} />
              <Stack.Screen name="admin/index" options={{ presentation: 'modal' }} />
              <Stack.Screen name="admin/audit-log" />
              <Stack.Screen name="admin/metrics" />
              <Stack.Screen name="admin/features" />
              <Stack.Screen name="settings" />
              <Stack.Screen name="accounts" />
              <Stack.Screen name="budgets" />
              <Stack.Screen name="free-money-day" />
              <Stack.Screen name="people/index" />
              <Stack.Screen name="people/[id]" />
              <Stack.Screen name="people/split" />
              <Stack.Screen name="forgot-password" />
              <Stack.Screen name="reset-password" />
              <Stack.Screen name="verify-email" />
              <Stack.Screen name="report-issue" options={{ presentation: 'modal' }} />
              <Stack.Screen name="legal/terms" />
              <Stack.Screen name="legal/privacy" />
            </Stack>
          </ResponsiveContainer>
        </CategoriesProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
