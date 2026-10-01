# Runturfing — First Run Guide

This is the only file you need to read to go from a fresh clone to running Runturfing on your iPhone.

## Step 1 — Clone the repo

```bash
git clone https://github.com/herbertww/runfluence.git
cd runturfing
```

## Step 2 — Open the Xcode project

```
Open: iOS/Runturfing.xcodeproj
```

Double-click `iOS/Runturfing.xcodeproj` in Finder, or from Terminal:

```bash
open iOS/Runturfing.xcodeproj
```

Xcode 15 will open and immediately start resolving Swift Package dependencies (Supabase SDK, Stripe SDK). This takes about 60 seconds on first open.

## Step 3 — Sign the app with your Apple ID

1. In Xcode, click the **Runturfing** project in the left sidebar.
2. Select the **Runturfing** target.
3. Go to the **Signing & Capabilities** tab.
4. Under **Team**, select your Apple ID (or your company's development team).
   - If you don't have a paid developer account, a free Apple ID works for running on your own device.
5. Xcode will automatically manage provisioning profiles.

## Step 4 — Plug in your iPhone

Connect your iPhone via USB. In the Xcode toolbar, select your iPhone as the run destination (it appears in the device dropdown next to the scheme name).

> **Why physical device?** HealthKit and background CoreLocation do not work in the iOS Simulator. You must run on a real iPhone.

## Step 5 — Set your backend URL

Open `iOS/Runturfing/App/AppConstants.swift` and update:

```swift
static let apiBaseURL = "https://your-backend.railway.app"
// or for local dev: "http://YOUR_MAC_LOCAL_IP:8000"
```

To find your Mac's local IP: System Settings → Wi-Fi → Details → IP Address.

## Step 6 — Hit Run

Press **⌘R** or click the Play button. Xcode will build and install the app on your iPhone.

The first time you launch:
- The app will ask for HealthKit permission — tap **Allow All**.
- It will ask for Location permission — tap **Allow While Using App**, then **Change to Always Allow** when prompted.
- It will ask for Notification permission — tap **Allow**.

## Backend Setup (optional for first run)

The app will work in a limited offline/demo mode without a backend. To enable full functionality:

```bash
cd Backend
cp .env.example .env
# Edit .env with your Supabase and Stripe credentials

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run migrations against your Supabase database
psql $DATABASE_URL -f migrations/001_initial_schema.sql
psql $DATABASE_URL -f migrations/002_rls_policies.sql

# Start the server
uvicorn api.main:app --reload --port 8000
```

## Troubleshooting

| Issue | Fix |
|---|---|
| "No account for team" error | Sign in to Xcode with your Apple ID: Xcode → Settings → Accounts → + |
| "Untrusted Developer" on iPhone | iPhone Settings → General → VPN & Device Management → Trust your Apple ID |
| Package resolution fails | File → Packages → Reset Package Caches, then try again |
| HealthKit permission denied | iPhone Settings → Privacy & Security → Health → Runturfing → turn on all permissions |
| Build fails with missing module | Make sure package resolution completed (check the progress bar at the top of Xcode) |
