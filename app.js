// P2P Chat using WebRTC (PeerJS)
// After page load, ALL communication is browser-to-browser.
// PeerJS cloud is used only for signaling (exchanging connection metadata).

let peer, conn;
const CHUNK_SIZE = 64 * 1024; // 64KB chunks for file transfer
const MAX_FILE_SIZE = 250 * 1024 * 1024;
const CONNECTION_TIMEOUT_MS = 15000;
const SEND_BUFFER_WAIT_TIMEOUT_MS = 10000;
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
const STORAGE_PREFIX = 'direcht';
const USERNAME_STORAGE_KEY = `${STORAGE_PREFIX}-username`;
const HISTORY_STORAGE_KEY = `${STORAGE_PREFIX}-history`;
const PEER_ID_STORAGE_KEY = `${STORAGE_PREFIX}-last-peer-id`;
const MESSAGE_QUEUE_STORAGE_KEY = `${STORAGE_PREFIX}-pending-messages`;
const RECEIVED_MESSAGE_STORAGE_KEY = `${STORAGE_PREFIX}-received-message-ids`;
let connectionAttemptTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let reconnecting = false;
let manualDisconnect = false;
let lastFocusedElement = null;

function updateConnectionUi(state, message = '') {
  const statusEl = dom.connStatus;
  const btn = dom.toggleConnBtn;
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
  const chatArea = dom.chatArea;
  chatArea.dataset.state = isConnected ? 'connected' : 'idle';
  dom.msgInput.disabled = !isConnected;
  dom.sendBtn.disabled = !isConnected;
  dom.fileBtn.disabled = !isConnected;
}

function clearConnectionAttempt() {
  clearTimeout(connectionAttemptTimer);
  connectionAttemptTimer = null;
}

function clearReconnectAttempt() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempt = 0;
  reconnecting = false;
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
  clearTimeout(typingRefreshTimer);
  peerIsTyping = false;
  typingSent = false;
  dom.typingIndicator.hidden = true;
  showProgress(false);
  globalThis._incomingFile = null;
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

let myUsername = localStorage.getItem(USERNAME_STORAGE_KEY) || generateRandomUsername();
let peerUsername = 'Peer';
let typingTimeout;
let peerIsTyping = false;
let typingRefreshTimer = null;
let lastFailedFile = null;
let isSendingFile = false;
let remotePeerId = localStorage.getItem(PEER_ID_STORAGE_KEY) || '';
const pendingMessages = new Map();
const receivedMessageIds = new Set();

function createId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function restoreSessionState() {
  dom.peerId.value = remotePeerId;
  loadHistory();
  try {
    const storedMessages = JSON.parse(localStorage.getItem(MESSAGE_QUEUE_STORAGE_KEY) || '[]');
    storedMessages.forEach((message) => pendingMessages.set(message.id, message));
    const storedReceivedIds = JSON.parse(localStorage.getItem(RECEIVED_MESSAGE_STORAGE_KEY) || '[]');
    storedReceivedIds.forEach((id) => receivedMessageIds.add(id));
  } catch (err) {
    console.warn('Could not restore session state:', err);
  }
}

function persistPendingMessages() {
  localStorage.setItem(MESSAGE_QUEUE_STORAGE_KEY, JSON.stringify([...pendingMessages.values()]));
}

function persistReceivedMessageIds() {
  localStorage.setItem(RECEIVED_MESSAGE_STORAGE_KEY, JSON.stringify([...receivedMessageIds].slice(-200)));
}

function sendPendingMessages(activeConn) {
  pendingMessages.forEach((message) => {
    sendData(activeConn, { type: 'message', ...message });
  });
}

