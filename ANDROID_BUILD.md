# Runturfing Android — Build & Google Play Internal Testing Guide

This guide takes you from a fresh clone to an AAB uploaded to Google Play Internal Testing.

---

## Prerequisites

Install these on your Mac/PC before starting:

```bash
# Node.js 20+
node --version

# EAS CLI (Expo Application Services)
npm install -g eas-cli

# Expo CLI
npm install -g expo-cli
```

You also need:
- An **Expo account** (free) — sign up at [expo.dev](https://expo.dev)
- A **Google Play Developer account** ($25 one-time fee) — [play.google.com/console](https://play.google.com/console)
- A **Google Maps API key** (for Android map rendering) — [console.cloud.google.com](https://console.cloud.google.com)

---

## Step 1 — Clone and install dependencies

```bash
git clone https://github.com/herbertww/runfluence.git
cd runturfing/Android
npm install
```

---

## Step 2 — Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `EXPO_PUBLIC_API_BASE_URL` — your backend URL
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` — your Stripe test key
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` — your Google Maps API key

---

## Step 3 — Set up Google Maps API key

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable the **Maps SDK for Android**
3. Create an API key and restrict it to your Android app package (`com.runturfing.app`)
4. Add the key to `app.json` under `plugins > react-native-maps > googleMapsApiKey`

---

## Step 4 — Set up Firebase (for Google Sign-In and push notifications)

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project named "Runturfing"
3. Add an Android app with package name `com.runturfing.app`
4. Download `google-services.json` and place it in the `Android/` directory
5. Enable **Authentication → Google** sign-in method

---

## Step 5 — Log in to EAS and initialize the project

```bash
eas login
eas init --id YOUR_EAS_PROJECT_ID
```

Update `app.json` → `extra.eas.projectId` with the ID shown after `eas init`.

---

## Step 6 — Build the AAB for Google Play Internal Testing

### Option A — Cloud build (recommended, no Android SDK needed locally)

```bash
cd Android
eas build --platform android --profile internal-testing
```

EAS will:
1. Upload your code to Expo's build servers
2. Compile the Android app
3. Sign it with a managed keystore (EAS handles this automatically)
4. Produce a `.aab` file you can download

This takes ~10-15 minutes. You'll get a download link when it's done.

### Option B — Local build (requires Android Studio + SDK)

```bash
# Generate native Android project
npx expo prebuild --platform android

# Build AAB
cd android
./gradlew bundleRelease

# Output: android/app/build/outputs/bundle/release/app-release.aab
```

---

## Step 7 — Create your app on Google Play Console

1. Go to [Google Play Console](https://play.google.com/console)
2. Click **Create app**
3. Fill in:
   - App name: **Runturfing**
   - Default language: English
   - App or game: **App**
   - Free or paid: **Free** (for now)
4. Complete the store listing (you can use placeholder content for internal testing)

---

## Step 8 — Upload the AAB to Internal Testing

1. In Google Play Console, go to **Testing → Internal testing**
2. Click **Create new release**
3. Upload the `.aab` file from Step 6
4. Add release notes (e.g., "Initial internal test build")
5. Click **Save** → **Review release** → **Start rollout to Internal testing**

---

## Step 9 — Add testers

1. Go to **Internal testing → Testers**
2. Create a tester list and add email addresses
3. Each tester will receive an email with a link to opt in
4. After opting in, they can install the app from the Play Store

---

## Step 10 — Install on your Android phone

After uploading:
1. Open the opt-in link on your Android phone
2. Tap **Become a tester**
3. Tap **Download it on Google Play**
4. Install and launch Runturfing

---

## Checklist — Blockers to resolve before testing

| Item | Status | Action Required |
|---|---|---|
| Google Maps API key | **Required** | Add to `app.json` and `.env` |
| `google-services.json` | **Required for Google Sign-In** | Download from Firebase Console |
| Backend URL | **Required** | Set `EXPO_PUBLIC_API_BASE_URL` in `.env` |
| EAS project ID | **Required for cloud build** | Run `eas init` |
| Google Play Developer account | **Required** | $25 one-time registration |
| App icon (1024×1024 PNG) | **Required for Play Store** | Add to `Android/assets/icon.png` |
| Splash screen image | Recommended | Add to `Android/assets/splash.png` |
| Stripe key | Optional for testing | Add test key to `.env` |

---

## Known limitations in this build

- **Health Connect** (Android equivalent of HealthKit) requires Android 9+ and the Health Connect app installed. The import flow degrades gracefully if unavailable.
- **Background location** on Android 10+ requires the user to manually set location permission to "Allow all the time" in phone settings.
- **Google Sign-In** requires `google-services.json` to be present.
- The **map** uses Google Maps on Android (requires API key). Without a key, the map will show a grey screen with a watermark.

---

## Quick commands reference

```bash
# Start dev server (Expo Go app on phone)
cd Android && npx expo start

# Build APK for direct install (no Play Store needed)
eas build --platform android --profile preview

# Build AAB for Play Store
eas build --platform android --profile internal-testing

# Submit directly to Play Store (after first manual upload)
eas submit --platform android
```
