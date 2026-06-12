const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { TikTokLiveConnection, WebcastEvent } = require('tiktok-live-connector');

// --- LICENSE VERIFICATION SYSTEM (Monthly + Trial Keys) ---
const crypto = require('crypto');
const LICENSE_FILE = path.join(__dirname, 'license.json');
const LICENSE_CONFIG_FILE = path.join(__dirname, 'license-config.json');

function loadLicenseConfig() {
  const defaults = { salt: 'my-secret-tiktok-salt-2026', blockedMachines: [] };
  try {
    if (fs.existsSync(LICENSE_CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(LICENSE_CONFIG_FILE, 'utf8'));
      return { ...defaults, ...raw };
    }
  } catch (e) {}
  return defaults;
}

function getCurrentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getPeriodLabel(period) {
  const [yyyy, mm] = (period || getCurrentPeriod()).split('-');
  return `Tháng ${parseInt(mm)}/${yyyy}`;
}

function getMachineId() {
  try {
    const hostname = os.hostname().toUpperCase();
    const username = os.userInfo().username.toUpperCase();
    return `${hostname}_${username}`;
  } catch (e) {
    return 'FALLBACK_MACHINE_ID';
  }
}

function generateLicenseKey(machineId, salt, period) {
  const usedSalt = salt || loadLicenseConfig().salt;
  const usedPeriod = period || getCurrentPeriod();
  const hash = crypto.createHash('sha256').update(machineId + usedSalt + usedPeriod).digest('hex').toUpperCase();
  return `${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}`;
}

function generateTrialKey(machineId, salt, expiryDateStr) {
  const hash = crypto.createHash('sha256').update(machineId + salt + 'TRIAL-' + expiryDateStr).digest('hex').toUpperCase();
  return `${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}`;
}

function detectTrialKey(machineId, salt, key) {
  for (let offset = -90; offset <= 90; offset++) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const dateStr = d.toISOString().slice(0, 10);
    if (generateTrialKey(machineId, salt, dateStr) === key) return dateStr;
  }
  return null;
}

function getTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getLicenseStatus() {
  if (process.env.BYPASS_LICENSE === 'true' || process.env.PROJECT_DOMAIN) {
    return { activated: true, reason: 'monthly' };
  }
  if (!fs.existsSync(LICENSE_FILE)) return { activated: false, reason: 'not_activated' };
  try {
    const cfg = loadLicenseConfig();
    const machineId = getMachineId();
    if (cfg.blockedMachines && cfg.blockedMachines.includes(machineId)) {
      return { activated: false, reason: 'blocked' };
    }
    const data = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8'));
    if (data.type === 'trial') {
      const today = getTodayStr();
      if (today > data.expiryDate) {
        return { activated: false, reason: 'trial_expired', expiryDate: data.expiryDate };
      }
      const expectedKey = generateTrialKey(machineId, cfg.salt, data.expiryDate);
      if (data.licenseKey !== expectedKey) return { activated: false, reason: 'invalid' };
      const daysLeft = Math.ceil((new Date(data.expiryDate) - new Date(today)) / 86400000);
      return { activated: true, reason: 'trial', expiryDate: data.expiryDate, daysLeft };
    }
    const expectedKey = generateLicenseKey(machineId, cfg.salt, getCurrentPeriod());
    if (data.licenseKey !== expectedKey) return { activated: false, reason: 'expired' };
    return { activated: true, reason: 'monthly' };
  } catch (e) {
    return { activated: false, reason: 'error' };
  }
}