function scheduleReconnect() {
  if (manualDisconnect || reconnectTimer || conn || !remotePeerId || peer?.destroyed) return;
  const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
  reconnectAttempt += 1;
  reconnecting = true;
  updateConnectionUi('waiting', `Reconnecting... attempt ${reconnectAttempt}`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (manualDisconnect) {
      reconnecting = false;
      return;
    }
    if (peer?.open) {
      connectToPeer(true);
    } else if (peer && !peer.destroyed) {
      peer.reconnect();
      scheduleReconnect();
    }
  }, delay);
}

// Initialize Peer
peer = new Peer(); // auto-generated ID, free PeerJS cloud for signaling

peer.on('open', (id) => {
  const wasReconnecting = reconnecting;
  reconnectAttempt = 0;
  reconnecting = false;
  dom.myIdLoading.style.display = 'none';
  const el = dom.myId;
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
  dom.usernameInput.value = myUsername;
  if (hasActiveConnection()) {
    updateConnectionUi('connected', 'Connected');
  } else if (!conn && !manualDisconnect) {
    updateConnectionUi('disconnected', wasReconnecting ? 'Ready to reconnect' : 'Ready to connect');
  }
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
  if (!manualDisconnect) scheduleReconnect();
});

peer.on('disconnected', () => {
  if (manualDisconnect) return;

  if (hasActiveConnection()) {
    updateConnectionUi('connected', 'Reconnected');
  } else {
    updateConnectionUi('waiting', 'Reconnecting to signaling...');
  }

  // Best effort reconnect to signaling server.
  if (!manualDisconnect && peer && !peer.destroyed) {
    peer.reconnect();
  }
  if (!hasActiveConnection()) scheduleReconnect();
});

peer.on('close', () => {
  if (!hasActiveConnection()) {
    conn = null;
    clearConnectionAttempt();
    resetTransientUi();
    updateConnectionUi('disconnected', 'Peer closed');
    if (!manualDisconnect) scheduleReconnect();
  }
});

