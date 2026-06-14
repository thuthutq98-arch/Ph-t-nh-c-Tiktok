// ============================================================
// TikTok Live Auto Music — Android (Mobile SPA) — Main App JS
// ============================================================

// === CLIENT DEVICE LICENSE SYSTEM ===
// Device fingerprint: same device = same ID (any browser, incognito, etc.)
function getDeviceFingerprint() {
  // FNV-1a hash function
  function fnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0);
  }

  // Canvas fingerprint
  let canvasFP = '';
  try {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    c.width = 200; c.height = 50;
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('TikTokMusic2026', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('TikTokMusic2026', 4, 17);
    canvasFP = c.toDataURL();
  } catch(e) { canvasFP = 'no-canvas'; }

  // WebGL renderer
  let glRenderer = 'unknown';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) glRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
  } catch(e) {}

  // Combine stable device properties
  const p1 = fnv1a(canvasFP + '|' + glRenderer).toString(16).toUpperCase().padStart(8, '0');
  const p2 = fnv1a([
    screen.width, screen.height, screen.colorDepth,
    navigator.hardwareConcurrency || 0,
    navigator.deviceMemory || 0,
    navigator.platform,
    new Date().getTimezoneOffset()
  ].join('|')).toString(16).toUpperCase().padStart(8, '0');

  return 'DEV-' + p1.substring(0, 4) + p2.substring(0, 4) + '-' + p1.substring(4, 8) + p2.substring(4, 8);
}

const __deviceId = getDeviceFingerprint();
const __licenseKey = localStorage.getItem('license_key') || '';

// Override fetch FIRST so all API calls include device headers
const __originalFetch = window.fetch.bind(window);
window.fetch = function(url, options) {
  options = options || {};
  // For plain object headers
  if (!options.headers) {
    options.headers = {};
  }
  if (typeof options.headers === 'object' && !(options.headers instanceof Headers)) {
    options.headers['X-Device-Id'] = __deviceId;
    options.headers['X-License-Key'] = __licenseKey;
  }
  return __originalFetch(url, options);
};

// Check license on page load (skip on activation/admin pages)
// *** TẮT TẠM THỜI - BẬT LẠI KHI CẦN LICENSE ***
// if (!window.location.pathname.includes('activation.html') && !window.location.pathname.includes('admin-generator.html')) {
//   __originalFetch('/api/verify-license', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ deviceId: __deviceId, key: __licenseKey })
//   })
//   .then(r => r.json())
//   .then(data => {
//     if (!data.activated) {
//       window.location.href = '/activation.html?reason=' + (data.reason || 'not_activated');
//     }
//   })
//   .catch(e => console.error('License check error', e));
// }

// === Multi-Room Support ===
const urlParams = new URLSearchParams(window.location.search);
let currentRoom = urlParams.get('room') || '';

