// P2P Chat using WebRTC (PeerJS)
// After page load, ALL communication is browser-to-browser.
// PeerJS cloud is used only for signaling (exchanging connection metadata).

let peer, conn;
const CHUNK_SIZE = 64 * 1024; // 64KB chunks for file transfer
const CONNECTION_TIMEOUT_MS = 15000;
let connectionAttemptTimer = null;
let lastFocusedElement = null;

function updateConnectionUi(state, message = '') {
  const statusEl = document.getElementById('connStatus');
  const btn = document.getElementById('toggleConnBtn');
  const isConnected = state === 'connected';

  statusEl.className = 'status ' + state;
  statusEl.textContent = message;
  setChatState(isConnected);

  if (isConnected) {
    btn.disabled = false;
    btn.textContent = 'Disconnect';
    btn.className = 'btn-danger';
    return;
  }

  if (state === 'waiting') {
    btn.disabled = true;
    btn.textContent = 'Connecting...';
    btn.className = '';
    return;
  }

  btn.disabled = false;
  btn.textContent = 'Connect';
  btn.className = '';
}

function setChatState(isConnected) {
  const chatArea = document.getElementById('chatArea');
  chatArea.dataset.state = isConnected ? 'connected' : 'idle';
  document.getElementById('msgInput').disabled = !isConnected;
  document.getElementById('sendBtn').disabled = !isConnected;
  document.getElementById('fileBtn').disabled = !isConnected;
}

function clearConnectionAttempt() {
  clearTimeout(connectionAttemptTimer);
  connectionAttemptTimer = null;
}

function startConnectionAttempt(activeConn) {
  clearConnectionAttempt();
  connectionAttemptTimer = setTimeout(() => {
    if (conn !== activeConn || activeConn.open) return;
    conn = null;
    updateConnectionUi('disconnected', 'Connection timed out. Check the Peer ID and try again.');
    activeConn.close();
  }, CONNECTION_TIMEOUT_MS);
}

function resetTransientUi() {
  clearTimeout(typingTimeout);
  peerIsTyping = false;
  typingSent = false;
  document.getElementById('typingIndicator').hidden = true;
  showProgress(false);
}

function hasActiveConnection() {
  return Boolean(conn?.open);
}

// Random meaningful username generation
const adjectives = [
  'Happy', 'Clever', 'Quick', 'Bright', 'Snappy', 'Swift', 'Keen', 'Smart',
  'Bold', 'Mighty', 'Epic', 'Brave', 'Cool', 'Calm', 'Witty', 'Sleek',
  'Wild', 'Free', 'Strong', 'Jolly', 'Spirited', 'Curious', 'Agile', 'Vivid'
];
const nouns = [
  'Phoenix', 'Dragon', 'Eagle', 'Tiger', 'Panda', 'Shark', 'Falcon', 'Lynx',
  'Otter', 'Raven', 'Owl', 'Fox', 'Wolf', 'Bear', 'Lion', 'Cheetah',
  'Penguin', 'Whale', 'Dolphin', 'Angel', 'Comet', 'Storm', 'Wave', 'Flame'
];

function generateRandomUsername() {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 999);
  return `${adj}${noun}${num}`;
}

let myUsername = localStorage.getItem('p2p-chat-username') || generateRandomUsername();
let peerUsername = 'Peer';
let typingTimeout;
let peerIsTyping = false;
let lastFailedFile = null;
let isSendingFile = false;

// Initialize Peer
peer = new Peer(); // auto-generated ID, free PeerJS cloud for signaling

peer.on('open', (id) => {
  document.getElementById('myIdLoading').style.display = 'none';
  const el = document.getElementById('myId');
  el.style.display = 'block';
  el.value = id;
  el.onclick = async () => {
    el.select();
    try {
      await navigator.clipboard.writeText(id);
      showToast('Peer ID copied to your clipboard.');
    } catch (err) {
      console.error('Clipboard error:', err);
      showToast('Select and copy the Peer ID manually.');
    }
  };
  generateQRCode(id);
  document.getElementById('usernameInput').value = myUsername;
  if (!conn) updateConnectionUi('disconnected', 'Ready to connect');
});

peer.on('error', (err) => {
  console.error('PeerJS error:', err);

  // PeerJS signaling can disconnect while the WebRTC data channel stays alive.
  if (hasActiveConnection()) {
    updateConnectionUi('connected', 'Connected (signaling interrupted, chat still active)');
    return;
  }

  const pendingConnection = conn;
  conn = null;
  clearConnectionAttempt();
  pendingConnection?.close();
  const message = err?.type ? `${err.type}: ${err.message || 'Unknown error'}` : 'Connection error';
  updateConnectionUi('disconnected', message);
});

