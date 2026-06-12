// ============================================================
// TikTok Live Auto Music â€” Android (Mobile SPA) â€” Main App JS
// ============================================================

// === CLIENT DEVICE LICENSE SYSTEM ===
// Generate unique device ID for this browser
if (!localStorage.getItem('device_id')) {
  localStorage.setItem('device_id', 'DEV-' + Math.random().toString(36).substring(2, 10).toUpperCase() + '-' + Math.random().toString(36).substring(2, 10).toUpperCase());
}
const __deviceId = localStorage.getItem('device_id');
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
if (!window.location.pathname.includes('activation.html') && !window.location.pathname.includes('admin-generator.html')) {
  __originalFetch('/api/verify-license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: __deviceId, key: __licenseKey })
  })
  .then(r => r.json())
  .then(data => {
    if (!data.activated) {
      window.location.href = '/activation.html?reason=' + (data.reason || 'not_activated');
    }
  })
  .catch(e => console.error('License check error', e));
}

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
});

// ========================================
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
// CONFIG
// ========================================
async function loadConfig() {
  try {
    const res = await fetch(roomUrl('/api/config'));
    systemConfig = { ...systemConfig, ...(await res.json()) };

    tiktokUsernameInput.value = systemConfig.tiktokUsername || '';
    minCoinsInput.value = systemConfig.minGiftCoins || 1;

    // Volume
    const vol = systemConfig.volume !== undefined ? systemConfig.volume : 0.7;
    volumeSlider.value = vol;
    audioPlayer.volume = vol;
    updateVolumeIcon(vol);
    volumeLabel.textContent = Math.round(vol * 100) + '%';

    // Chat TTS toggle
    if (systemConfig.chatTtsEnabled) {
      chatTtsToggle.classList.add('active');
    }

    // Gift mappings
    systemConfig.giftMappings = systemConfig.giftMappings || {};
    renderMappingList();
  } catch (e) {
    console.error('Error loading config:', e);
  }
}

async function saveConfig() {
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

    songCountBadge.textContent = `${library.length} bÃ i`;

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
    addLog('system', 'error', 'KhÃ´ng thá»ƒ táº£i danh sÃ¡ch nháº¡c');
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

    const minCoins = parseInt(minCoinsInput.value) || 1;
    const totalCoins = data.diamondCount * data.repeatCount;

    if (totalCoins < minCoins) {
      addLog('system', 'info', `Bá» qua quÃ  tá»« @${data.uniqueId} (${totalCoins} xu < ${minCoins} xu tá»‘i thiá»ƒu)`);
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
      addLog('system', 'info', `QuÃ  "${giftNameClean}" â†’ bÃ i: ${song.name}`);
    }
  }

  // 2. Fallback to playlist sequential
  if (!songToQueue) {
    if (activePlaylist.length > 0) {
      if (nextPlaylistIndex >= activePlaylist.length) nextPlaylistIndex = 0;
      songToQueue = { ...activePlaylist[nextPlaylistIndex] };
      nextPlaylistIndex++;
    } else {
      addLog('system', 'warning', `Nháº­n quÃ  "${giftNameClean}" nhÆ°ng playlist trá»‘ng!`);
      return;
    }
  }

  songToQueue.giftInfo = giftData;
  songToQueue.queueId = Date.now() + '_' + Math.random().toString(36).substr(2, 5);

  playbackQueue.push(songToQueue);
  renderQueueList();
  queueCountBadge.textContent = playbackQueue.length;

  addLog('system', 'success', `ÄÃ£ thÃªm: ${songToQueue.name} (bá»Ÿi @${giftData.uniqueId})`);
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
  playerStatusText.textContent = 'Äang chuáº©n bá»‹...';

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

  playerStatusText.textContent = 'Äang phÃ¡t nháº¡c';
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
      addLog('system', 'error', `KhÃ´ng thá»ƒ phÃ¡t: ${song.name}. Bá» qua.`);
      handlePlaybackFinished();
    }
  }
}