// Helper: add room param to API URL
function roomUrl(url) {
  if (!currentRoom) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}room=${encodeURIComponent(currentRoom)}`;
}

// === Global State ===
let socket = null;
let library = [];
let activePlaylist = [];
let playbackQueue = [];
let currentSong = null;
let isPlaying = false;
let nextPlaylistIndex = 0;
let systemConfig = {
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

// === Audio ===
const audioPlayer = document.getElementById('mainAudioPlayer');
const synthEngine = new window.SynthEngine();

// === UI Elements ===
const vinylDisk = document.getElementById('vinylDisk');
const currentSongTitle = document.getElementById('currentSongTitle');
const playerStatusText = document.getElementById('playerStatus');
const currentTimeText = document.getElementById('currentTime');
const totalTimeText = document.getElementById('totalTime');
const progressBar = document.getElementById('progressBar');
const progressWrapper = document.getElementById('progressWrapper');
const playPauseBtn = document.getElementById('playPauseBtn');
const playIcon = document.getElementById('playIcon');
const skipBtn = document.getElementById('skipBtn');
const clearQueueBtn = document.getElementById('clearQueueBtn');
const volumeSlider = document.getElementById('volumeSlider');
const volumeIcon = document.getElementById('volumeIcon');
const volumeLabel = document.getElementById('volumeLabel');

const songCountBadge = document.getElementById('songCount');
const playlistCountBadge = document.getElementById('playlistCount');
const queueCountBadge = document.getElementById('queueCount');
const libraryList = document.getElementById('libraryList');
const playlistList = document.getElementById('playlistList');
const queueList = document.getElementById('queueList');
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');

const statusDot = document.getElementById('statusDot');
const headerStatusDot = document.getElementById('headerStatusDot');
const statusText = document.getElementById('statusText');
const viewerBadge = document.getElementById('viewerBadge');
const viewerCountEl = document.getElementById('viewerCount');
const tiktokUsernameInput = document.getElementById('tiktokUsernameInput');
const connectBtn = document.getElementById('connectBtn');
const logContainer = document.getElementById('logContainer');

const minCoinsInput = document.getElementById('minCoins');
const chatTtsToggle = document.getElementById('chatTtsToggle');
const obsOverlayUrlInput = document.getElementById('obsOverlayUrl');
const copyUrlBtn = document.getElementById('copyUrlBtn');
const licenseInfo = document.getElementById('licenseInfo');
const trialBanner = document.getElementById('trialBanner');

const mappingGiftName = document.getElementById('mappingGiftName');
const mappingSongSelect = document.getElementById('mappingSongSelect');
const addMappingBtn = document.getElementById('addMappingBtn');
const mappingList = document.getElementById('mappingList');
const customGiftGroup = document.getElementById('customGiftGroup');
const customGiftInput = document.getElementById('customGiftInput');

// === Known Gifts System ===
// Pre-built common TikTok gifts (English API name → Vietnamese label + diamond)
const DEFAULT_GIFTS = [
  { name: 'Rose', label: 'Hoa hồng (Rose)', diamonds: 1 },
  { name: 'GG', label: 'GG', diamonds: 1 },
  { name: 'Ice Cream Cone', label: 'Kem ốc quế (Ice Cream)', diamonds: 1 },
  { name: 'Finger Heart', label: 'Tim ngón tay (Finger Heart)', diamonds: 5 },
  { name: 'Doughnut', label: 'Bánh Donut', diamonds: 30 },
  { name: 'Hand Heart', label: 'Tim tay (Hand Heart)', diamonds: 10 },
  { name: 'Perfume', label: 'Nước hoa (Perfume)', diamonds: 20 },
  { name: 'Little Crown', label: 'Vương miện nhỏ (Little Crown)', diamonds: 99 },
  { name: 'Galaxy', label: 'Thiên hà (Galaxy)', diamonds: 1000 },
  { name: 'lucky pig', label: 'Heo may mắn (Lucky Pig)', diamonds: 1 },
  { name: 'Confetti', label: 'Hoa giấy (Confetti)', diamonds: 100 },
  { name: 'Paper Crane', label: 'Hạc giấy (Paper Crane)', diamonds: 1 },
  { name: 'TikTok', label: 'TikTok', diamonds: 1 },
  { name: 'Love you', label: 'Yêu bạn (Love You)', diamonds: 25 },
  { name: 'Cap', label: 'Mũ lưỡi trai (Cap)', diamonds: 99 },
];

let knownGifts = []; // { name, label, diamonds }

function loadKnownGifts() {
  try {
    const raw = localStorage.getItem('tiktok_known_gifts');
    if (raw) knownGifts = JSON.parse(raw);
  } catch(e) {}
  // Merge defaults (avoid duplicates)
  DEFAULT_GIFTS.forEach(dg => {
    if (!knownGifts.find(kg => kg.name.toLowerCase() === dg.name.toLowerCase())) {
      knownGifts.push(dg);
    }
  });
}

function saveKnownGifts() {
  try { localStorage.setItem('tiktok_known_gifts', JSON.stringify(knownGifts)); } catch(e) {}
}

function addKnownGift(name, diamonds) {
  if (!name) return;
  const existing = knownGifts.find(g => g.name.toLowerCase() === name.toLowerCase());
  if (!existing) {
    knownGifts.push({ name, label: name + (diamonds ? ` (${diamonds}💎)` : ''), diamonds: diamonds || 0 });
    saveKnownGifts();
    renderGiftDropdown();
  }
}

function renderGiftDropdown() {
  if (!mappingGiftName) return;
  const currentVal = mappingGiftName.value;
  mappingGiftName.innerHTML = '<option value="">-- Chọn quà tặng --</option>';
  // Sort by diamonds descending
  const sorted = [...knownGifts].sort((a, b) => (b.diamonds || 0) - (a.diamonds || 0));
  sorted.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.name;
    opt.textContent = g.label || g.name;
    mappingGiftName.appendChild(opt);
  });
  // Manual input option
  const manualOpt = document.createElement('option');
  manualOpt.value = '__MANUAL__';
  manualOpt.textContent = '✏️ Nhập tên quà thủ công...';
  mappingGiftName.appendChild(manualOpt);
  // Restore value
  if (currentVal) mappingGiftName.value = currentVal;
}

// ========================================
// INITIALIZATION
// ========================================
window.addEventListener('DOMContentLoaded', async () => {
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Setup bottom navigation
  setupBottomNav();

  // Load known gifts from localStorage
  loadKnownGifts();
  renderGiftDropdown();

  // Load config + songs
  await loadConfig();
  await loadSongsList();

  // Init socket
  initSocket();

  // Setup all event listeners
  setupEventListeners();

  // Start queue loop
  tickQueue();

  // Update overlay URL with actual network info
  loadNetworkInfo();

  // Load license status
  loadLicenseStatus();

  // Load stats + auto-refresh every 10s
  loadStats();
  setInterval(loadStats, 10000);
});

// ========================================
// STATS DASHBOARD
// ========================================
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    const el = (id) => document.getElementById(id);
    if (el('statOnline')) el('statOnline').textContent = data.online || 0;
    if (el('statRooms')) el('statRooms').textContent = data.rooms || 0;
    if (el('statTrialTotal')) el('statTrialTotal').textContent = data.trial ? data.trial.total : 0;
    if (el('statsDetail')) {
      let detail = '';
      if (data.trial) {
        detail += `Trial: ${data.trial.active} đang dùng, ${data.trial.expired} đã hết hạn`;
      }
      if (data.roomList && data.roomList.length > 0) {
        detail += '<br>Phòng: ' + data.roomList.map(r => `@${r.name} (${r.clients} người${r.tiktokConnected ? ', Live' : ''})`).join(', ');
      }
      el('statsDetail').innerHTML = detail;
    }
  } catch(e) {}
}
// BOTTOM NAVIGATION
// ========================================
function setupBottomNav() {
  const navItems = document.querySelectorAll('.nav-item');
  const pages = document.querySelectorAll('.page-view');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const pageId = item.dataset.page;

      // Deactivate all
      navItems.forEach(n => n.classList.remove('active'));
      pages.forEach(p => p.classList.remove('active'));

      // Activate selected
      item.classList.add('active');
      document.getElementById(pageId).classList.add('active');
    });
  });
}

// ========================================
// CONFIG — localStorage is PRIMARY source
// ========================================

function saveToLocal() {
  try {
    localStorage.setItem('tiktok_my_config', JSON.stringify({
      giftMappings: systemConfig.giftMappings || {},
      playlist: systemConfig.playlist || [],
      minGiftCoins: systemConfig.minGiftCoins,
      volume: systemConfig.volume,
      chatTtsEnabled: systemConfig.chatTtsEnabled,
      ttsRate: systemConfig.ttsRate,
      ttsPitch: systemConfig.ttsPitch
    }));
  } catch(e) {}
}

function loadFromLocal() {
  try {
    const raw = localStorage.getItem('tiktok_my_config');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return null;
}

async function loadConfig() {
  // STEP 1: Load from localStorage FIRST (always available)
  const localCfg = loadFromLocal();
  if (localCfg) {
    systemConfig = { ...systemConfig, ...localCfg };
  }

  // STEP 2: Try server (may override if server has newer data)
  try {
    const res = await fetch(roomUrl('/api/config'));
    const serverCfg = await res.json();
    // Only use server data if it actually has content
    if (serverCfg.giftMappings && Object.keys(serverCfg.giftMappings).length > 0) {
      systemConfig.giftMappings = serverCfg.giftMappings;
    }
    if (serverCfg.playlist && serverCfg.playlist.length > 0) {
      systemConfig.playlist = serverCfg.playlist;
    }
    if (serverCfg.tiktokUsername) {
      systemConfig.tiktokUsername = serverCfg.tiktokUsername;
    }
  } catch(e) {}

  // STEP 3: Apply to UI
  tiktokUsernameInput.value = systemConfig.tiktokUsername || '';
  minCoinsInput.value = systemConfig.minGiftCoins || 1;

  const vol = systemConfig.volume !== undefined ? systemConfig.volume : 0.7;
  volumeSlider.value = vol;
  audioPlayer.volume = vol;
  updateVolumeIcon(vol);
  volumeLabel.textContent = Math.round(vol * 100) + '%';

  if (systemConfig.chatTtsEnabled) {
    chatTtsToggle.classList.add('active');
  }

  systemConfig.giftMappings = systemConfig.giftMappings || {};
  renderMappingList();

  // STEP 4: Sync local config to server
  if (currentRoom) {
    fetch(roomUrl('/api/config'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(systemConfig)
    }).catch(() => {});
  }

  // Save to local in case server had newer data
  saveToLocal();
}

async function saveConfig() {
  // Always save to localStorage FIRST
  saveToLocal();
  // Then sync to server
  try {
    await fetch(roomUrl('/api/config'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(systemConfig)
    });
  } catch (e) {
    console.error('Error saving config:', e);
  }
}

// ========================================
// SONGS
// ========================================
async function loadSongsList() {
  try {
    const res = await fetch('/api/songs');
    library = await res.json();

    songCountBadge.textContent = `${library.length} bài`;

    // Reconstruct playlist from config
    activePlaylist = [];
    if (systemConfig.playlist && systemConfig.playlist.length > 0) {
      systemConfig.playlist.forEach(filename => {
        const song = library.find(s => s.filename === filename);
        if (song) activePlaylist.push(song);
      });
    }

    playlistCountBadge.textContent = activePlaylist.length;
    renderLibraryList();
    renderPlaylistList();
    updateMappingSongSelectOptions();
    renderMappingList();
  } catch (e) {
    console.error('Error loading songs:', e);
    addLog('system', 'error', 'Không thể tải danh sách nhạc');
  }
}

// ========================================
// SOCKET.IO
// ========================================
function initSocket() {
  socket = io();

  // Join room if we have one
  if (currentRoom) {
    socket.emit('join-room', currentRoom);
  }

  socket.on('tiktok-status', (data) => {
    updateConnectionStatus(data.status, data.username);
  });

  socket.on('sys-log', (data) => {
    addLog('system', data.type, data.text);
  });

  socket.on('viewer-count', (data) => {
    viewerCountEl.textContent = data.viewerCount;
  });

  socket.on('chat', (data) => {
    addLog('chat', 'info', data);
    if (systemConfig.chatTtsEnabled && data.comment) {
      // Skip emoji-only comments, auto-detect language
      const comment = data.comment.trim();
      if (comment) {
        // Strip emojis from author name
        const rawName = data.nickname || data.uniqueId;
        const author = rawName.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Emoji_Modifier_Base}\p{Emoji_Modifier}\p{Emoji_Component}\u200d\ufe0f\u20e3\u2600-\u27bf\u2300-\u23ff\u2b50\u2b55]/gu, '').trim() || rawName;
        speakText(`${author}: ${comment}`);
      }
    }
  });

  socket.on('gift', (data) => {
    addLog('gift', 'success', data);

    // Auto-collect gift name for dropdown
    addKnownGift(data.giftName, data.diamondCount);

    const minCoins = systemConfig.minGiftCoins || 1;
    const totalCoins = data.diamondCount * data.repeatCount;

    if (totalCoins < minCoins) {
      addLog('system', 'info', `Bỏ qua quà từ @${data.uniqueId} (${totalCoins} xu < ${minCoins} xu tối thiểu)`);
      return;
    }

    queueNextSong(data);
  });
}

// ========================================
// QUEUE / PLAYBACK
// ========================================
function queueNextSong(giftData) {
  const giftNameClean = giftData.giftName.trim();
  let songToQueue = null;

  // 1. Check gift mapping
  let matchedFilename = null;
  if (systemConfig.giftMappings) {
    if (systemConfig.giftMappings[giftNameClean]) {
      matchedFilename = systemConfig.giftMappings[giftNameClean];
    } else {
      const lowerGiftName = giftNameClean.toLowerCase();
      const foundKey = Object.keys(systemConfig.giftMappings).find(k => k.toLowerCase() === lowerGiftName);
      if (foundKey) matchedFilename = systemConfig.giftMappings[foundKey];
    }
  }

  if (matchedFilename) {
    const song = library.find(s => s.filename === matchedFilename);
    if (song) {
      songToQueue = { ...song };
      addLog('system', 'info', `Quà "${giftNameClean}" → bài: ${song.name}`);
    }
  }

  // 2. Fallback to playlist sequential
  if (!songToQueue) {
    if (activePlaylist.length > 0) {
      if (nextPlaylistIndex >= activePlaylist.length) nextPlaylistIndex = 0;
      songToQueue = { ...activePlaylist[nextPlaylistIndex] };
      nextPlaylistIndex++;
    } else {
      addLog('system', 'warning', `Nhận quà "${giftNameClean}" nhưng playlist trống!`);
      return;
    }
  }

  songToQueue.giftInfo = giftData;
  songToQueue.queueId = Date.now() + '_' + Math.random().toString(36).substr(2, 5);

  playbackQueue.push(songToQueue);
  renderQueueList();
  queueCountBadge.textContent = playbackQueue.length;

  addLog('system', 'success', `Đã thêm: ${songToQueue.name} (bởi @${giftData.uniqueId})`);
}

let isProcessingQueue = false;

async function tickQueue() {
  if (isProcessingQueue) { setTimeout(tickQueue, 500); return; }

  if (playbackQueue.length > 0 && !isPlaying && !currentSong) {
    isProcessingQueue = true;
    const nextSong = playbackQueue.shift();
    renderQueueList();
    queueCountBadge.textContent = playbackQueue.length;
    await playSongItem(nextSong);
    isProcessingQueue = false;
  }

  setTimeout(tickQueue, 500);
}

async function playSongItem(song) {
  currentSong = song;
  currentSongTitle.textContent = song.name;
  playerStatusText.textContent = 'Đang chuẩn bị...';

  // Notify overlay
  if (socket) {
    socket.emit('play-state', {
      isPlaying: true,
      songName: song.name,
      giftName: song.giftInfo ? song.giftInfo.giftName : null,
      giftCount: song.giftInfo ? song.giftInfo.repeatCount : 0,
      nickname: song.giftInfo ? song.giftInfo.nickname : null,
      uniqueId: song.giftInfo ? song.giftInfo.uniqueId : null,
      isSynth: !!song.isSynth
    });
  }

  playerStatusText.textContent = 'Đang phát nhạc';
  isPlaying = true;
  vinylDisk.classList.add('playing');
  playIcon.className = 'fa-solid fa-pause';

  if (song.isSynth) {
    synthEngine.play(
      (progress, secs, totalSecs) => {
        progressBar.style.width = `${progress * 100}%`;
        currentTimeText.textContent = formatTime(secs);
        totalTimeText.textContent = formatTime(totalSecs);
      },
      () => handlePlaybackFinished()
    );
  } else {
    audioPlayer.src = song.url;
    audioPlayer.load();
    try {
      await audioPlayer.play();
    } catch (err) {
      addLog('system', 'error', `Không thể phát: ${song.name}. Bỏ qua.`);
      handlePlaybackFinished();
    }
  }
}

function handlePlaybackFinished() {
  isPlaying = false;
  currentSong = null;
  vinylDisk.classList.remove('playing');
  playIcon.className = 'fa-solid fa-play';
  currentSongTitle.textContent = 'Chưa phát nhạc';
  playerStatusText.textContent = 'Đang dừng';
  progressBar.style.width = '0%';
  currentTimeText.textContent = '0:00';
  totalTimeText.textContent = '0:00';
  if (socket) socket.emit('play-state', { isPlaying: false });
}

// Audio events
audioPlayer.addEventListener('timeupdate', () => {
  if (isPlaying && currentSong && !currentSong.isSynth) {
    const cur = audioPlayer.currentTime;
    const dur = audioPlayer.duration || 0;
    if (dur > 0) {
      progressBar.style.width = `${(cur / dur) * 100}%`;
      currentTimeText.textContent = formatTime(cur);
      totalTimeText.textContent = formatTime(dur);
    }
  }
});

audioPlayer.addEventListener('ended', () => handlePlaybackFinished());

// ========================================
// TTS — Auto Language Detection + Emoji Filter
// ========================================

// Only keep readable text: letters, numbers, punctuation, spaces (any language)
function keepTextOnly(text) {
  return text.replace(/[^\p{Letter}\p{Number}\p{Punctuation}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

// Check if comment has no readable text (only emojis/icons/symbols)
function isEmojiOnly(text) {
  return keepTextOnly(text).length === 0;
}

// Detect language from text content
function detectLanguage(text) {
  const clean = keepTextOnly(text);
  // Vietnamese: has tone marks
  if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(clean)) {
    return 'vi-VN';
  }
  // Korean: Hangul
  if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(clean)) {
    return 'ko-KR';
  }
  // Japanese
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(clean)) {
    return 'ja-JP';
  }
  // Chinese
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(clean)) {
    return 'zh-CN';
  }
  // Latin → English
  if (/[a-zA-Z]/.test(clean)) {
    return 'en-US';
  }
  return 'vi-VN';
}

// Cache available voices
let cachedVoices = [];
function loadVoices() {
  cachedVoices = window.speechSynthesis.getVoices();
}
if ('speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

// Find best voice for language
function findBestVoice(lang) {
  if (!cachedVoices.length) cachedVoices = window.speechSynthesis.getVoices();
  
  // Preferred voice names for each language
  const preferred = {
    'vi-VN': ['Google Tiếng Việt', 'Microsoft An', 'Microsoft HoaiMy', 'vi-VN'],
    'en-US': ['Google US English', 'Microsoft David', 'Microsoft Zira', 'en-US', 'en-GB'],
    'ko-KR': ['Google 한국의', 'Microsoft Heami', 'ko-KR', 'ko_KR']
  };

  const prefs = preferred[lang] || [lang];
  
  // Try exact name match first
  for (const pref of prefs) {
    const voice = cachedVoices.find(v => v.name.includes(pref));
    if (voice) return voice;
  }
  
  // Try lang code match
  const langCode = lang.split('-')[0];
  const byLang = cachedVoices.find(v => v.lang.startsWith(langCode));
  if (byLang) return byLang;
  
  return null;
}

function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  
  const cleanText = keepTextOnly(text);
  if (!cleanText) return;
  
  const utterance = new SpeechSynthesisUtterance(cleanText);
  
  // Get language from settings dropdown or auto-detect
  const ttsLangSelect = document.getElementById('ttsLang');
  const selectedLang = ttsLangSelect ? ttsLangSelect.value : 'vi-VN';
  const detectedLang = detectLanguage(cleanText);
  
  // Use selected language, but auto-detect Korean/special chars
  const finalLang = (detectedLang === 'ko-KR' || detectedLang === 'ja-JP' || detectedLang === 'zh-CN') 
    ? detectedLang 
    : selectedLang;
  
  utterance.lang = finalLang;
  
  // Find and set the best voice
  const voice = findBestVoice(finalLang);
  if (voice) utterance.voice = voice;
  
  utterance.rate = systemConfig.ttsRate || 1.0;
  utterance.pitch = systemConfig.ttsPitch || 1.0;
  utterance.onerror = () => {};
  window.speechSynthesis.speak(utterance);
}

// ========================================
// CONNECTION STATUS
// ========================================
function updateConnectionStatus(status, username) {
  // Update all status dots
  statusDot.className = `status-dot ${status}`;
  headerStatusDot.className = `status-dot ${status}`;

  if (status === 'connected') {
    statusText.textContent = `@${username}`;
    connectBtn.innerHTML = '<i class="fa-solid fa-plug-circle-xmark"></i> Ngắt Kết Nối';
    connectBtn.className = 'btn btn-danger btn-full';
    viewerBadge.style.display = 'inline-flex';
  } else if (status === 'connecting') {
    statusText.textContent = 'Đang kết nối...';
    connectBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang kết nối';
    connectBtn.className = 'btn btn-secondary btn-full';
    viewerBadge.style.display = 'none';
  } else {
    statusText.textContent = 'Chưa kết nối';
    connectBtn.innerHTML = '<i class="fa-solid fa-plug"></i> Kết Nối Live';
    connectBtn.className = 'btn btn-primary btn-full';
    viewerBadge.style.display = 'none';
  }
}

// ========================================
// EVENT LISTENERS
// ========================================
function setupEventListeners() {
  // TikTok connect
  connectBtn.addEventListener('click', async () => {
    const username = tiktokUsernameInput.value.trim().replace(/^@/, '');
    if (!username) {
      addLog('system', 'warning', 'Vui lòng nhập TikTok username!');
      return;
    }
    const isConnected = connectBtn.classList.contains('btn-danger');
    
    if (!isConnected) {
      // Set room to username and join
      currentRoom = username;
      window.history.replaceState({}, '', `?room=${encodeURIComponent(username)}`);
      socket.emit('join-room', currentRoom);
      // Reload config for this room
      await loadConfig();
    }
    
    const endpoint = isConnected ? roomUrl('/api/tiktok/disconnect') : '/api/tiktok/connect';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, room: currentRoom })
      });
      const data = await res.json();
      if (data.error) addLog('system', 'error', data.error);
    } catch (e) {
      addLog('system', 'error', 'Không thể liên lạc với server!');
    }
  });

  // Play/Pause
  playPauseBtn.addEventListener('click', () => {
    if (isPlaying) {
      if (currentSong && currentSong.isSynth) {
        synthEngine.stop();
        handlePlaybackFinished();
      } else {
        audioPlayer.pause();
        isPlaying = false;
        vinylDisk.classList.remove('playing');
        playIcon.className = 'fa-solid fa-play';
        playerStatusText.textContent = 'Tạm dừng';
      }
    } else {
      if (currentSong && !currentSong.isSynth) {
        audioPlayer.play();
        isPlaying = true;
        vinylDisk.classList.add('playing');
        playIcon.className = 'fa-solid fa-pause';
        playerStatusText.textContent = 'Đang phát nhạc';
      }
    }
  });

  // Skip
  skipBtn.addEventListener('click', () => {
    if (currentSong) {
      if (currentSong.isSynth) synthEngine.stop();
      else audioPlayer.pause();
      addLog('system', 'info', `Đã bỏ qua: ${currentSong.name}`);
      handlePlaybackFinished();
    }
  });

  // Clear Queue
  clearQueueBtn.addEventListener('click', () => {
    playbackQueue = [];
    renderQueueList();
    queueCountBadge.textContent = 0;
    addLog('system', 'info', 'Đã xóa hàng đợi');
  });

  // Volume
  volumeSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    audioPlayer.volume = val;
    updateVolumeIcon(val);
    volumeLabel.textContent = Math.round(val * 100) + '%';
    systemConfig.volume = val;
    saveConfig();
  });

  // Progress seek
  progressWrapper.addEventListener('click', (e) => {
    if (currentSong && !currentSong.isSynth && audioPlayer.duration) {
      const rect = progressWrapper.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      audioPlayer.currentTime = pct * audioPlayer.duration;
    }
  });

  // Upload
  uploadZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files));
  uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    handleFileUpload(e.dataTransfer.files);
  });

  // Settings
  if (minCoinsInput) {
    minCoinsInput.addEventListener('change', (e) => {
      systemConfig.minGiftCoins = parseInt(e.target.value) || 1;
      saveConfig();
    });
  }

  // Chat TTS toggle
  chatTtsToggle.addEventListener('click', () => {
    chatTtsToggle.classList.toggle('active');
    systemConfig.chatTtsEnabled = chatTtsToggle.classList.contains('active');
    saveConfig();
    if (!systemConfig.chatTtsEnabled && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  });

  // TTS Language selector
  const ttsLangSelect = document.getElementById('ttsLang');
  if (ttsLangSelect) {
    if (systemConfig.ttsLang) ttsLangSelect.value = systemConfig.ttsLang;
    ttsLangSelect.addEventListener('change', () => {
      systemConfig.ttsLang = ttsLangSelect.value;
      saveConfig();
    });
  }

  // Copy OBS URL
  copyUrlBtn.addEventListener('click', () => {
    const url = obsOverlayUrlInput.value;
    navigator.clipboard.writeText(url).then(() => {
      copyUrlBtn.textContent = '✓';
      setTimeout(() => { copyUrlBtn.textContent = 'Copy'; }, 2000);
    }).catch(() => {
      obsOverlayUrlInput.select();
      document.execCommand('copy');
      copyUrlBtn.textContent = '✓';
      setTimeout(() => { copyUrlBtn.textContent = 'Copy'; }, 2000);
    });
  });

  // Gift dropdown: show/hide manual input
  if (mappingGiftName) {
    mappingGiftName.addEventListener('change', () => {
      if (mappingGiftName.value === '__MANUAL__') {
        customGiftGroup.style.display = 'block';
        customGiftInput.focus();
      } else {
        customGiftGroup.style.display = 'none';
      }
    });
  }

  // Add Mapping
  if (addMappingBtn) {
    addMappingBtn.addEventListener('click', async () => {
      let giftName = mappingGiftName.value;
      if (giftName === '__MANUAL__') {
        giftName = customGiftInput.value.trim();
      }
      const songFilename = mappingSongSelect.value;
      if (!giftName || giftName === '__MANUAL__' || !songFilename) {
        addLog('system', 'warning', 'Chọn quà tặng và bài hát!');
        return;
      }
      systemConfig.giftMappings = systemConfig.giftMappings || {};
      systemConfig.giftMappings[giftName] = songFilename;
      await saveConfig();
      renderMappingList();
      mappingGiftName.value = '';
      mappingSongSelect.value = '';
      customGiftGroup.style.display = 'none';
      customGiftInput.value = '';
      addLog('system', 'success', `Đã liên kết quà "${giftName}" thành công!`);
    });
  }
}

// ========================================
// FILE UPLOAD
// ========================================
async function handleFileUpload(files) {
  if (!files || files.length === 0) return;

  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('songs', files[i]);
  }

  addLog('system', 'info', `Đang upload ${files.length} file...`);

  try {
    const res = await fetch('/api/songs/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      addLog('system', 'success', `Đã tải lên ${data.files.length} bài hát mới`);
      await loadSongsList();
    } else {
      addLog('system', 'error', `Upload thất bại: ${data.error}`);
    }
  } catch (e) {
    addLog('system', 'error', 'Lỗi kết nối khi upload');
  }

  // Reset file input
  fileInput.value = '';
}

// ========================================
// DELETE SONG
// ========================================
window.deleteSong = async (filename) => {
  if (!confirm('Xóa bài hát này?')) return;
  try {
    const res = await fetch(`/api/songs/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      addLog('system', 'info', 'Đã xóa bài hát');
      await loadSongsList();
    }
  } catch (e) {
    addLog('system', 'error', 'Không thể xóa bài hát');
  }
};