function verifyClientLicense(deviceId, key) {
  if (process.env.BYPASS_LICENSE === 'true') {
    return { activated: true, reason: 'monthly' };
  }
  if (!deviceId || !key) return { activated: false, reason: 'not_activated' };

  try {
    const cfg = loadLicenseConfig();
    const cleanKey = key.trim().toUpperCase();

    // Check monthly key
    const expectedMonthly = generateLicenseKey(deviceId, cfg.salt, getCurrentPeriod());
    if (cleanKey === expectedMonthly) {
      return { activated: true, reason: 'monthly' };
    }

    // Check trial key
    const expiryDateStr = detectTrialKey(deviceId, cfg.salt, cleanKey);
    if (expiryDateStr) {
      const today = getTodayStr();
      if (today > expiryDateStr) {
        return { activated: false, reason: 'trial_expired', expiryDate: expiryDateStr };
      }
      const daysLeft = Math.ceil((new Date(expiryDateStr) - new Date(today)) / 86400000);
      return { activated: true, reason: 'trial', expiryDate: expiryDateStr, daysLeft };
    }

    return { activated: false, reason: 'invalid' };
  } catch (e) {
    return { activated: false, reason: 'error' };
  }
}

function isActivated() {
  return getLicenseStatus().activated;
}
// -----------------------------------------------------------

// --- NETWORK UTILITY ---
function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}
// ----------------------

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const PORT = process.env.PORT || 3000;
// Auto-detect music folder (handles both 'Music' and 'music')
const MUSIC_DIR = fs.existsSync(path.join(__dirname, 'Music'))
  ? path.join(__dirname, 'Music')
  : path.join(__dirname, 'music');
const CONFIG_FILE = path.join(__dirname, 'config.json');

if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });

const defaultConfig = {
  tiktokUsername: '',
  minGiftCoins: 1,
  volume: 0.7,
  ttsEnabled: true,
  ttsRate: 1.0,
  ttsPitch: 1.0,
  chatTtsEnabled: false,
  playlist: [],
  autoPlay: true,
  giftMappings: {}
};

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return { ...defaultConfig };
  }
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    return { ...defaultConfig, ...data };
  } catch (e) {
    return { ...defaultConfig };
  }
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (e) {
    return false;
  }
}

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, MUSIC_DIR),
  filename: (req, file, cb) => {
    const sanitized = Buffer.from(file.originalname, 'latin1').toString('utf8')
      .replace(/[^a-zA-Z0-9.\-_\u00C0-\u024F\u1E00-\u1EFF]/g, '_');
    cb(null, Date.now() + '_' + sanitized);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const extname = /\.(mp3|wav|ogg|m4a)$/i.test(file.originalname);
    const isAudio = file.mimetype.startsWith('audio/') || file.mimetype === 'application/octet-stream';
    if (extname && isAudio) return cb(null, true);
    cb(new Error('Chỉ chấp nhận MP3, WAV, OGG, M4A!'));
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});

// Middleware
app.use(cors());
app.use(express.json());

