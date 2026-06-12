const socket = io();
const giftAlertContainer = document.getElementById('giftAlertContainer');
const nowPlayingCard = document.querySelector('.now-playing-card');
const overlayVinyl = document.getElementById('overlayVinyl');
const stateLabel = document.getElementById('stateLabel');
const songTitle = document.getElementById('songTitle');
const songDonor = document.getElementById('songDonor');
const visualizer = document.getElementById('visualizer');

socket.on('gift', (data) => {
  let giftIcon = '🎁';
  const nameLower = data.giftName.toLowerCase();
  if (nameLower.includes('rose') || nameLower.includes('hoa hồng')) giftIcon = '🌹';
  else if (nameLower.includes('heart') || nameLower.includes('tim')) giftIcon = '💖';
  else if (nameLower.includes('crown') || nameLower.includes('mũ')) giftIcon = '👑';
  else if (nameLower.includes('perfume') || nameLower.includes('nước hoa')) giftIcon = '🧪';
  else if (nameLower.includes('galaxy') || nameLower.includes('vũ trụ')) giftIcon = '🪐';

  const alertCard = document.createElement('div');
  alertCard.className = 'gift-alert-card';
  alertCard.innerHTML = `
    <div class="gift-glow-effect"></div>
    <div class="sender-avatar">${giftIcon}</div>
    <div class="alert-content">
      <span class="sender-name">${data.nickname || data.uniqueId}</span>
      <span class="alert-desc">tặng ${data.repeatCount}x ${data.giftName}</span>
    </div>
  `;
  giftAlertContainer.appendChild(alertCard);
  setTimeout(() => { if (alertCard.parentNode) alertCard.parentNode.removeChild(alertCard); }, 5500);
});

socket.on('play-state', (data) => {
  if (data.isPlaying) {
    nowPlayingCard.classList.add('visible');
    overlayVinyl.classList.add('spinning');
    visualizer.classList.add('active');
    songTitle.textContent = data.songName || 'Đang phát nhạc...';
    if (data.nickname) {
      songDonor.textContent = `🎁 ${data.nickname} tặng ${data.giftCount || 1}x ${data.giftName || 'quà'}`;
    } else {
      songDonor.textContent = 'Đang phát từ danh sách';
    }
    stateLabel.innerHTML = '<i class="fa-solid fa-compact-disc"></i> ĐANG PHÁT';
  } else {
    overlayVinyl.classList.remove('spinning');
    visualizer.classList.remove('active');
    stateLabel.innerHTML = '<i class="fa-solid fa-compact-disc"></i> CHỜ NHẬN QUÀ';
    songTitle.textContent = 'Chờ nhận quà...';
    songDonor.textContent = 'Gửi quà tặng để phát nhạc';
    setTimeout(() => { nowPlayingCard.classList.remove('visible'); }, 3000);
  }
});