// ========================================
// RENDER FUNCTIONS
// ========================================
// --- Preview Audio Player ---
let previewAudio = null;
let previewingFile = null;

function togglePreview(filename) {
  // If already previewing this song, stop it
  if (previewingFile === filename && previewAudio && !previewAudio.paused) {
    previewAudio.pause();
    previewAudio.currentTime = 0;
    previewingFile = null;
    renderLibraryList();
    return;
  }
  // Stop previous preview
  if (previewAudio) {
    previewAudio.pause();
    previewAudio.currentTime = 0;
  }
  // Start new preview
  previewAudio = new Audio('/music/' + encodeURIComponent(filename));
  previewAudio.volume = 0.5;
  previewingFile = filename;
  previewAudio.play().catch(() => {});
  previewAudio.addEventListener('ended', () => {
    previewingFile = null;
    renderLibraryList();
  });
  renderLibraryList();
}

function renderLibraryList() {
  if (library.length === 0) {
    libraryList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-folder-open"></i><p>Chưa có bài hát nào. Upload nhạc ở trên!</p></div>';
    return;
  }
  libraryList.innerHTML = '';
  library.forEach(song => {
    const isAdded = activePlaylist.some(item => item.filename === song.filename);
    const isPreviewing = previewingFile === song.filename && previewAudio && !previewAudio.paused;
    const card = document.createElement('div');
    card.className = 'song-card' + (isPreviewing ? ' previewing' : '');
    card.innerHTML = `
      <div class="song-details">
        <button class="btn-preview ${isPreviewing ? 'playing' : ''}" onclick="event.stopPropagation(); togglePreview('${song.filename}')" title="Nghe thử">
          <i class="fa-solid ${isPreviewing ? 'fa-pause' : 'fa-play'}"></i>
        </button>
        <div class="song-meta">
          <div class="song-title-text">${song.name}</div>
          <div class="song-size-text">${formatSize(song.size)}</div>
        </div>
      </div>
      <div class="song-actions">
        <button class="btn-icon ${isAdded ? 'added' : ''}" onclick="addToPlaylist('${song.filename}')" ${isAdded ? 'disabled style="opacity:0.3"' : ''}>
          <i class="fa-solid ${isAdded ? 'fa-check' : 'fa-plus'}"></i>
        </button>
        <button class="btn-icon delete" onclick="deleteSong('${song.filename}')">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;
    libraryList.appendChild(card);
  });
}

function renderPlaylistList() {
  if (activePlaylist.length === 0) {
    playlistList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-list-check"></i><p>Bấm nút \'+\' bên dưới để thêm nhạc.</p></div>';
    return;
  }
  playlistList.innerHTML = '';
  activePlaylist.forEach((song, idx) => {
    const card = document.createElement('div');
    card.className = 'song-card';
    card.innerHTML = `
      <div class="song-details">
        <span class="song-index">${idx + 1}</span>
        <i class="fa-solid fa-music song-icon"></i>
        <div class="song-meta">
          <div class="song-title-text">${song.name}</div>
        </div>
      </div>
      <div class="song-actions">
        <button class="btn-icon" onclick="movePlaylistItem('${song.filename}', -1)" ${idx === 0 ? 'disabled style="opacity:0.3"' : ''}>
          <i class="fa-solid fa-chevron-up"></i>
        </button>
        <button class="btn-icon" onclick="movePlaylistItem('${song.filename}', 1)" ${idx === activePlaylist.length - 1 ? 'disabled style="opacity:0.3"' : ''}>
          <i class="fa-solid fa-chevron-down"></i>
        </button>
        <button class="btn-icon delete" onclick="removeFromPlaylist('${song.filename}')">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `;
    playlistList.appendChild(card);
  });
}

function renderQueueList() {
  if (playbackQueue.length === 0) {
    queueList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-hourglass"></i><p>Hàng đợi trống. Nhạc sẽ tự thêm khi nhận quà!</p></div>';
    return;
  }
  queueList.innerHTML = '';
  playbackQueue.forEach((song, idx) => {
    const card = document.createElement('div');
    card.className = 'song-card';
    card.innerHTML = `
      <div class="song-details">
        <span class="song-index">${idx + 1}</span>
        <i class="fa-solid fa-clock song-icon"></i>
        <div class="song-meta">
          <div class="song-title-text">${song.name}</div>
          <div class="song-size-text" style="color: var(--secondary-color)">
            🎁 @${song.giftInfo.uniqueId} tặng ${song.giftInfo.repeatCount}x ${song.giftInfo.giftName}
          </div>
        </div>
      </div>
      <div class="song-actions">
        <button class="btn-icon delete" onclick="removeFromQueue('${song.queueId}')">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `;
    queueList.appendChild(card);
  });
}

function renderMappingList() {
  const mappings = systemConfig.giftMappings || {};
  const keys = Object.keys(mappings);

  if (keys.length === 0) {
    mappingList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-link-slash"></i><p>Chưa có liên kết nào. Nhạc sẽ phát tuần tự theo Playlist.</p></div>';
    return;
  }

  mappingList.innerHTML = '';
  keys.forEach(giftName => {
    const songFilename = mappings[giftName];
    let songName = '';
    if (songFilename === 'SYNTH_FALLBACK') {
      songName = 'Nhạc Synthesizer';
    } else {
      const song = library.find(s => s.filename === songFilename);
      songName = song ? song.name : 'Bài hát đã bị xóa';
    }

    const card = document.createElement('div');
    card.className = 'song-card';
    card.innerHTML = `
      <div class="song-details">
        <i class="fa-solid fa-gift song-icon" style="color: var(--primary-color);"></i>
        <div class="song-meta">
          <div class="song-title-text">${giftName}</div>
          <div class="song-size-text" style="color: var(--secondary-color);">➔ ${songName}</div>
        </div>
      </div>
      <div class="song-actions">
        <button class="btn-icon delete" onclick="deleteMapping('${escapeQuotes(giftName)}')">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `;
    mappingList.appendChild(card);
  });
}

function updateMappingSongSelectOptions() {
  if (!mappingSongSelect) return;
  mappingSongSelect.innerHTML = '<option value="">-- Chọn bài hát --</option><option value="SYNTH_FALLBACK">Nhạc Synthesizer</option>';
  library.forEach(song => {
    const opt = document.createElement('option');
    opt.value = song.filename;
    opt.textContent = song.name;
    mappingSongSelect.appendChild(opt);
  });
}

// ========================================
// PLAYLIST OPERATIONS
// ========================================
window.addToPlaylist = async (filename) => {
  const song = library.find(s => s.filename === filename);
  if (song && !activePlaylist.some(item => item.filename === filename)) {
    activePlaylist.push(song);
    systemConfig.playlist = activePlaylist.map(item => item.filename);
    await saveConfig();
    renderPlaylistList();
    renderLibraryList();
    playlistCountBadge.textContent = activePlaylist.length;
  }
};

window.removeFromPlaylist = async (filename) => {
  activePlaylist = activePlaylist.filter(song => song.filename !== filename);
  systemConfig.playlist = activePlaylist.map(item => item.filename);
  await saveConfig();
  renderPlaylistList();
  renderLibraryList();
  playlistCountBadge.textContent = activePlaylist.length;
};

window.movePlaylistItem = async (filename, direction) => {
  const index = activePlaylist.findIndex(s => s.filename === filename);
  if (index === -1) return;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= activePlaylist.length) return;
  const temp = activePlaylist[index];
  activePlaylist[index] = activePlaylist[targetIndex];
  activePlaylist[targetIndex] = temp;
  systemConfig.playlist = activePlaylist.map(item => item.filename);
  await saveConfig();
  renderPlaylistList();
};

window.removeFromQueue = (queueId) => {
  playbackQueue = playbackQueue.filter(song => song.queueId !== queueId);
  renderQueueList();
  queueCountBadge.textContent = playbackQueue.length;
};

window.deleteMapping = async (giftName) => {
  if (systemConfig.giftMappings && systemConfig.giftMappings[giftName]) {
    delete systemConfig.giftMappings[giftName];
    await saveConfig();
    renderMappingList();
    addLog('system', 'info', `Đã xóa liên kết quà "${giftName}"`);
  }
};

// ========================================
// LOG
// ========================================
function addLog(type, status, data) {
  const logDiv = document.createElement('div');
  const now = new Date();
  const timeStr = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}]`;

  if (type === 'system') {
    logDiv.className = `sys-message ${status}`;
    logDiv.innerHTML = `<span class="log-time">${timeStr}</span> ${data}`;
  } else if (type === 'chat') {
    logDiv.className = 'chat-message';
    logDiv.innerHTML = `<span class="log-time">${timeStr}</span> <span class="username">${data.nickname}:</span> <span class="comment">${escapeHtml(data.comment)}</span>`;
  } else if (type === 'gift') {
    let giftIcon = '🎁';
    const nameLower = data.giftName.toLowerCase();
    if (nameLower.includes('rose') || nameLower.includes('hoa hồng')) giftIcon = '🌹';
    else if (nameLower.includes('heart') || nameLower.includes('tim')) giftIcon = '💖';
    else if (nameLower.includes('crown') || nameLower.includes('mũ')) giftIcon = '👑';
    else if (nameLower.includes('perfume') || nameLower.includes('nước hoa')) giftIcon = '🧪';
    else if (nameLower.includes('galaxy') || nameLower.includes('vũ trụ')) giftIcon = '🪐';

    const totalCoins = data.diamondCount * data.repeatCount;
    logDiv.className = 'gift-message';
    logDiv.innerHTML = `
      <div class="gift-message-info">
        <span class="gift-icon-badge">${giftIcon}</span>
        <div>
          <span class="username">${data.nickname}</span>
          <span class="gift-details">tặng ${data.repeatCount}x ${data.giftName}</span>
        </div>
      </div>
      <span class="diamond-count">${totalCoins} xu</span>
    `;
  }

  logContainer.appendChild(logDiv);
  logContainer.scrollTop = logContainer.scrollHeight;

  while (logContainer.children.length > 100) {
    logContainer.removeChild(logContainer.firstChild);
  }
}

// ========================================
// SOUND EFFECTS (globally available)
// ========================================
const soundEffects = {};
const soundNames = {
  1: 'vine-boom',
  2: 'oi-doi-oi',
  3: 'fart',
  4: 'baby-laugh'
};

// Load available sounds from server
async function loadSoundEffects() {
  try {
    const res = await fetch('/api/sounds');
    const files = await res.json();
    Object.entries(soundNames).forEach(([num, name]) => {
      const file = files.find(f => f.startsWith(name));
      if (file) {
        const audio = new Audio(`/sounds/${file}?t=${Date.now()}`);
        audio.preload = 'auto';
        soundEffects[num] = audio;
        // Mark button as loaded
        const btn = document.getElementById('soundBtn' + num);
        if (btn) btn.style.opacity = '1';
      } else {
        // Mark button as empty
        const btn = document.getElementById('soundBtn' + num);
        if (btn) btn.style.opacity = '0.4';
      }
    });
  } catch(e) {}
}

// Play sound
window.playSoundEffect = (num) => {
  const audio = soundEffects[num];
  if (!audio) {
    // No sound file — open upload
    uploadSoundForSlot(num);
    return;
  }
  audio.currentTime = 0;
  audio.play().catch(() => {});
  const btn = document.getElementById('soundBtn' + num);
  if (btn) {
    btn.classList.remove('playing');
    void btn.offsetWidth;
    btn.classList.add('playing');
    setTimeout(() => btn.classList.remove('playing'), 300);
  }
};

// Upload sound via file picker
function uploadSoundForSlot(slot) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('sound', file);
    formData.append('slot', String(slot));
    try {
      const res = await fetch('/api/upload-sound', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        addLog('system', 'success', `Upload âm thanh nút ${slot} thành công!`);
        loadSoundEffects(); // reload
      }
    } catch(e) {
      addLog('system', 'error', 'Lỗi upload âm thanh!');
    }
  };
  input.click();
}