// Activation check middleware
app.use((req, res, next) => {
  const allowedPaths = [
    '/',
    '/index.html',
    '/activation.html',
    '/api/activate',
    '/api/verify-license',
    '/api/machine-id',
    '/api/license-status',
    '/admin-generator.html',
    '/api/admin/generate-key'
  ];
  if (
    allowedPaths.includes(req.path) ||
    req.path.startsWith('/socket.io') ||
    req.path.startsWith('/css/') ||
    req.path.startsWith('/js/') ||
    req.path.endsWith('.ico') ||
    req.path.endsWith('.png') ||
    req.path.endsWith('.jpg') ||
    req.path.endsWith('.webmanifest') ||
    req.path === '/manifest.json' ||
    req.path === '/sw.js'
  ) {
    return next();
  }

  // Check client headers for API requests
  if (req.path.startsWith('/api/')) {
    const clientDeviceId = req.headers['x-device-id'] || '';
    const clientLicenseKey = req.headers['x-license-key'] || '';
    
    const licStatus = verifyClientLicense(clientDeviceId, clientLicenseKey);
    if (!licStatus.activated) {
      return res.status(401).json({ error: 'Thiết bị chưa kích hoạt bản quyền!', reason: licStatus.reason });
    }
  }

  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/music', express.static(MUSIC_DIR));

// TikTok state
let tiktokConnection = null;
let currentUsername = '';
let connectionStatus = 'disconnected';

// ===== API ENDPOINTS =====

// License / Activation
app.get('/api/machine-id', (req, res) => {
  const period = getCurrentPeriod();
  res.json({ machineId: getMachineId(), period, periodLabel: getPeriodLabel(period) });
});

app.post('/api/activate', (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'Vui lòng cung cấp mã kích hoạt!' });

  const cfg = loadLicenseConfig();
  const machineId = getMachineId();
  const cleanKey = key.trim().toUpperCase();

  const expectedMonthly = generateLicenseKey(machineId, cfg.salt, getCurrentPeriod());
  if (cleanKey === expectedMonthly) {
    const licData = { licenseKey: expectedMonthly, type: 'monthly', period: getCurrentPeriod(), activatedAt: new Date().toISOString() };
    fs.writeFileSync(LICENSE_FILE, JSON.stringify(licData, null, 2), 'utf8');
    return res.json({ success: true, type: 'monthly', message: 'Kích hoạt thành công!', periodLabel: getPeriodLabel(getCurrentPeriod()) });
  }

  const expiryDateStr = detectTrialKey(machineId, cfg.salt, cleanKey);
  if (expiryDateStr) {
    const today = getTodayStr();
    if (today > expiryDateStr) {
      return res.status(400).json({ error: 'Key dùng thử đã hết hạn vào ngày ' + expiryDateStr.split('-').reverse().join('/') + '!' });
    }
    const daysLeft = Math.ceil((new Date(expiryDateStr) - new Date(today)) / 86400000) + 1;
    const licData = { licenseKey: cleanKey, type: 'trial', expiryDate: expiryDateStr, activatedAt: new Date().toISOString() };
    fs.writeFileSync(LICENSE_FILE, JSON.stringify(licData, null, 2), 'utf8');
    const [y, m, d] = expiryDateStr.split('-');
    return res.json({ success: true, type: 'trial', message: 'Kích hoạt dùng thử thành công!', expiryDate: expiryDateStr, expiryLabel: `${d}/${m}/${y}`, daysLeft });
  }

  res.status(400).json({ error: 'Mã kích hoạt không chính xác hoặc đã hết hạn!' });
});

app.post('/api/admin/generate-key', (req, res) => {
  const { password, targetMachineId, keyType, days } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  
  if (password !== adminPassword) {
    return res.status(401).json({ error: 'Mật khẩu admin không chính xác!' });
  }
  
  if (!targetMachineId) {
    return res.status(400).json({ error: 'Vui lòng cung cấp Machine ID người nhận!' });
  }

  const cfg = loadLicenseConfig();
  let generatedKey = '';
  let expiryLabel = '';

  if (keyType === 'monthly') {
    generatedKey = generateLicenseKey(targetMachineId, cfg.salt, getCurrentPeriod());
    expiryLabel = getPeriodLabel(getCurrentPeriod());
  } else {
    const numDays = parseInt(days) || 30;
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + numDays);
    const expiryDateStr = expiryDate.toISOString().slice(0, 10);
    generatedKey = generateTrialKey(targetMachineId, cfg.salt, expiryDateStr);
    const [y, m, d] = expiryDateStr.split('-');
    expiryLabel = `${d}/${m}/${y}`;
  }

  res.json({ success: true, key: generatedKey, expiryLabel, type: keyType });
});

app.get('/api/license-status', (req, res) => res.json(getLicenseStatus()));

app.post('/api/verify-license', (req, res) => {
  const { deviceId, key } = req.body;
  const status = verifyClientLicense(deviceId, key);
  res.json(status);
});

// Config
app.get('/api/config', (req, res) => res.json(loadConfig()));
app.post('/api/config', (req, res) => {
  const config = { ...loadConfig(), ...req.body };
  saveConfig(config);
  res.json({ success: true, config });
});