function handlePlaybackFinished() {
  isPlaying = false;
  currentSong = null;
  vinylDisk.classList.remove('playing');
  playIcon.className = 'fa-solid fa-play';
  currentSongTitle.textContent = 'ChÆ°a phÃ¡t nháº¡c';
  playerStatusText.textContent = 'Äang dá»«ng';
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
// TTS â€” Auto Language Detection + Emoji Filter
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
  if (/[Ã Ã¡áº¡áº£Ã£Ã¢áº§áº¥áº­áº©áº«Äƒáº±áº¯áº·áº³áºµÃ¨Ã©áº¹áº»áº½Ãªá»áº¿á»‡á»ƒá»…Ã¬Ã­á»‹á»‰Ä©Ã²Ã³á»á»ÃµÃ´á»“á»‘á»™á»•á»—Æ¡á»á»›á»£á»Ÿá»¡Ã¹Ãºá»¥á»§Å©Æ°á»«á»©á»±á»­á»¯á»³Ã½á»µá»·á»¹Ä‘]/i.test(clean)) {
    return 'vi-VN';
  }
  // Chinese characters
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(clean)) {
    return 'zh-CN';
  }
  // Japanese: Hiragana or Katakana
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(clean)) {
    return 'ja-JP';
  }
  // Korean: Hangul
  if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(clean)) {
    return 'ko-KR';
  }
  // Thai
  if (/[\u0e00-\u0e7f]/.test(clean)) {
    return 'th-TH';
  }
  // Arabic
  if (/[\u0600-\u06ff]/.test(clean)) {
    return 'ar-SA';
  }
  // Russian/Cyrillic
  if (/[\u0400-\u04ff]/.test(clean)) {
    return 'ru-RU';
  }
  // Hindi/Devanagari
  if (/[\u0900-\u097f]/.test(clean)) {
    return 'hi-IN';
  }
  // Default: English for Latin characters
  if (/[a-zA-Z]/.test(clean)) {
    return 'en-US';
  }
  // Fallback
  return 'vi-VN';
}