// Setup long-press to change sound
function setupSoundLongPress() {
  [1,2,3,4].forEach(num => {
    const btn = document.getElementById('soundBtn' + num);
    if (!btn) return;
    let timer;
    btn.addEventListener('pointerdown', () => {
      timer = setTimeout(() => { uploadSoundForSlot(num); }, 800);
    });
    btn.addEventListener('pointerup', () => clearTimeout(timer));
    btn.addEventListener('pointerleave', () => clearTimeout(timer));
  });
}

// Init sounds on page load
loadSoundEffects();
setupSoundLongPress();

// ========================================
// NETWORK INFO
// ========================================
async function loadNetworkInfo() {
  try {
    const res = await fetch('/api/network-info');
    const data = await res.json();
    obsOverlayUrlInput.value = data.overlayUrl || `http://localhost:3000/overlay.html`;
  } catch (e) {}
}

// ========================================
// TIKTOK STATUS CHECK (for room)
// ========================================
async function checkTikTokStatus() {
  if (!currentRoom) return;
  try {
    const res = await fetch(roomUrl('/api/tiktok/status'));
    const data = await res.json();
    updateConnectionStatus(data.status, data.username);
    if (data.status === 'connected') {
      tiktokUsernameInput.value = data.username;
    }
  } catch(e) {}
}