// Songs
app.get('/api/songs', (req, res) => {
  try {
    const files = fs.readdirSync(MUSIC_DIR);
    const songs = files
      .filter(f => /\.(mp3|wav|ogg|m4a)$/i.test(f))
      .map(f => {
        const stats = fs.statSync(path.join(MUSIC_DIR, f));
        return {
          filename: f,
          name: f.replace(/^\d+_/, '').replace(/\.[^/.]+$/, ''),
          size: stats.size,
          url: `/music/${encodeURIComponent(f)}`
        };
      });
    res.json(songs);
  } catch (e) {
    res.status(500).json({ error: 'Không thể đọc thư mục nhạc' });
  }
});

app.post('/api/songs/upload', upload.array('songs'), (req, res) => {
  try {
    const uploadedFiles = req.files.map(f => ({
      filename: f.filename,
      name: f.filename.replace(/^\d+_/, '').replace(/\.[^/.]+$/, ''),
      url: `/music/${encodeURIComponent(f.filename)}`
    }));
    const config = loadConfig();
    uploadedFiles.forEach(song => {
      if (!config.playlist.includes(song.filename)) config.playlist.push(song.filename);
    });
    saveConfig(config);
    res.json({ success: true, files: uploadedFiles });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Lỗi khi tải file lên' });
  }
});