function speakText(text, forceLang) {
  if (!('speechSynthesis' in window)) return;
  
  // Strip ALL non-text characters (emojis, icons, symbols, stickers)
  const cleanText = keepTextOnly(text);
  if (!cleanText) return;
  
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = forceLang || detectLanguage(cleanText);
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
    connectBtn.innerHTML = '<i class="fa-solid fa-plug-circle-xmark"></i> Ngáº¯t Káº¿t Ná»‘i';
    connectBtn.className = 'btn btn-danger btn-full';
    viewerBadge.style.display = 'inline-flex';
  } else if (status === 'connecting') {
    statusText.textContent = 'Äang káº¿t ná»‘i...';
    connectBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Äang káº¿t ná»‘i';
    connectBtn.className = 'btn btn-secondary btn-full';
    viewerBadge.style.display = 'none';
  } else {
    statusText.textContent = 'ChÆ°a káº¿t ná»‘i';
    connectBtn.innerHTML = '<i class="fa-solid fa-plug"></i> Káº¿t Ná»‘i Live';
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
      addLog('system', 'warning', 'Vui lÃ²ng nháº­p TikTok username!');
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
      addLog('system', 'error', 'KhÃ´ng thá»ƒ liÃªn láº¡c vá»›i server!');
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
        playerStatusText.textContent = 'Táº¡m dá»«ng';
      }
    } else {
      if (currentSong && !currentSong.isSynth) {
        audioPlayer.play();
        isPlaying = true;
        vinylDisk.classList.add('playing');
        playIcon.className = 'fa-solid fa-pause';
        playerStatusText.textContent = 'Äang phÃ¡t nháº¡c';
      }
    }
  });

  // Skip
  skipBtn.addEventListener('click', () => {
    if (currentSong) {
      if (currentSong.isSynth) synthEngine.stop();
      else audioPlayer.pause();
      addLog('system', 'info', `ÄÃ£ bá» qua: ${currentSong.name}`);
      handlePlaybackFinished();
    }
  });

  // Clear Queue
  clearQueueBtn.addEventListener('click', () => {
    playbackQueue = [];
    renderQueueList();
    queueCountBadge.textContent = 0;
    addLog('system', 'info', 'ÄÃ£ xÃ³a hÃ ng Ä‘á»£i');
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
  minCoinsInput.addEventListener('change', (e) => {
    systemConfig.minGiftCoins = parseInt(e.target.value) || 1;
    saveConfig();
  });

  // Chat TTS toggle
  chatTtsToggle.addEventListener('click', () => {
    chatTtsToggle.classList.toggle('active');
    systemConfig.chatTtsEnabled = chatTtsToggle.classList.contains('active');
    saveConfig();
    if (!systemConfig.chatTtsEnabled && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  });

  // Copy OBS URL
  copyUrlBtn.addEventListener('click', () => {
    const url = obsOverlayUrlInput.value;
    navigator.clipboard.writeText(url).then(() => {
      copyUrlBtn.textContent = 'âœ“';
      setTimeout(() => { copyUrlBtn.textContent = 'Copy'; }, 2000);
    }).catch(() => {
      obsOverlayUrlInput.select();
      document.execCommand('copy');
      copyUrlBtn.textContent = 'âœ“';
      setTimeout(() => { copyUrlBtn.textContent = 'Copy'; }, 2000);
    });
  });

  // Add Mapping
  if (addMappingBtn) {
    addMappingBtn.addEventListener('click', async () => {
      const giftName = mappingGiftName.value.trim();
      const songFilename = mappingSongSelect.value;
      if (!giftName || !songFilename) {
        addLog('system', 'warning', 'Äiá»n Ä‘áº§y Ä‘á»§ tÃªn quÃ  vÃ  chá»n bÃ i hÃ¡t!');
        return;
      }
      systemConfig.giftMappings = systemConfig.giftMappings || {};
      systemConfig.giftMappings[giftName] = songFilename;
      await saveConfig();
      renderMappingList();
      mappingGiftName.value = '';
      mappingSongSelect.value = '';
      addLog('system', 'success', `ÄÃ£ liÃªn káº¿t quÃ  "${giftName}" thÃ nh cÃ´ng!`);
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

  addLog('system', 'info', `Äang upload ${files.length} file...`);

  try {
    const res = await fetch('/api/songs/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      addLog('system', 'success', `ÄÃ£ táº£i lÃªn ${data.files.length} bÃ i hÃ¡t má»›i`);
      await loadSongsList();
    } else {
      addLog('system', 'error', `Upload tháº¥t báº¡i: ${data.error}`);
    }
  } catch (e) {
    addLog('system', 'error', 'Lá»—i káº¿t ná»‘i khi upload');
  }

  // Reset file input
  fileInput.value = '';
}

// ========================================
// DELETE SONG
// ========================================
window.deleteSong = async (filename) => {
  if (!confirm('XÃ³a bÃ i hÃ¡t nÃ y?')) return;
  try {
    const res = await fetch(`/api/songs/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      addLog('system', 'info', 'ÄÃ£ xÃ³a bÃ i hÃ¡t');
      await loadSongsList();
    }
  } catch (e) {
    addLog('system', 'error', 'KhÃ´ng thá»ƒ xÃ³a bÃ i hÃ¡t');
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
    libraryList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-folder-open"></i><p>ChÆ°a cÃ³ bÃ i hÃ¡t nÃ o. Upload nháº¡c á»Ÿ trÃªn!</p></div>';
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
        <button class="btn-preview ${isPreviewing ? 'playing' : ''}" onclick="event.stopPropagation(); togglePreview('${song.filename}')" title="Nghe thá»­">
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
    playlistList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-list-check"></i><p>Báº¥m nÃºt \'+\' bÃªn dÆ°á»›i Ä‘á»ƒ thÃªm nháº¡c.</p></div>';
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
    queueList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-hourglass"></i><p>HÃ ng Ä‘á»£i trá»‘ng. Nháº¡c sáº½ tá»± thÃªm khi nháº­n quÃ !</p></div>';
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
            ðŸŽ @${song.giftInfo.uniqueId} táº·ng ${song.giftInfo.repeatCount}x ${song.giftInfo.giftName}
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
    mappingList.innerHTML = '<div class="empty-state"><i class="fa-solid fa-link-slash"></i><p>ChÆ°a cÃ³ liÃªn káº¿t nÃ o. Nháº¡c sáº½ phÃ¡t tuáº§n tá»± theo Playlist.</p></div>';
    return;
  }

  mappingList.innerHTML = '';
  keys.forEach(giftName => {
    const songFilename = mappings[giftName];
    let songName = '';
    if (songFilename === 'SYNTH_FALLBACK') {
      songName = 'Nháº¡c Synthesizer';
    } else {
      const song = library.find(s => s.filename === songFilename);
      songName = song ? song.name : 'BÃ i hÃ¡t Ä‘Ã£ bá»‹ xÃ³a';
    }

    const card = document.createElement('div');
    card.className = 'song-card';
    card.innerHTML = `
      <div class="song-details">
        <i class="fa-solid fa-gift song-icon" style="color: var(--primary-color);"></i>
        <div class="song-meta">
          <div class="song-title-text">${giftName}</div>
          <div class="song-size-text" style="color: var(--secondary-color);">âž” ${songName}</div>
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
  mappingSongSelect.innerHTML = '<option value="">-- Chá»n bÃ i hÃ¡t --</option><option value="SYNTH_FALLBACK">Nháº¡c Synthesizer</option>';
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
    addLog('system', 'info', `ÄÃ£ xÃ³a liÃªn káº¿t quÃ  "${giftName}"`);
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
    let giftIcon = 'ðŸŽ';
    const nameLower = data.giftName.toLowerCase();
    if (nameLower.includes('rose') || nameLower.includes('hoa há»“ng')) giftIcon = 'ðŸŒ¹';
    else if (nameLower.includes('heart') || nameLower.includes('tim')) giftIcon = 'ðŸ’–';
    else if (nameLower.includes('crown') || nameLower.includes('mÅ©')) giftIcon = 'ðŸ‘‘';
    else if (nameLower.includes('perfume') || nameLower.includes('nÆ°á»›c hoa')) giftIcon = 'ðŸ§ª';
    else if (nameLower.includes('galaxy') || nameLower.includes('vÅ© trá»¥')) giftIcon = 'ðŸª';

    const totalCoins = data.diamondCount * data.repeatCount;
    logDiv.className = 'gift-message';
    logDiv.innerHTML = `
      <div class="gift-message-info">
        <span class="gift-icon-badge">${giftIcon}</span>
        <div>
          <span class="username">${data.nickname}</span>
          <span class="gift-details">táº·ng ${data.repeatCount}x ${data.giftName}</span>
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
// MOCK EVENTS (globally available)
// ========================================
window.triggerMockGift = async (giftName, count, diamondCount) => {
  const userSeed = Math.floor(Math.random() * 1000);
  try {
    await fetch(roomUrl('/api/tiktok/mock-gift'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        giftName,
        count,
        diamondCount,
        nickname: `NgÆ°á»i xem ${userSeed}`,
        uniqueId: `viewer_${userSeed}`,
        room: currentRoom
      })
    });
  } catch (e) {}
};

window.triggerMockChat = async () => {
  const userSeed = Math.floor(Math.random() * 1000);
  const comments = ['ChÃ o chá»§ phÃ²ng!', 'Nháº¡c hay quÃ¡', 'ChÃ o má»i ngÆ°á»i', 'Xin chÃ o', 'Nháº¡c cuá»‘n quÃ¡'];
  try {
    await fetch(roomUrl('/api/tiktok/mock-chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: `NgÆ°á»i xem ${userSeed}`,
        uniqueId: `viewer_${userSeed}`,
        comment: comments[Math.floor(Math.random() * comments.length)],
        room: currentRoom
      })
    });
  } catch (e) {}
};

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
      trialBanner.textContent = `â±ï¸ DÃ¹ng thá»­ â€” CÃ²n ${data.daysLeft} ngÃ y (háº¿t háº¡n ${data.expiryDate})`;
      trialBanner.style.display = 'block';
      licenseInfo.innerHTML = `<p class="setting-help" style="color: var(--warning-color);">ðŸ”‘ Báº£n dÃ¹ng thá»­ â€” CÃ²n ${data.daysLeft} ngÃ y</p>`;
    } else if (data.reason === 'monthly') {
      licenseInfo.innerHTML = `<p class="setting-help" style="color: var(--success-color);">âœ… ÄÃ£ kÃ­ch hoáº¡t â€” Key há»£p lá»‡ thÃ¡ng nÃ y</p>`;
    } else {
      licenseInfo.innerHTML = `<p class="setting-help">Tráº¡ng thÃ¡i: ${data.reason || 'ChÆ°a rÃµ'}</p>`;
    }
  } catch (e) {
    licenseInfo.innerHTML = '<p class="setting-help">KhÃ´ng thá»ƒ táº£i thÃ´ng tin báº£n quyá»n</p>';
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
