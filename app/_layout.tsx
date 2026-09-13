import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../context/AuthContext';
import { CategoriesProvider } from '../context/CategoriesContext';
import { COLORS } from '../constants/theme';
import { ResponsiveContainer } from '../components/ResponsiveContainer';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <CategoriesProvider>
          <StatusBar style="light" />
          <ResponsiveContainer>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.bg } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="login" />
              <Stack.Screen name="register" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="input-expenses" options={{ presentation: 'modal' }} />
              <Stack.Screen name="admin/index" options={{ presentation: 'modal' }} />
            </Stack>
          </ResponsiveContainer>
        </CategoriesProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