peer.on('disconnected', () => {
  if (hasActiveConnection()) {
    updateConnectionUi('connected', 'Connected (reconnecting signaling...)');
  } else {
    updateConnectionUi('waiting', 'Reconnecting to signaling...');
  }

  // Best effort reconnect to signaling server.
  if (peer && !peer.destroyed) {
    peer.reconnect();
  }
});

peer.on('close', () => {
  if (!hasActiveConnection()) {
    conn = null;
    clearConnectionAttempt();
    resetTransientUi();
    updateConnectionUi('disconnected', 'Peer closed');
  }
});

// Accept incoming connections
peer.on('connection', (incoming) => {
  if (conn && conn !== incoming) conn.close();
  clearConnectionAttempt();
  conn = incoming;
  updateConnectionUi('waiting', 'Incoming connection...');
  setupConnection(incoming);
});

// Connect to a remote peer
function toggleConnection() {
  if (conn?.open) {
    disconnectPeer();
  } else if (conn) {
    showToast('A connection attempt is already in progress.');
  } else {
    connectToPeer();
  }
}

function connectToPeer() {
  const remoteId = document.getElementById('peerId').value.trim();
  if (!remoteId) {
    updateConnectionUi('disconnected', 'Enter a Peer ID to connect.');
    return;
  }
  if (!peer?.open) {
    updateConnectionUi('disconnected', 'Signaling is not ready yet. Please try again shortly.');
    return;
  }
  updateConnectionUi('waiting', 'Connecting...');
  try {
    const outgoing = peer.connect(remoteId, { reliable: true });
    conn = outgoing;
    startConnectionAttempt(outgoing);
    setupConnection(outgoing);
  } catch (err) {
    console.error('Connection setup error:', err);
    conn = null;
    clearConnectionAttempt();
    updateConnectionUi('disconnected', 'Could not start the connection. Try again.');
  }
}

// Wire up data channel events
function setupConnection(activeConn) {
  activeConn.on('open', () => {
    if (conn !== activeConn) return;
    clearConnectionAttempt();
    updateConnectionUi('connected', 'Connected');
    activeConn.send({ type: 'username', name: myUsername });
  });

  activeConn.on('data', (data) => {
    if (data.type === 'username') {
      peerUsername = data.name;
      document.getElementById('typingName').textContent = peerUsername;
      addSystemMsg(peerUsername + ' connected');
    } else if (data.type === 'typing') {
      peerIsTyping = true;
      document.getElementById('typingIndicator').hidden = false;
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        peerIsTyping = false;
        document.getElementById('typingIndicator').hidden = true;
      }, 2000);
    } else if (typeof data === 'string') {
      peerIsTyping = false;
      document.getElementById('typingIndicator').hidden = true;
      addMsg(data, 'received', peerUsername);
    } else if (data.type === 'file-meta') {
      globalThis._incomingFile = {
        name: data.name,
        size: data.size,
        mimeType: data.mimeType || 'application/octet-stream',
        lastModified: data.lastModified || Date.now(),
        chunks: [],
        received: 0,
      };
      showProgress(true, 'Receiving ' + data.name);
      updateProgress(0, 0, data.size);
      addSystemMsg('Receiving file: ' + data.name + ' (' + formatBytes(data.size) + ')');
    } else if (data.type === 'file-chunk') {
      const f = globalThis._incomingFile;
      if (!f) return;
      f.chunks.push(data.chunk);
      f.received += data.chunk.byteLength;
      updateProgress(f.received / f.size, f.received, f.size);
      if (f.received >= f.size) {
        const receivedFile = typeof File === 'function'
          ? new File(f.chunks, f.name, { type: f.mimeType, lastModified: f.lastModified })
          : new Blob(f.chunks, { type: f.mimeType });
        const url = URL.createObjectURL(receivedFile);
        addFileMsg(f.name, url, 'received');
        saveToHistory({ type: 'file', author: peerUsername, filename: f.name, url, timestamp: new Date().toISOString() });
        showProgress(false);
        globalThis._incomingFile = null;
      }
    }
  });

  activeConn.on('close', () => {
    if (conn !== activeConn) return;
    clearConnectionAttempt();
    conn = null;
    resetTransientUi();
    updateConnectionUi('disconnected', 'Disconnected');
    addSystemMsg('Peer disconnected.');
    peerUsername = 'Peer';
  });

  activeConn.on('error', (err) => {
    if (conn !== activeConn) return;
    clearConnectionAttempt();
    conn = null;
    resetTransientUi();
    updateConnectionUi('disconnected', 'Connection error');
    addSystemMsg('Connection error: ' + err);
  });
}

