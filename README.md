# 🏃 Fitbit Real-Time Dashboard

A **beautiful, real-time Fitbit health tracker** dashboard built with Node.js, Express, Socket.io, and vanilla JS.

## Features

| Metric | Details |
|---|---|
| ❤️ Heart Rate | Live intraday chart, zone breakdown, resting BPM |
| 🚶 Steps | Today's count + 7-day bar chart |
| 🔥 Calories | Burned & intake + 7-day trend |
| 😴 Sleep | Sleep stages (Deep/REM/Light/Awake), efficiency |
| 🫁 SpO₂ | Blood oxygen saturation |
| 🌬️ Breathing Rate | Respiratory rate |
| ⚖️ Weight | Latest weight + 7-day trend |
| 🌡️ Skin Temperature | (if supported by your device) |
| 👤 Profile | Name, age, location, timezone |

Real-time updates via **WebSockets** every 30 seconds.

---

## Quick Start

### 1. Create a Fitbit Developer App

1. Go to **https://dev.fitbit.com/apps/new**
2. Fill in:
   - **Application Name**: My Fitbit Dashboard
   - **OAuth 2.0 Application Type**: Personal
   - **Callback URL**: `http://localhost:3000/auth/callback`
   - **Default Access Type**: Read-Only
3. Click **Register** → copy your **Client ID** and **Client Secret**

### 2. Configure Environment

```bash
cd fitbit-dashboard
cp .env.example .env
# Edit .env and paste your Client ID and Client Secret
```

### 3. Install & Run

```bash
npm install
npm start
```

Open **http://localhost:3000** in your browser, click **Connect with Fitbit**, authorize, and enjoy your live dashboard!

---

## Tech Stack

- **Backend**: Node.js + Express + express-session
- **Real-time**: Socket.io (WebSockets)
- **API**: Fitbit Web API v1 (OAuth 2.0)
- **Frontend**: Vanilla JS + Canvas API (no framework needed)
- **Styling**: Pure CSS with CSS variables

## Rate Limits

Fitbit allows **150 API calls/hour** per user. The default poll interval is 30 seconds (≈ 120 calls/hour across all endpoints). Adjust `POLL_INTERVAL_SECONDS` in `.env` as needed.

## File Structure

```
fitbit-dashboard/
├── server.js          # Express + Socket.io backend
├── public/
│   └── index.html     # Full dashboard UI
├── .env.example       # Environment template
├── package.json
└── README.md
```