// ========================================
// LICENSE STATUS
// ========================================
async function loadLicenseStatus() {
  try {
    const res = await fetch('/api/license-status');
    const data = await res.json();

    if (data.reason === 'trial' && data.daysLeft !== undefined) {
      trialBanner.textContent = `⏱️ Dùng thử — Còn ${data.daysLeft} ngày (hết hạn ${data.expiryDate})`;
      trialBanner.style.display = 'block';
      licenseInfo.innerHTML = `<p class="setting-help" style="color: var(--warning-color);">🔑 Bản dùng thử — Còn ${data.daysLeft} ngày</p>`;
    } else if (data.reason === 'monthly') {
      licenseInfo.innerHTML = `<p class="setting-help" style="color: var(--success-color);">✅ Đã kích hoạt — Key hợp lệ tháng này</p>`;
    } else {
      licenseInfo.innerHTML = `<p class="setting-help">Trạng thái: ${data.reason || 'Chưa rõ'}</p>`;
    }
  } catch (e) {
    licenseInfo.innerHTML = '<p class="setting-help">Không thể tải thông tin bản quyền</p>';
  }
}

// ========================================
// UTILITY
// ========================================
function updateVolumeIcon(vol) {
  if (vol == 0) volumeIcon.className = 'fa-solid fa-volume-xmark';
  else if (vol < 0.4) volumeIcon.className = 'fa-solid fa-volume-off';
  else if (vol < 0.8) volumeIcon.className = 'fa-solid fa-volume-low';
  else volumeIcon.className = 'fa-solid fa-volume-high';
}

function formatTime(seconds) {
  if (isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

function escapeQuotes(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
