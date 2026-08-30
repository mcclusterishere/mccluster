/**
 * The root of the app.
 *
 * One transport wraps everything, so the deck survives navigation — leaving
 * a track room does not stop the song. The stack is native (expo-router sits
 * on react-native-screens), which is where the platform's own push, back
 * gesture and header transitions come from.
 *
 * Nothing renders before the house's own fonts (Anton, Archivo) are loaded.
 * Rendering a frame on the system font first and swapping to Anton a moment
 * later reads as a glitch and undoes the whole point of loading it — better
 * to hold the splash screen the extra beat.
 */
import React, { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { TransportProvider } from '../src/player';
import { color } from '../src/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Anton: require('../assets/fonts/Anton.ttf'),
    'Archivo-Regular': require('../assets/fonts/Archivo-Regular.ttf'),
    'Archivo-Medium': require('../assets/fonts/Archivo-Medium.ttf'),
    'Archivo-Bold': require('../assets/fonts/Archivo-Bold.ttf'),
  });

  const ready = fontsLoaded || !!fontError;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.stage }}>
      <SafeAreaProvider>
        <TransportProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: color.stage },
              /* the record's rooms come up from the bottom, the way a Now
                 Playing screen does on every platform that has one */
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="track/[slug]"
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
          </Stack>
        </TransportProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
