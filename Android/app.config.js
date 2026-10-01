// Dynamic Expo config: layers env-managed values (from .env) on top of app.json,
// so API keys and URLs are never hardcoded in version-controlled config.
// Expo loads .env automatically; EXPO_PUBLIC_* are also bundled into the client.
//
// Used here:
//   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY  – Android Google Maps rendering
//   EXPO_PUBLIC_API_BASE_URL         – backend base URL (read via Constants.expoConfig.extra.apiBaseUrl)
//   EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
//   EXPO_PUBLIC_REVENUECAT_IOS_KEY / _ANDROID_KEY – RevenueCat public SDK keys
//   EAS_PROJECT_ID                   – EAS cloud build project id

module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      },
    },
  },
  extra: {
    ...config.extra,
    // `||` (not `??`) so an empty-string env value falls back to the app.json default.
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || config.extra?.apiBaseUrl,
    stripePublishableKey:
      process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || config.extra?.stripePublishableKey,
    revenueCatIosKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
    revenueCatAndroidKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
    eas: {
      ...config.extra?.eas,
      projectId: process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId,
    },
  },
});
