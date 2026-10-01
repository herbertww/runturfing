# TestFlight Build Instructions

This guide covers preparing and submitting the Runturfing iOS app to App Store Connect for TestFlight distribution.

## 1. App Store Connect Setup
1. Log in to [App Store Connect](https://appstoreconnect.apple.com).
2. Create a new App record.
3. Ensure the Bundle ID matches the one configured in Xcode (e.g., `com.yourcompany.runturfing`).
4. Fill out the required metadata (Privacy Policy URL, Support URL, etc.).

## 2. Provisioning & Certificates
1. Open the project in Xcode.
2. Go to the project settings -> **Signing & Capabilities**.
3. Select your Apple Developer account Team.
4. Ensure Xcode is set to "Automatically manage signing".
5. Verify that all required capabilities are present in the provisioning profile:
   - HealthKit
   - Push Notifications
   - Sign in with Apple
   - Background Modes (Location Updates, Background Fetch)

## 3. Info.plist Privacy Keys
Ensure the following keys are present and have clear, user-facing descriptions in your `Info.plist`:
- `NSHealthShareUsageDescription`: "Runturfing uses your workout routes to build your territory map."
- `NSHealthUpdateUsageDescription`: "Runturfing saves your territory runs to Apple Health."
- `NSLocationWhenInUseUsageDescription`: "Runturfing uses your location to track your run and show your territory on the map."
- `NSLocationAlwaysAndWhenInUseUsageDescription`: "Runturfing needs background location access to accurately track your territory runs while your phone is locked."

## 4. Archiving the Build
1. In Xcode, select **Any iOS Device (arm64)** as the run destination.
2. Select **Product > Archive** from the menu bar.
3. Wait for the build and archiving process to complete.
4. The Organizer window will appear.

## 5. Uploading to App Store Connect
1. In the Organizer, select your archive and click **Distribute App**.
2. Select **TestFlight & App Store**.
3. Choose **Upload**.
4. Leave the default distribution options checked (strip Swift symbols, include bitcode).
5. Select your distribution certificate and profile.
6. Click **Upload**.

## 6. TestFlight Distribution
1. Once processing completes in App Store Connect (usually 15-30 minutes), go to the **TestFlight** tab.
2. Provide export compliance information if prompted (standard encryption).
3. Add internal testers (your team) or create a Public Link for external beta testers.
4. External testing requires a brief Beta App Review by Apple, which usually takes 24-48 hours.

## 7. Backend Production Configuration
Before inviting real users:
- Ensure the iOS app is pointing to the production backend URL in `AppConstants.swift`.
- Ensure the production database is scaled appropriately.
- Ensure Stripe is switched from Test Mode to Live Mode, and the production webhook secrets are configured.
