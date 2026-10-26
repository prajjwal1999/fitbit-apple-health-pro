require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { createServer } = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const {
  FITBIT_CLIENT_ID,
  FITBIT_CLIENT_SECRET,
  FITBIT_REDIRECT_URI = 'http://localhost:3000/auth/callback',
  PORT = 3000,
  SESSION_SECRET = 'live-tracker-session-secret-key-3392'
} = process.env;

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const HEALTH_API_BASE = 'https://health.googleapis.com/v4/users/me';

const SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.nutrition.readonly',
  'https://www.googleapis.com/auth/googlehealth.profile.readonly'
].join(' ');

const TOKEN_FILE = path.join(__dirname, '.tokens.json');
let savedTokens = null;
if (fs.existsSync(TOKEN_FILE)) {
  try { savedTokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch(e) {}
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id:     FITBIT_CLIENT_ID,
    redirect_uri:  FITBIT_REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',
    include_granted_scopes: 'true'
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(code) {
  const { data } = await axios.post(GOOGLE_TOKEN_URL, new URLSearchParams({
    code,
    client_id:     FITBIT_CLIENT_ID,
    client_secret: FITBIT_CLIENT_SECRET,
    redirect_uri:  FITBIT_REDIRECT_URI,
    grant_type:    'authorization_code'
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  return data;
}

async function refreshToken(refreshTkn) {
  const { data } = await axios.post(GOOGLE_TOKEN_URL, new URLSearchParams({
    refresh_token: refreshTkn,
    client_id:     FITBIT_CLIENT_ID,
    client_secret: FITBIT_CLIENT_SECRET,
    grant_type:    'refresh_token'
  }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  return data;
}

async function getValidToken() {
  let token = savedTokens;
  if (!token) throw new Error('Not authenticated');

  if (Date.now() > token.expiresAt - 60000) {
    try {
      const fresh = await refreshToken(token.refresh_token);
      token = {
        ...token,
        access_token: fresh.access_token,
        expires_in: fresh.expires_in,
        expiresAt: Date.now() + fresh.expires_in * 1000,
        ...(fresh.refresh_token ? { refresh_token: fresh.refresh_token } : {})
      };
      savedTokens = token;
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(token));
    } catch (err) {
      console.error('Token refresh failed:', err.response?.data || err.message);
      throw new Error('Token refresh failed — re-login required');
    }
  }
  return token.access_token;
}

async function healthGet(urlPath, params = {}) {
  const accessToken = await getValidToken();
  const url = urlPath.startsWith('http') ? urlPath : `${HEALTH_API_BASE}${urlPath}`;
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params
  });
  return data;
}

async function fetchGoogleProfile() {
  return healthGet('https://www.googleapis.com/oauth2/v2/userinfo');
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function makeIntervalFilter(dataTypeSnake, startDate, nextDayDate) {
  return `${dataTypeSnake}.interval.start_time >= "${toISODate(startDate)}T00:00:00Z" AND ${dataTypeSnake}.interval.start_time < "${toISODate(nextDayDate)}T00:00:00Z"`;
}

function makeSampleFilter(dataTypeSnake, startDate, nextDayDate) {
  return `${dataTypeSnake}.sample_time.physical_time >= "${toISODate(startDate)}T00:00:00Z" AND ${dataTypeSnake}.sample_time.physical_time < "${toISODate(nextDayDate)}T00:00:00Z"`;
}

function makeSleepFilter(startDate, nextDayDate) {
  return `sleep.interval.end_time >= "${toISODate(startDate)}T00:00:00Z" AND sleep.interval.end_time < "${toISODate(nextDayDate)}T00:00:00Z"`;
}

function makeDailyFilter(dataTypeSnake, startDate, nextDayDate) {
  return `${dataTypeSnake}.date >= "${toISODate(startDate)}" AND ${dataTypeSnake}.date < "${toISODate(nextDayDate)}"`;
}

async function fetchIntervalData(dataType, dataTypeSnake, startD, nextD, pageSize = 1000) {
  try {
    return await healthGet(`/dataTypes/${dataType}/dataPoints`, {
      filter: makeIntervalFilter(dataTypeSnake, startD, nextD),
      pageSize
    });
  } catch (err) {
    return null;
  }
}

async function fetchSampleData(dataType, dataTypeSnake, startD, nextD, pageSize = 1000) {
  try {
    return await healthGet(`/dataTypes/${dataType}/dataPoints`, {
      filter: makeSampleFilter(dataTypeSnake, startD, nextD),
      pageSize
    });
  } catch (err) {
    return null;
  }
}

async function fetchDailyData(dataType, dataTypeSnake, startD, nextD) {
  try {
    return await healthGet(`/dataTypes/${dataType}/dataPoints`, {
      filter: makeDailyFilter(dataTypeSnake, startD, nextD),
      pageSize: 100
    });
  } catch (err) {
    return null;
  }
}

async function fetchSleepData(startD, nextD) {
  try {
    return await healthGet('/dataTypes/sleep/dataPoints', {
      filter: makeSleepFilter(startD, nextD),
      pageSize: 50
    });
  } catch (err) {
    return null;
  }
}

async function fetchAllData(daysRange = 30) {
  const now = new Date();
  const tomorrow = addDays(now, 1);
  const rangeAgo = addDays(now, -daysRange);
  const monthAgo = addDays(now, -60);

  const [
    googleProfile,
    stepsToday,
    stepsRange,
    heartRateToday,
    restingHrRange,
    sleepRange,
    spo2Range,
    breathRateRange,
    weightHistory,
    activeMinutesToday,
    activeMinutesRange,
    distanceToday,
    distanceRange
  ] = await Promise.allSettled([
    fetchGoogleProfile(),
    fetchIntervalData('steps', 'steps', now, tomorrow, 1000),
    fetchIntervalData('steps', 'steps', rangeAgo, tomorrow, 1000),
    fetchSampleData('heart-rate', 'heart_rate', now, tomorrow, 1000),
    fetchDailyData('daily-resting-heart-rate', 'daily_resting_heart_rate', rangeAgo, tomorrow),
    fetchSleepData(rangeAgo, tomorrow),
    fetchSampleData('oxygen-saturation', 'oxygen_saturation', rangeAgo, tomorrow, 1000),
    fetchDailyData('daily-respiratory-rate', 'daily_respiratory_rate', rangeAgo, tomorrow),
    fetchSampleData('weight', 'weight', monthAgo, tomorrow, 100),
    fetchIntervalData('active-minutes', 'active_minutes', now, tomorrow, 500),
    fetchIntervalData('active-minutes', 'active_minutes', rangeAgo, tomorrow, 1000),
    fetchIntervalData('distance', 'distance', now, tomorrow, 500),
    fetchIntervalData('distance', 'distance', rangeAgo, tomorrow, 1000)
  ]);

  const ok = (r) => r.status === 'fulfilled' ? r.value : null;

  return {
    timestamp: new Date().toISOString(),
    daysRequested: daysRange,
    googleProfile:      ok(googleProfile),
    stepsToday:         ok(stepsToday),
    stepsRange:         ok(stepsRange),
    heartRateToday:     ok(heartRateToday),
    restingHrRange:     ok(restingHrRange),
    sleepRange:         ok(sleepRange),
    spo2Range:          ok(spo2Range),
    breathRateRange:    ok(breathRateRange),
    weightHistory:      ok(weightHistory),
    activeMinutesToday: ok(activeMinutesToday),
    activeMinutesRange: ok(activeMinutesRange),
    distanceToday:      ok(distanceToday),
    distanceRange:      ok(distanceRange)
  };
}

app.get('/auth/login', (req, res) => {
  if (!FITBIT_CLIENT_ID || FITBIT_CLIENT_ID === 'YOUR_CLIENT_ID_HERE') {
    return res.send(`<h2>⚠️ Set credentials in .env</h2>`);
  }
  res.redirect(buildAuthUrl());
});

app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?error=' + encodeURIComponent(error));
  try {
    const tokens = await exchangeCode(code);
    savedTokens = { ...tokens, expiresAt: Date.now() + tokens.expires_in * 1000 };
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(savedTokens));
    req.session.tokens = savedTokens;
    res.redirect('/dashboard');
  } catch (err) {
    res.redirect('/?error=token_exchange_failed');
  }
});

app.get('/dashboard', (req, res) => {
  if (!savedTokens) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/auth/logout', (req, res) => {
  savedTokens = null;
  if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  req.session.destroy();
  res.redirect('/');
});

// Dynamic endpoint supporting ?days=7, ?days=14, ?days=30
app.get('/api/data', async (req, res) => {
  if (!savedTokens) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const days = parseInt(req.query.days || 30, 10);
    const data = await fetchAllData(days);
    res.json(data);
  } catch (err) {
    console.error('API error:', err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth-status', (req, res) => {
  res.json({ authenticated: !!savedTokens });
});

// High-speed WebSocket streaming every 3 seconds
setInterval(async () => {
  if (io.sockets.sockets.size === 0 || !savedTokens) return;
  try {
    const data = await fetchAllData(30);
    io.emit('fitbit-update', data);
  } catch (err) {}
}, 3000);

httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║   🍎 Apple Health Pro Studio                     ║
║   🌐 http://localhost:${PORT}                       ║
║   ⏱ Real-Time WebSocket stream: every 3s         ║
╚══════════════════════════════════════════════════╝
  `);
});
