# Runturfing Setup Guide

This guide covers setting up the local development environment for the Runturfing backend and iOS app.

## Backend Setup

The backend requires Python 3.11+ and PostgreSQL.

### 1. Database
We recommend using Supabase for the database to leverage built-in Auth, PostGIS, and pg_cron.
1. Create a new Supabase project.
2. Run the migrations in `Backend/migrations/001_initial_schema.sql` and `002_rls_policies.sql`.
3. Get your connection string (Session mode, not Transaction mode for migrations).

### 2. Environment Variables
Create a `.env` file in `Backend/`:
```env
DATABASE_URL=postgresql+asyncpg://postgres:[PASSWORD]@[HOST]:5432/postgres
JWT_SECRET=your_super_secret_jwt_key
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 3. Install Dependencies
```bash
cd Backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```
*(Ensure you include `fastapi`, `uvicorn`, `sqlalchemy`, `asyncpg`, `pydantic`, `h3`, `pyjwt`, `stripe` in your requirements.txt)*

### 4. Run the Server
```bash
uvicorn api.main:app --reload --port 8000
```

## iOS App Setup

The iOS app requires Xcode 15+ and iOS 16.0+.

### 1. Open Project
Open `iOS/Runturfing/Runturfing.xcodeproj` (or Package.swift if using SPM structure) in Xcode.

### 2. Configure Signing
1. Go to the project settings -> **Signing & Capabilities**.
2. Select your development team.
3. Ensure the bundle identifier is unique (e.g., `com.yourcompany.runturfing`).
4. Ensure the following capabilities are enabled:
   - **HealthKit** (with Background Delivery)
   - **Location Updates** (Background Modes)
   - **Push Notifications**
   - **Sign in with Apple**

### 3. Configure Constants
Edit `iOS/Runturfing/App/AppConstants.swift` and set your local backend URL:
```swift
static let apiBaseURL = "http://localhost:8000" // Use your Mac's IP if testing on a physical device
```

### 4. Run on Device
Because HealthKit and CoreLocation background tracking require physical hardware sensors, **you must run the app on a physical iPhone**, not the simulator.