app.delete('/api/songs/:filename', (req, res) => {
  const filePath = path.join(MUSIC_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Không tìm thấy file nhạc' });
  try {
    fs.unlinkSync(filePath);
    const config = loadConfig();
    config.playlist = config.playlist.filter(n => n !== req.params.filename);
    saveConfig(config);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi khi xóa file nhạc' });
  }
});

// TikTok Status
app.get('/api/tiktok/status', (req, res) => res.json({ status: connectionStatus, username: currentUsername }));

// Mock events
app.post('/api/tiktok/mock-gift', (req, res) => {
  const { giftName, count, diamondCount, nickname, uniqueId } = req.body;
  const evt = {
    giftName: giftName || 'Hoa hồng',
    repeatCount: count || 1,
    diamondCount: diamondCount || 1,
    nickname: nickname || 'Người xem bí ẩn',
    uniqueId: uniqueId || 'test_user_' + Math.floor(Math.random() * 1000),
    giftId: Math.floor(Math.random() * 10000),
    isMock: true
  };
  io.emit('gift', evt);
  res.json({ success: true, event: evt });
});

app.post('/api/tiktok/mock-chat', (req, res) => {
  const { nickname, uniqueId, comment } = req.body;
  const evt = {
    nickname: nickname || 'Người xem bí ẩn',
    uniqueId: uniqueId || 'test_user_' + Math.floor(Math.random() * 1000),
    comment: comment || 'Chào cả nhà yêu âm nhạc nhé!',
    isMock: true
  };
  io.emit('chat', evt);
  res.json({ success: true, event: evt });
});

// TikTok Connect / Disconnect
app.post('/api/tiktok/connect', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Vui lòng cung cấp TikTok Username' });
  if (tiktokConnection && connectionStatus === 'connected') {
    return res.json({ success: true, message: 'Đã kết nối sẵn', status: connectionStatus });
  }

  currentUsername = username;
  connectionStatus = 'connecting';
  io.emit('tiktok-status', { status: connectionStatus, username: currentUsername });

  try {
    const config = loadConfig();
    config.tiktokUsername = username;
    saveConfig(config);

    tiktokConnection = new TikTokLiveConnection(username, { enableExtendedGiftInfo: true });

    tiktokConnection.connect()
      .then(state => {
        connectionStatus = 'connected';
        io.emit('tiktok-status', { status: connectionStatus, username: currentUsername, roomId: state.roomId });
        io.emit('sys-log', { type: 'success', text: `Kết nối thành công tới Live của @${username} (Room: ${state.roomId})` });
      })
      .catch(err => {
        connectionStatus = 'disconnected';
        io.emit('tiktok-status', { status: connectionStatus, username: currentUsername, error: err.message });
        io.emit('sys-log', { type: 'error', text: `Không thể kết nối tới @${username}: ${err.message}` });
        tiktokConnection = null;
      });

    tiktokConnection.on(WebcastEvent.GIFT, data => {
      const uniqueId = data.user ? data.user.uniqueId : (data.uniqueId || 'user');
      const nickname = data.user ? data.user.nickname : (data.nickname || 'Người xem');
      const profilePictureUrl = (data.user && data.user.avatarThumb && data.user.avatarThumb.mUrls)
        ? data.user.avatarThumb.mUrls[0] : (data.profilePictureUrl || null);
      const giftName = data.giftDetails ? data.giftDetails.giftName : (data.giftName || 'Gift_' + data.giftId);
      const diamondCount = data.giftDetails ? data.giftDetails.diamondCount : (data.diamondCount || 0);
      const repeatCount = data.repeatCount || 1;
      const giftType = data.giftDetails ? data.giftDetails.giftType : (data.giftType || 1);
      const isStreak = giftType === 1;
      const isStreakEnd = data.repeatEnd === 1 || data.repeatEnd === true || data.repeatEnd === 'true';
      if (!isStreak || isStreakEnd) {
        io.emit('gift', { giftName, repeatCount, diamondCount, nickname, uniqueId, giftId: data.giftId, profilePictureUrl });
      }
    });

    tiktokConnection.on(WebcastEvent.CHAT, data => {
      const uniqueId = data.user ? data.user.uniqueId : (data.uniqueId || 'user');
      const nickname = data.user ? data.user.nickname : (data.nickname || 'Người xem');
      const profilePictureUrl = (data.user && data.user.avatarThumb && data.user.avatarThumb.mUrls)
        ? data.user.avatarThumb.mUrls[0] : null;
      io.emit('chat', { nickname, uniqueId, comment: data.comment, profilePictureUrl });
    });

    tiktokConnection.on(WebcastEvent.ROOM_USER, data => {
      io.emit('viewer-count', { viewerCount: data.viewerCount });
    });

    tiktokConnection.on(WebcastEvent.DISCONNECT, () => {
      connectionStatus = 'disconnected';
      io.emit('tiktok-status', { status: connectionStatus, username: currentUsername });
      io.emit('sys-log', { type: 'warning', text: `Đã mất kết nối tới Live của @${username}` });
      tiktokConnection = null;
    });

    res.json({ success: true, message: 'Đang kết nối...', status: connectionStatus });
  } catch (err) {
    connectionStatus = 'disconnected';
    tiktokConnection = null;
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tiktok/disconnect', (req, res) => {
  if (tiktokConnection) {
    try { tiktokConnection.disconnect(); } catch (e) {}
    tiktokConnection = null;
  }
  connectionStatus = 'disconnected';
  io.emit('tiktok-status', { status: connectionStatus, username: currentUsername });
  io.emit('sys-log', { type: 'info', text: 'Đã chủ động ngắt kết nối Live' });
  res.json({ success: true });
});

// Network info for OBS URL display
app.get('/api/network-info', (req, res) => {
  const lanIp = getLanIp();
  res.json({ lanIp, port: PORT, overlayUrl: `http://${lanIp}:${PORT}/overlay.html` });
});

// Socket.IO
io.on('connection', (socket) => {
  socket.emit('tiktok-status', { status: connectionStatus, username: currentUsername });
  socket.on('play-state', (data) => {
    socket.broadcast.emit('play-state', data);
  });
});

// Start server
const LAN_IP = getLanIp();
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║   🎵 TikTok Live Auto Music — Android Edition  ║');
  console.log('╠════════════════════════════════════════════════╣');
  console.log(`║  📱 Mở trên điện thoại: http://localhost:${PORT}   ║`);
  console.log(`║  💻 Mở từ máy khác:    http://${LAN_IP}:${PORT}  ║`);
  console.log(`║  📺 OBS Overlay URL:   http://${LAN_IP}:${PORT}/overlay.html  ║`);
  console.log(`║  📁 Thư mục nhạc: ${MUSIC_DIR}  ║`);
  console.log('╚════════════════════════════════════════════════╝\n');
  console.log('  ✅ Server sẵn sàng. Mở Chrome Android và truy cập URL trên!\n');
});
