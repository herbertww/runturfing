// Must run before anything pulls in h3-js: Hermes has no utf-16le decoder.
import '../src/utils/textDecoderShim';
import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FlashMessage from 'react-native-flash-message';
import { StripeProvider } from '@stripe/stripe-react-native';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuthStore } from '../src/stores/authStore';
import BrandSplash from '../src/components/BrandSplash';
import { configurePurchases, identifyPurchaser } from '../src/services/purchases';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
    },
  },
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function RootLayout() {
  const { isHydrated, user } = useAuthStore();
  const [fontsLoaded, fontError] = useFonts({ ...Ionicons.font });
  const [splashDone, setSplashDone] = useState(false);

  // Fonts settling counts even when it fails — a font that never arrives should
  // degrade to missing icons, not leave the app stuck behind the splash.
  const ready = isHydrated && Boolean(fontsLoaded || fontError);

  useEffect(() => {
    // Hand off to <BrandSplash /> as soon as React can paint. Both draw the
    // same mark on the same paper, so the swap is invisible; the wait itself is
    // then carried by a screen we control, which is where the wordmark and the
    // riso plate can live.
    SplashScreen.hideAsync().catch(() => {});
    configurePurchases();
  }, []);

  // RevenueCat customers carry our user id, so a bounty purchase can be matched
  // to the season entry on the backend.
  useEffect(() => {
    identifyPurchaser(user?.id ?? null);
  }, [user?.id]);

  if (!fontsLoaded && !fontError) {
    return <BrandSplash />;
  }

  const stripeKey =
    Constants.expoConfig?.extra?.stripePublishableKey ?? 'pk_test_placeholder';

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StripeProvider publishableKey={stripeKey}>
            {/* Dark content: every surface in the app resolves to warm paper
                since the neubrutalist pass, and light icons vanished on it. */}
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              {/* Not a tab. The research is a reading room you go into from the
                  profile, not a destination competing with the map. */}
              <Stack.Screen name="research" options={{ headerShown: false }} />
              {/* Reached from the profile. Changing school is rare and, once a
                  season starts, impossible — so it does not earn a tab. */}
              <Stack.Screen name="school" options={{ headerShown: false }} />
            </Stack>
            <FlashMessage position="top" />
          </StripeProvider>
        </QueryClientProvider>
        {/* Outside the providers on purpose: StripeProvider types its children
            as a single element, and it has nothing to give an overlay anyway. */}
        {!splashDone ? (
          <BrandSplash ready={ready} onHidden={() => setSplashDone(true)} />
        ) : null}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