// Accept incoming connections
peer.on('connection', (incoming) => {
  // A manual disconnect stops automatic retries, but does not reject a new
  // connection initiated explicitly by the other peer.
  manualDisconnect = false;

  if (conn && conn !== incoming) {
    if (conn.open) {
      incoming.close();
      return;
    }
    conn.close();
  }
  clearConnectionAttempt();
  clearReconnectAttempt();
  conn = incoming;
  remotePeerId = incoming.peer;
  dom.peerId.value = remotePeerId;
  localStorage.setItem(PEER_ID_STORAGE_KEY, remotePeerId);
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

function connectToPeer(isAutomatic = false) {
  if (isAutomatic && manualDisconnect) return;

  const peerIdInput = dom.peerId;
  const remoteId = peerIdInput.value.trim();
  if (!remoteId) {
    updateConnectionUi('disconnected', 'Enter a Peer ID to connect.');
    return;
  }
  peerIdInput.value = remoteId;
  remotePeerId = remoteId;
  localStorage.setItem(PEER_ID_STORAGE_KEY, remotePeerId);
  if (!peer?.open) {
    updateConnectionUi('disconnected', 'Signaling is not ready yet. Please try again shortly.');
    return;
  }
  if (!isAutomatic) {
    manualDisconnect = false;
    clearReconnectAttempt();
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
    if (isAutomatic) scheduleReconnect();
  }
}

// Wire up data channel events
function setupConnection(activeConn) {
  activeConn.on('open', () => {
    if (conn !== activeConn) return;
    clearConnectionAttempt();
    clearReconnectAttempt();
    dom.peerId.value = activeConn.peer;
    remotePeerId = activeConn.peer;
    localStorage.setItem(PEER_ID_STORAGE_KEY, remotePeerId);
    updateConnectionUi('connected', 'Connected');
    sendData(activeConn, { type: 'username', name: myUsername });
    sendPendingMessages(activeConn);
  });

  activeConn.on('data', (data) => {
    if (conn !== activeConn) return;
    if (!data) return;
    if (typeof data === 'string') {
      addMessageFromPeer(activeConn, { id: null, text: data });
    } else if (data.type === 'username') {
      peerUsername = data.name;
      dom.typingName.textContent = peerUsername;
      addSystemMsg(peerUsername + ' connected');
    } else if (data.type === 'ack') {
      pendingMessages.delete(data.id);
      persistPendingMessages();
    } else if (data.type === 'message') {
      sendData(activeConn, { type: 'ack', id: data.id });
      addMessageFromPeer(activeConn, data);
    } else if (data.type === 'typing') {
      peerIsTyping = true;
      dom.typingIndicator.hidden = false;
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        peerIsTyping = false;
        dom.typingIndicator.hidden = true;
      }, 2000);
    } else if (data.type === 'file-meta') {
      if (!isValidFileMeta(data)) return;
      globalThis._incomingFile = {
        transferId: data.transferId,
        name: data.name,
        author: data.author || peerUsername,
        size: data.size,
        mimeType: data.mimeType || 'application/octet-stream',
        lastModified: data.lastModified || Date.now(),
        chunks: [],
        pendingChunks: new Map(),
        received: 0,
      };
      showProgress(true, 'Receiving ' + data.name);
      updateProgress(0, 0, data.size);
      addSystemMsg('Receiving file: ' + data.name + ' (' + formatBytes(data.size) + ')');
      processIncomingFileChunks(globalThis._incomingFile);
    } else if (data.type === 'file-chunk') {
      const f = globalThis._incomingFile;
      if (!f || f.transferId !== data.transferId) return;
      if (!isValidFileChunk(data, f)) return;
      f.pendingChunks.set(data.offset, data.chunk);
      processIncomingFileChunks(f);
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
    if (!manualDisconnect) scheduleReconnect();
  });

  activeConn.on('error', (err) => {
    if (conn !== activeConn) return;
    clearConnectionAttempt();
    conn = null;
    resetTransientUi();
    updateConnectionUi('disconnected', 'Connection error');
    addSystemMsg('Connection error: ' + err);
    if (!manualDisconnect) scheduleReconnect();
  });
}

function addMessageFromPeer(activeConn, data) {
  if (data.id && receivedMessageIds.has(data.id)) return;
  if (data.id) {
    receivedMessageIds.add(data.id);
    persistReceivedMessageIds();
  }
  peerIsTyping = false;
  dom.typingIndicator.hidden = true;
  addMsg(data.text, 'received', peerUsername);
  saveToHistory({ type: 'text', id: data.id, author: peerUsername, text: data.text, timestamp: data.timestamp || new Date().toISOString() });
}

function isValidFileMeta(data) {
  return typeof data.transferId === 'string'
    && typeof data.name === 'string'
    && Number.isInteger(data.size)
    && data.size >= 0
    && data.size <= MAX_FILE_SIZE;
}

function isValidFileChunk(data, fileState) {
  return Number.isInteger(data.offset)
    && data.offset >= 0
    && data.offset < fileState.size
    && data.chunk?.byteLength > 0
    && data.chunk.byteLength <= CHUNK_SIZE
    && data.offset + data.chunk.byteLength <= fileState.size;
}

function processIncomingFileChunks(fileState) {
  while (fileState.pendingChunks.has(fileState.received)) {
    const chunk = fileState.pendingChunks.get(fileState.received);
    fileState.pendingChunks.delete(fileState.received);
    fileState.chunks.push(chunk);
    fileState.received += chunk.byteLength;
  }
  updateProgress(fileState.size ? fileState.received / fileState.size : 1, fileState.received, fileState.size);
  if (fileState.received < fileState.size) return;

  const receivedFile = typeof File === 'function'
    ? new File(fileState.chunks, fileState.name, { type: fileState.mimeType, lastModified: fileState.lastModified })
    : new Blob(fileState.chunks, { type: fileState.mimeType });
  const url = URL.createObjectURL(receivedFile);
  addFileMsg(fileState.name, url, 'received');
  saveToHistory({ type: 'file', author: fileState.author, filename: fileState.name, url, timestamp: new Date().toISOString() });
  showProgress(false);
  globalThis._incomingFile = null;
}

function sendData(activeConn, data) {
  if (!activeConn?.open) return false;
  try {
    activeConn.send(data);
    return true;
  } catch (err) {
    console.error('Data send failed:', err);
    return false;
  }
}

// Send text message
function sendMessage() {
  const input = dom.msgInput;
  const text = input.value.trim();
  if (!text || !conn?.open) return;
  const message = {
    id: createId(),
    text,
    timestamp: new Date().toISOString(),
  };
  pendingMessages.set(message.id, message);
  persistPendingMessages();
  if (!sendData(conn, { type: 'message', ...message })) {
    showToast('Message could not be sent. It will be retried.');
    return;
  }
  addMsg(text, 'sent', 'You');
  saveToHistory({ type: 'text', author: 'You', text, timestamp: message.timestamp });
  input.value = '';
  peerIsTyping = false;
  dom.typingIndicator.hidden = true;
}

// Detect typing and send typing indicator
let typingSent = false;
function onMessageInput() {
  if (!conn?.open) return;
  
  const input = dom.msgInput;
  if (input.value.trim().length > 0) {
    if (!typingSent) {
      sendData(conn, { type: 'typing' });
      typingSent = true;
      clearTimeout(typingRefreshTimer);
      typingRefreshTimer = setTimeout(() => {
        typingSent = false;
        onMessageInput();
      }, 1500);
    }
  } else {
    typingSent = false;
  }
}

// Clear typing flag when focus leaves input
function onMessageInputBlur() {
  typingSent = false;
  clearTimeout(typingRefreshTimer);
}
function disconnectPeer() {
  manualDisconnect = true;
  const activeConn = conn;
  conn = null;
  clearConnectionAttempt();
  clearReconnectAttempt();
  pendingMessages.clear();
  persistPendingMessages();
  resetTransientUi();
  if (activeConn) activeConn.close();
  updateConnectionUi('disconnected', 'Disconnected');
  clearChatHistory();
}

// Save message to local storage
function saveToHistory(msg) {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
    history.push(msg);
    if (history.length > 100) history.shift();
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch (e) {
    console.log('Storage limit exceeded', e);
    showToast('Chat history could not be saved. Storage is full.');
  }
}

// Load chat history
function loadHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
    const msgDiv = dom.messages;
    msgDiv.innerHTML = '';
    history.forEach(msg => {
      if (msg.type === 'text') {
        addMsg(msg.text, msg.author === 'You' ? 'sent' : 'received', msg.author);
      }
    });
    dom.typingIndicator.hidden = true;
  } catch (e) {
    console.log('Error loading history', e);
  }
}