// Send text message
function sendMessage() {
  const input = document.getElementById('msgInput');
  const text = input.value.trim();
  if (!text || !conn?.open) return;
  conn.send(text);
  addMsg(text, 'sent', 'You');
  saveToHistory({ type: 'text', author: 'You', text, timestamp: new Date().toISOString() });
  input.value = '';
  peerIsTyping = false;
  document.getElementById('typingIndicator').hidden = true;
}

// Detect typing and send typing indicator
let typingSent = false;
function onMessageInput() {
  if (!conn?.open) return;
  
  const input = document.getElementById('msgInput');
  if (input.value.trim().length > 0) {
    if (!typingSent) {
      conn.send({ type: 'typing' });
      typingSent = true;
    }
  } else {
    typingSent = false;
  }
}

// Clear typing flag when focus leaves input
function onMessageInputBlur() {
  typingSent = false;
}
function disconnectPeer() {
  const activeConn = conn;
  conn = null;
  clearConnectionAttempt();
  resetTransientUi();
  if (activeConn) activeConn.close();
  document.getElementById('peerId').value = '';
  updateConnectionUi('disconnected', 'Disconnected');
  clearChatHistory();
}

// Save message to local storage
function saveToHistory(msg) {
  try {
    const history = JSON.parse(localStorage.getItem('p2p-chat-history') || '[]');
    history.push(msg);
    if (history.length > 100) history.shift();
    localStorage.setItem('p2p-chat-history', JSON.stringify(history));
  } catch (e) {
    console.log('Storage limit exceeded', e);
  }
}

// Load chat history
function loadHistory() {
  try {
    const history = JSON.parse(localStorage.getItem('p2p-chat-history') || '[]');
    const msgDiv = document.getElementById('messages');
    msgDiv.innerHTML = '';
    history.forEach(msg => {
      if (msg.type === 'text') {
        addMsg(msg.text, msg.author === 'You' ? 'sent' : 'received', msg.author);
      }
    });
    document.getElementById('typingIndicator').style.display = 'none';
  } catch (e) {
    console.log('Error loading history', e);
  }
}

// Clear chat history
function clearChatHistory() {
  document.getElementById('messages').innerHTML = '';
  localStorage.removeItem('p2p-chat-history');
}

function openClearHistoryDialog() {
  openModal('clearHistoryModal', 'cancelClearBtn');
}

function closeClearHistoryDialog() {
  closeModal('clearHistoryModal');
}

function confirmClearChatHistory() {
  clearChatHistory();
  closeClearHistoryDialog();
  showToast('Local chat history cleared.');
}

// Save username
function saveUsername() {
  const input = document.getElementById('usernameInput');
  myUsername = input.value.trim() || 'Anonymous';
  localStorage.setItem('p2p-chat-username', myUsername);
  if (conn?.open) {
    conn.send({ type: 'username', name: myUsername });
  }
}

// Send file via data channel
async function sendFile(fileOverride) {
  if (isSendingFile) return;

  const fileInput = document.getElementById('fileInput');
  const file = fileOverride || fileInput.files[0];
  if (!file || !conn?.open) return;

  isSendingFile = true;
  lastFailedFile = null;

  conn.send({
    type: 'file-meta',
    name: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    lastModified: file.lastModified || Date.now(),
  });
  addSystemMsg('Sending file: ' + file.name + ' (' + formatBytes(file.size) + ')');
  showProgress(true, 'Sending ' + file.name);

  let offset = 0;

  try {
    while (offset < file.size) {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const chunk = await slice.arrayBuffer();
      conn.send({ type: 'file-chunk', chunk });
      offset += chunk.byteLength;
      updateProgress(offset / file.size, offset, file.size);
    }

    addMsg('Sent file: ' + file.name, 'sent', 'You');
    saveToHistory({ type: 'file', author: 'You', filename: file.name, timestamp: new Date().toISOString() });
    showProgress(false);
    fileInput.value = '';
    lastFailedFile = null;
  } catch (err) {
    console.error('File send failed:', err);
    lastFailedFile = file;
    addSystemActionMsg('File transfer failed: ' + file.name, 'Retry', 'retryLastFailedFile()');
    showProgress(false);
  } finally {
    isSendingFile = false;
  }
}

async function retryLastFailedFile() {
  if (!lastFailedFile) return;
  await sendFile(lastFailedFile);
}

// UI Helpers
function addMsg(text, type, author = type === 'sent' ? 'You' : 'Peer') {
  const div = document.createElement('div');
  div.className = 'msg ' + type;
  div.innerHTML = escapeHtml(text) + '<div class="meta">' + author + ' · ' + timeNow() + '</div>';
  document.getElementById('messages').appendChild(div);
  div.scrollIntoView({ behavior: 'smooth' });
}

