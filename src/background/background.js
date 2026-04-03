importScripts("../shared/constants.js", "../shared/utils.js", "../shared/storage.js");

const {
  DEFAULT_SESSION_STATE,
  MESSAGE_TYPES,
  PEERJS_KEY,
  PEER_OPTIONS,
  ROOM_EVENT_TYPES,
  TOAST_DURATION_MS
} = BiliTogetherConstants;
const {
  canonicalizePlaybackState,
  compareEventOrder,
  now,
  randomId,
  shallowEqualVideoIdentity,
  trimChatHistory
} = BiliTogetherUtils;
const { loadIdentity, saveIdentity } = BiliTogetherStorage;

const PEERJS_CDN = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";

const state = {
  identity: null,
  popupPorts: new Set(),
  contentTabId: null,
  remotePeer: null,
  connectionPhase: "idle", // idle | connecting | connected | failed
  lastError: "",
  sessionState: JSON.parse(JSON.stringify(DEFAULT_SESSION_STATE)),
  peer: null,
  dataChannel: null
};

let peerJsLoaded = false;

// ─── PeerJS 加载 ────────────────────────────────────
async function loadPeerJs() {
  if (peerJsLoaded || typeof Peer !== "undefined") {
    peerJsLoaded = true;
    return;
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PEERJS_CDN;
    script.onload = () => { peerJsLoaded = true; resolve(); };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ─── 状态管理 ────────────────────────────────────────
function resetSessionState() {
  state.remotePeer = null;
  state.contentTabId = null;
  state.connectionPhase = "idle";
  state.lastError = "";
  state.dataChannel = null;
  state.sessionState = JSON.parse(JSON.stringify(DEFAULT_SESSION_STATE));
}

function serializeAppState() {
  return {
    identity: state.identity,
    connectionPhase: state.connectionPhase,
    remotePeer: state.remotePeer,
    lastError: state.lastError,
    sessionState: state.sessionState,
    isConnected: state.connectionPhase === "connected",
    peerId: state.peer?.id || null
  };
}

function broadcastState() {
  const snapshot = serializeAppState();
  state.popupPorts.forEach((port) => {
    try {
      port.postMessage({ type: MESSAGE_TYPES.APP_STATE_UPDATED, payload: snapshot });
    } catch {
      state.popupPorts.delete(port);
    }
  });
  if (state.contentTabId) {
    chrome.tabs.sendMessage(state.contentTabId, {
      type: MESSAGE_TYPES.APP_STATE_UPDATED,
      payload: snapshot
    }).catch(() => {});
  }
}

function setLastError(message) {
  state.lastError = message || "";
  broadcastState();
}

function sendToast(text) {
  if (!state.contentTabId) return;
  chrome.tabs.sendMessage(state.contentTabId, {
    type: MESSAGE_TYPES.SHOW_TOAST,
    payload: { text, duration: TOAST_DURATION_MS }
  }).catch(() => {});
}

// ─── Envelope ────────────────────────────────────────
function buildEnvelope(kind, data = {}) {
  return {
    id: randomId("evt"),
    kind,
    senderId: state.identity.peerId,
    senderNickname: state.identity.nickname,
    timestamp: now(),
    data
  };
}

// ─── P2P DataChannel 事件处理 ────────────────────────
function handlePeerData(envelope) {
  if (!envelope?.kind) return;
  state.remotePeer = {
    peerId: envelope.senderId,
    nickname: envelope.senderNickname,
    connectionState: "connected"
  };
  switch (envelope.kind) {
    case ROOM_EVENT_TYPES.STATE_SNAPSHOT:
      state.sessionState = {
        ...state.sessionState,
        ...envelope.data,
        playbackState: canonicalizePlaybackState(envelope.data.playbackState),
        chatMessages: trimChatHistory(envelope.data.chatMessages || [])
      };
      applyRemoteEnvelopeToContent(envelope);
      break;
    case ROOM_EVENT_TYPES.CHAT_MESSAGE:
      state.sessionState.chatMessages = trimChatHistory([
        ...state.sessionState.chatMessages,
        {
          id: envelope.id,
          senderId: envelope.senderId,
          senderNickname: envelope.senderNickname,
          text: envelope.data.text,
          timestamp: envelope.timestamp
        }
      ]);
      break;
    case ROOM_EVENT_TYPES.SYNC_VIDEO_CHANGE:
      state.sessionState.videoIdentity = envelope.data.videoIdentity;
      state.sessionState.lastControlTimestamp = envelope.timestamp;
      state.sessionState.lastControlId = envelope.id;
      applyRemoteEnvelopeToContent(envelope);
      break;
    case ROOM_EVENT_TYPES.SYNC_PLAY:
    case ROOM_EVENT_TYPES.SYNC_PAUSE:
    case ROOM_EVENT_TYPES.SYNC_SEEK:
    case ROOM_EVENT_TYPES.SYNC_RATE:
      if (maybeApplyPlaybackEvent(envelope)) {
        applyRemoteEnvelopeToContent(envelope);
      }
      break;
    default:
      break;
  }
  broadcastState();
}

function maybeApplyPlaybackEvent(envelope) {
  const cmp = compareEventOrder(
    envelope.timestamp, envelope.id,
    state.sessionState.lastControlTimestamp, state.sessionState.lastControlId
  );
  if (cmp < 0) return false;
  state.sessionState.lastControlTimestamp = envelope.timestamp;
  state.sessionState.lastControlId = envelope.id;
  state.sessionState.playbackState = canonicalizePlaybackState({
    ...state.sessionState.playbackState,
    ...envelope.data.playbackState,
    updatedAt: envelope.timestamp,
    updatedBy: envelope.senderId
  });
  if (envelope.data.videoIdentity) {
    state.sessionState.videoIdentity = envelope.data.videoIdentity;
  }
  return true;
}

function applyRemoteEnvelopeToContent(envelope) {
  if (!state.contentTabId) return;
  chrome.tabs.sendMessage(state.contentTabId, {
    type: MESSAGE_TYPES.APPLY_REMOTE_EVENT,
    payload: { event: envelope }
  }).catch(() => {});
}

function sendStateSnapshot() {
  const envelope = buildEnvelope(ROOM_EVENT_TYPES.STATE_SNAPSHOT, {
    videoIdentity: state.sessionState.videoIdentity,
    playbackState: state.sessionState.playbackState,
    lastControlTimestamp: state.sessionState.lastControlTimestamp,
    lastControlId: state.sessionState.lastControlId,
    chatMessages: state.sessionState.chatMessages
  });
  sendViaDataChannel(envelope);
}

function sendViaDataChannel(envelope) {
  if (state.dataChannel?.open) {
    state.dataChannel.send(JSON.stringify(envelope));
    return true;
  }
  return false;
}

// ─── Host: 创建房间 ──────────────────────────────────
function createRoom() {
  return new Promise(async (resolve, reject) => {
    await loadPeerJs();
    resetSessionState();
    state.connectionPhase = "connecting";
    broadcastState();

    const hostId = `bt_${randomId("room")}`;

    try {
      state.peer = new Peer(hostId, {
        key: PEERJS_KEY || undefined,
        ...PEER_OPTIONS
      });
    } catch (e) {
      resetSessionState();
      reject(new Error("无法初始化 P2P 连接"));
      return;
    }

    state.peer.on("connection", (conn) => {
      setupDataChannel(conn);
      state.remotePeer = {
        peerId: conn.peer,
        nickname: "远端成员",
        connectionState: "connected"
      };
      state.connectionPhase = "connected";
      sendToast("对方已加入！");
      sendStateSnapshot();
      broadcastState();
    });

    state.peer.on("error", (err) => {
      if (err.type === "peer-unavailable") {
        setLastError("房间不存在或已过期");
        state.connectionPhase = "failed";
      } else if (err.type !== "browser-bad-https") {
        setLastError(err.message || "连接错误");
      }
      broadcastState();
    });

    // PeerJS 需要一点时间初始化
    setTimeout(() => {
      if (state.connectionPhase === "connecting") {
        resolve({ roomId: hostId });
      }
    }, 1500);

    state.peer.on("open", () => {
      // nothing extra needed
    });
  });
}

// ─── Guest: 加入房间 ─────────────────────────────────
function joinRoom(roomId) {
  return new Promise(async (resolve, reject) => {
    await loadPeerJs();
    resetSessionState();
    state.connectionPhase = "connecting";
    broadcastState();

    try {
      state.peer = new Peer(undefined, {
        key: PEERJS_KEY || undefined,
        ...PEER_OPTIONS
      });
    } catch (e) {
      resetSessionState();
      reject(new Error("无法初始化 P2P 连接"));
      return;
    }

    state.peer.on("open", () => {
      const conn = state.peer.connect(roomId, { reliable: true });
      setupDataChannel(conn);

      conn.on("open", () => {
        state.remotePeer = {
          peerId: roomId,
          nickname: "房主",
          connectionState: "connected"
        };
        state.connectionPhase = "connected";
        sendToast("已连接到房主！");
        sendStateSnapshot();
        broadcastState();
        resolve({ ok: true });
      });

      conn.on("error", (err) => {
        setLastError(err.message || "连接失败");
        state.connectionPhase = "failed";
        broadcastState();
        reject(err);
      });
    });

    state.peer.on("error", (err) => {
      if (err.type === "peer-unavailable") {
        setLastError("房间不存在或已过期");
        state.connectionPhase = "failed";
        reject(new Error("房间不存在或已过期"));
      } else if (err.type !== "browser-bad-https") {
        setLastError(err.message || "连接错误");
        state.connectionPhase = "failed";
        reject(err);
      }
      broadcastState();
    });

    setTimeout(() => {
      if (state.connectionPhase === "connecting") {
        reject(new Error("连接超时"));
      }
    }, 15000);
  });
}

function setupDataChannel(conn) {
  state.dataChannel = conn;

  conn.on("data", (data) => {
    try {
      const envelope = JSON.parse(data);
      handlePeerData(envelope);
    } catch {}
  });

  conn.on("close", () => {
    state.connectionPhase = "idle";
    state.remotePeer = null;
    state.dataChannel = null;
    sendToast("连接已断开");
    broadcastState();
  });

  conn.on("error", () => {
    state.connectionPhase = "failed";
    broadcastState();
  });
}

// ─── 内容脚本消息处理 ─────────────────────────────────
function bindContentTab(tabId, payload) {
  state.contentTabId = tabId;
  if (payload?.nickname && payload.nickname !== state.identity.nickname) {
    state.identity = { ...state.identity, nickname: payload.nickname };
    saveIdentity(state.identity).catch(() => {});
  }
  if (payload?.videoIdentity && !state.sessionState.videoIdentity) {
    state.sessionState.videoIdentity = payload.videoIdentity;
  }
  broadcastState();
}

function updateLocalPlayback(playbackState, videoIdentity) {
  if (!playbackState) return;
  state.sessionState.playbackState = canonicalizePlaybackState({
    ...playbackState,
    updatedBy: state.identity.peerId
  });
  if (videoIdentity && !state.sessionState.videoIdentity) {
    state.sessionState.videoIdentity = videoIdentity;
  }
}

async function relayEnvelope(envelope) {
  const ok = sendViaDataChannel(envelope);
  if (!ok) throw new Error("当前未连接对方");
}

function handleContentMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (!tabId) return null;
  switch (message.type) {
    case MESSAGE_TYPES.CONTENT_READY:
      bindContentTab(tabId, message.payload);
      if (
        state.sessionState.videoIdentity &&
        message.payload?.videoIdentity &&
        !shallowEqualVideoIdentity(state.sessionState.videoIdentity, message.payload.videoIdentity)
      ) {
        sendToast(`正在同步到 ${state.sessionState.videoIdentity.title || "房间视频"}`);
        applyRemoteEnvelopeToContent(
          buildEnvelope(ROOM_EVENT_TYPES.SYNC_VIDEO_CHANGE, {
            videoIdentity: state.sessionState.videoIdentity
          })
        );
      }
      return { ok: true };
    case MESSAGE_TYPES.CONTENT_PLAYBACK_STATE:
      updateLocalPlayback(message.payload.playbackState, message.payload.videoIdentity);
      broadcastState();
      return { ok: true };
    case MESSAGE_TYPES.CONTENT_CONTROL_EVENT: {
      const envelope = buildEnvelope(message.payload.kind, {
        playbackState: canonicalizePlaybackState(message.payload.playbackState),
        videoIdentity: message.payload.videoIdentity || state.sessionState.videoIdentity
      });
      if (message.payload.kind === ROOM_EVENT_TYPES.SYNC_VIDEO_CHANGE && envelope.data.videoIdentity) {
        state.sessionState.videoIdentity = envelope.data.videoIdentity;
      } else {
        maybeApplyPlaybackEvent(envelope);
      }
      relayEnvelope(envelope).catch((e) => setLastError(e.message));
      broadcastState();
      return { ok: true };
    }
    case MESSAGE_TYPES.CONTENT_SEND_CHAT: {
      const text = String(message.payload.text || "").trim();
      if (!text) return { ok: false };
      const envelope = buildEnvelope(ROOM_EVENT_TYPES.CHAT_MESSAGE, { text });
      state.sessionState.chatMessages = trimChatHistory([
        ...state.sessionState.chatMessages,
        {
          id: envelope.id,
          senderId: envelope.senderId,
          senderNickname: envelope.senderNickname,
          text,
          timestamp: envelope.timestamp
        }
      ]);
      relayEnvelope(envelope).catch((e) => setLastError(e.message));
      broadcastState();
      return { ok: true };
    }
    default:
      return null;
  }
}

// ─── Popup 消息处理 ──────────────────────────────────
async function handlePopupMessage(message) {
  switch (message.type) {
    case MESSAGE_TYPES.GET_APP_STATE:
      return serializeAppState();
    case MESSAGE_TYPES.CREATE_ROOM:
      return createRoom();
    case MESSAGE_TYPES.JOIN_ROOM:
      return joinRoom(message.payload.roomId);
    case MESSAGE_TYPES.RESET_SESSION:
      await resetSession();
      return serializeAppState();
    case MESSAGE_TYPES.OPEN_BILIBILI:
      await chrome.tabs.create({ url: "https://www.bilibili.com/" });
      return { ok: true };
    default:
      return null;
  }
}

async function resetSession() {
  try { state.peer?.destroy(); } catch {}
  state.peer = null;
  state.dataChannel = null;
  resetSessionState();
  broadcastState();
}

// ─── 端口和消息路由 ──────────────────────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup") return;
  state.popupPorts.add(port);
  port.postMessage({ type: MESSAGE_TYPES.APP_STATE_UPDATED, payload: serializeAppState() });
  port.onDisconnect.addListener(() => state.popupPorts.delete(port));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.source === "offscreen") {
        sendResponse({ ok: true });
        return;
      }
      if (message.type.startsWith("CONTENT_")) {
        sendResponse({ ok: true, data: handleContentMessage(message, sender) });
        return;
      }
      sendResponse({ ok: true, data: await handlePopupMessage(message) });
    } catch (error) {
      setLastError(error?.message || String(error));
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.contentTabId === tabId) {
    state.contentTabId = null;
    broadcastState();
  }
});

// ─── 初始化 ──────────────────────────────────────────
async function bootstrap() {
  state.identity = await loadIdentity();
  broadcastState();
}

chrome.runtime.onInstalled.addListener(() => bootstrap());
chrome.runtime.onStartup.addListener(() => bootstrap());
bootstrap();