// Clear chat history
function clearChatHistory() {
  dom.messages.innerHTML = '';
  localStorage.removeItem(HISTORY_STORAGE_KEY);
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
  const input = dom.usernameInput;
  myUsername = input.value.trim() || 'Anonymous';
  localStorage.setItem(USERNAME_STORAGE_KEY, myUsername);
  if (conn?.open) {
    sendData(conn, { type: 'username', name: myUsername });
  }
}

// Send file via data channel
async function sendFile(fileOverride) {
  if (isSendingFile) return;

  const fileInput = dom.fileInput;
  const file = fileOverride || fileInput.files[0];
  if (!file || !conn?.open) return;
  if (file.size > MAX_FILE_SIZE) {
    showToast('Files must be 250 MB or smaller.');
    return;
  }

  isSendingFile = true;
  lastFailedFile = null;
  const activeConn = conn;
  const transferId = createId();

  let offset = 0;

  try {
    activeConn.send({
      type: 'file-meta',
      transferId,
      author: myUsername,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      lastModified: file.lastModified || Date.now(),
    });
    addSystemMsg('Sending file: ' + file.name + ' (' + formatBytes(file.size) + ')');
    showProgress(true, 'Sending ' + file.name);

    while (offset < file.size) {
      if (conn !== activeConn || !activeConn.open) throw new Error('Connection lost during file transfer');
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const chunk = await slice.arrayBuffer();
      await waitForSendCapacity(activeConn);
      activeConn.send({ type: 'file-chunk', transferId, offset, chunk });
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

async function waitForSendCapacity(activeConn) {
  const dataChannel = activeConn.dataChannel || activeConn._dc;
  const deadline = Date.now() + SEND_BUFFER_WAIT_TIMEOUT_MS;
  while (dataChannel?.bufferedAmount > CHUNK_SIZE * 16) {
    if (Date.now() >= deadline) throw new Error('Send buffer did not drain');
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (!activeConn.open) throw new Error('Connection lost during file transfer');
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
  dom.messages.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth' });
}

function addFileMsg(name, url, type) {
  const div = document.createElement('div');
  div.className = 'msg ' + type;
  div.innerHTML = '<a href="' + url + '" download="' + escapeHtml(name) + '" style="color:#53d769">' + escapeHtml(name) + '</a><div class="meta">' + (type === 'sent' ? 'You' : 'Peer') + ' · ' + timeNow() + '</div>';
  dom.messages.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth' });
}

function addSystemMsg(text) {
  const div = document.createElement('div');
  div.className = 'system-msg';
  div.textContent = text;
  dom.messages.appendChild(div);
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
  dom.messages.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth' });
}

function showProgress(visible, name = '') {
  const progress = dom.progress;
  progress.style.display = visible ? 'block' : 'none';
  if (visible) dom.progressName.textContent = name;
}

function updateProgress(ratio, transferred = 0, total = 0) {
  const percentage = Math.min(100, Math.round(ratio * 100));
  dom.progressBar.style.width = percentage + '%';
  dom.progressText.textContent = total ? formatBytes(transferred) + ' / ' + formatBytes(total) + ' (' + percentage + '%)' : percentage + '%';
  dom.progressTrack.setAttribute('aria-valuenow', String(percentage));
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
  const container = dom.qrcode;
  container.innerHTML = '';
  new QRCode(container, {
    text: id,
    width: 160,
    height: 160,
    colorDark: '#53d769',
    colorLight: '#0a1f3e',
    correctLevel: QRCode.CorrectLevel.M,
  });
  dom.qrcodeContainer.style.display = 'block';
}

// QR Code scanner
let _html5QrScanner = null;
let qrScanHandled = false;

function openQRScanner() {
  if (_html5QrScanner) return;

  qrScanHandled = false;
  openModal('qrModal', 'closeQrBtn');
  _html5QrScanner = new Html5Qrcode('qr-reader');
  _html5QrScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 240, height: 240 } },
    (decodedText) => {
      if (qrScanHandled) return;
      qrScanHandled = true;
      dom.peerId.value = decodedText.trim();
      closeQRScanner();
      connectToPeer();
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
  const modal = dom.byId(modalId);
  modal.hidden = false;
  modal.classList.add('is-open');
  dom.byId(focusTargetId).focus();
}

function closeModal(modalId) {
  const modal = dom.byId(modalId);
  modal.classList.remove('is-open');
  modal.hidden = true;
  lastFocusedElement?.focus();
}

function showToast(message) {
  const toast = dom.toast;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => { toast.hidden = true; }, 3500);
}

function setupUiInteractions() {
  const chatInput = dom.chatInputContainer;

  window.openFilePicker = () => dom.fileInput.click();
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

window.addEventListener('pagehide', () => {
  const activeConn = conn;
  conn = null;
  clearConnectionAttempt();
  clearReconnectAttempt();
  activeConn?.close();
  if (peer && !peer.destroyed) peer.disconnect();
});

restoreSessionState();
setupUiInteractions();