function addFileMsg(name, url, type) {
  const div = document.createElement('div');
  div.className = 'msg ' + type;
  div.innerHTML = '<a href="' + url + '" download="' + escapeHtml(name) + '" style="color:#53d769">' + escapeHtml(name) + '</a><div class="meta">' + (type === 'sent' ? 'You' : 'Peer') + ' · ' + timeNow() + '</div>';
  document.getElementById('messages').appendChild(div);
  div.scrollIntoView({ behavior: 'smooth' });
}

function addSystemMsg(text) {
  const div = document.createElement('div');
  div.className = 'system-msg';
  div.textContent = text;
  document.getElementById('messages').appendChild(div);
  div.scrollIntoView({ behavior: 'smooth' });
}

function addSystemActionMsg(text, actionLabel, actionHandler) {
  const div = document.createElement('div');
  div.style.cssText = 'text-align:center; font-size:0.8em; color:#888; margin:8px 0;';

  const textNode = document.createElement('span');
  textNode.textContent = '— ' + text + ' — ';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-secondary';
  button.textContent = actionLabel;
  button.setAttribute('onclick', actionHandler);

  div.appendChild(textNode);
  div.appendChild(button);
  document.getElementById('messages').appendChild(div);
  div.scrollIntoView({ behavior: 'smooth' });
}

function showProgress(visible, name = '') {
  const progress = document.getElementById('progress');
  progress.style.display = visible ? 'block' : 'none';
  if (visible) document.getElementById('progressName').textContent = name;
}

function updateProgress(ratio, transferred = 0, total = 0) {
  const percentage = Math.min(100, Math.round(ratio * 100));
  document.getElementById('progressBar').style.width = percentage + '%';
  document.getElementById('progressText').textContent = total ? formatBytes(transferred) + ' / ' + formatBytes(total) + ' (' + percentage + '%)' : percentage + '%';
  document.getElementById('progressTrack').setAttribute('aria-valuenow', String(percentage));
}

function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

function timeNow() {
  return new Date().toLocaleTimeString();
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

// QR Code generation
function generateQRCode(id) {
  const container = document.getElementById('qrcode');
  container.innerHTML = '';
  new QRCode(container, {
    text: id,
    width: 160,
    height: 160,
    colorDark: '#53d769',
    colorLight: '#0a1f3e',
    correctLevel: QRCode.CorrectLevel.M,
  });
  document.getElementById('qrcodeContainer').style.display = 'block';
}

// QR Code scanner
let _html5QrScanner = null;

function openQRScanner() {
  const modal = document.getElementById('qrModal');
  openModal('qrModal', 'closeQrBtn');
  _html5QrScanner = new Html5Qrcode('qr-reader');
  _html5QrScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 240, height: 240 } },
    (decodedText) => {
      document.getElementById('peerId').value = decodedText.trim();
      closeQRScanner();
      document.getElementById('toggleConnBtn').focus();
      showToast('Peer ID added. Review it, then choose Connect.');
    },
    () => { /* scan misses are normal, ignore */ }
  ).catch((err) => {
    console.error('Camera start error:', err);
    closeQRScanner();
    showToast('Camera access was unavailable. Paste the Peer ID manually.');
  });
}

function closeQRScanner() {
  closeModal('qrModal');
  if (_html5QrScanner) {
    _html5QrScanner.stop().catch(() => {});
    _html5QrScanner = null;
  }
}

function openModal(modalId, focusTargetId) {
  lastFocusedElement = document.activeElement;
  const modal = document.getElementById(modalId);
  modal.hidden = false;
  modal.classList.add('is-open');
  document.getElementById(focusTargetId).focus();
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  modal.classList.remove('is-open');
  modal.hidden = true;
  lastFocusedElement?.focus();
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => { toast.hidden = true; }, 3500);
}

function setupUiInteractions() {
  const chatInput = document.getElementById('chatInputContainer');
  ['dragenter', 'dragover'].forEach((eventName) => chatInput.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (conn?.open) chatInput.classList.add('is-dragging');
  }));
  ['dragleave', 'drop'].forEach((eventName) => chatInput.addEventListener(eventName, (event) => {
    event.preventDefault();
    chatInput.classList.remove('is-dragging');
  }));
  chatInput.addEventListener('drop', (event) => {
    const [file] = event.dataTransfer.files;
    if (file) sendFile(file);
  });
  document.addEventListener('keydown', (event) => {
    const openModalElement = document.querySelector('.modal.is-open');
    if (!openModalElement) return;
    if (event.key === 'Escape') {
      if (openModalElement.id === 'qrModal') closeQRScanner();
      else closeClearHistoryDialog();
      return;
    }
    if (event.key === 'Tab') {
      const focusable = [...openModalElement.querySelectorAll('button:not([disabled]), [href], input:not([disabled])')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  window.lucide?.createIcons();
}

setupUiInteractions();
