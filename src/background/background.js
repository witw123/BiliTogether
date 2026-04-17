importScripts("../shared/constants.js", "../shared/utils.js", "../shared/storage.js", "../shared/session.js");

const {
  CONNECTION_PHASES,
  MESSAGE_TYPES,
  OFFSCREEN_COMMAND_TYPES,
  OFFSCREEN_EVENT_TYPES,
  ROOM_EVENT_TYPES,
  TOAST_DURATION_MS
} = BiliTogetherConstants;
const { generateRoomCode } = BiliTogetherUtils;
const { clearSessionSnapshot, loadIdentity, loadSessionSnapshot, saveIdentity, saveSessionSnapshot } = BiliTogetherStorage;
const {
  buildEnvelope,
  buildStateSnapshotEnvelope,
  createInitialState,
  hydrateSessionState,
  reduceSessionState,
  serializeAppState,
  serializePersistedSession
} = BiliTogetherSession;

const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/offscreen.html";

const runtime = {
  popupPorts: new Set(),
  contentTabId: null,
  offscreenPromise: null,
  state: createInitialState(null)
};

function dispatch(action, options = {}) {
  runtime.state = reduceSessionState(runtime.state, action);
  if (options.persist !== false) {
    saveSessionSnapshot(serializePersistedSession(runtime.state)).catch(() => {});
  }
  if (options.broadcast !== false) {
    broadcastState();
  }
}

function logDiagnostic(level, message, meta = null, lastError = undefined) {
  dispatch({
    type: "LOG_DIAGNOSTIC",
    level,
    message,
    meta,
    lastError
  });
}

function logPeerUnavailable(kind) {
  const shouldSurface =
    runtime.state.transport.phase === CONNECTION_PHASES.DISCONNECTED ||
    runtime.state.transport.phase === CONNECTION_PHASES.FAILED;
  logDiagnostic("warn", "当前未连接对方", { kind }, shouldSurface ? "当前未连接对方" : undefined);
}

function broadcastState() {
  const snapshot = serializeAppState(runtime.state);

  runtime.popupPorts.forEach((port) => {
    try {
      port.postMessage({ type: MESSAGE_TYPES.APP_STATE_UPDATED, payload: snapshot });
    } catch {
      runtime.popupPorts.delete(port);
    }
  });

  if (runtime.contentTabId) {
    chrome.tabs
      .sendMessage(runtime.contentTabId, {
        type: MESSAGE_TYPES.APP_STATE_UPDATED,
        payload: snapshot
      })
      .catch(() => {});
  }
}

function sendToast(text, duration = TOAST_DURATION_MS) {
  if (!runtime.contentTabId) {
    return;
  }
  chrome.tabs
    .sendMessage(runtime.contentTabId, {
      type: MESSAGE_TYPES.SHOW_TOAST,
      payload: { text, duration }
    })
    .catch(() => {});
}

function rememberContentTab(tabId) {
  if (tabId) {
    runtime.contentTabId = tabId;
  }
}

async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) {
    return false;
  }
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) {
    throw new Error("当前浏览器不支持 offscreen document");
  }
  if (await hasOffscreenDocument()) {
    return;
  }
  if (!runtime.offscreenPromise) {
    runtime.offscreenPromise = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ["WEB_RTC"],
        justification: "BiliTogether needs a long-lived WebRTC transport outside the service worker."
      })
      .catch((error) => {
        if (!String(error?.message || error).includes("single offscreen document")) {
          throw error;
        }
      })
      .finally(() => {
        runtime.offscreenPromise = null;
      });
  }
  await runtime.offscreenPromise;
}

async function callOffscreen(type, payload = {}) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type,
    payload
  });
  if (!response?.ok) {
    throw new Error(response?.error || "offscreen 调用失败");
  }
  return response.data;
}

async function sendEnvelopeToPeer(envelope) {
  const response = await callOffscreen(OFFSCREEN_COMMAND_TYPES.SEND_ENVELOPE, { envelope });
  if (!response?.sent) {
    throw new Error("当前未连接对方");
  }
}

async function sendStateSnapshotToPeer() {
  if (runtime.state.transport.phase !== CONNECTION_PHASES.CONNECTED || runtime.state.room.role !== "host") {
    return;
  }
  const envelope = buildStateSnapshotEnvelope(runtime.state.identity, runtime.state);
  await sendEnvelopeToPeer(envelope);
}

function applyStateSnapshotToContent() {
  if (!runtime.contentTabId) {
    return;
  }
  chrome.tabs
    .sendMessage(runtime.contentTabId, {
      type: MESSAGE_TYPES.APPLY_REMOTE_EVENT,
      payload: {
        event: buildStateSnapshotEnvelope(runtime.state.identity, runtime.state)
      }
    })
    .catch(() => {});
}

function applyRemoteEnvelopeToContent(envelope) {
  if (!runtime.contentTabId) {
    return;
  }
  if (
    envelope.kind !== ROOM_EVENT_TYPES.STATE_SNAPSHOT &&
    envelope.kind !== ROOM_EVENT_TYPES.SYNC_VIDEO_CHANGE &&
    envelope.kind !== ROOM_EVENT_TYPES.SYNC_PLAY &&
    envelope.kind !== ROOM_EVENT_TYPES.SYNC_PAUSE &&
    envelope.kind !== ROOM_EVENT_TYPES.SYNC_SEEK &&
    envelope.kind !== ROOM_EVENT_TYPES.SYNC_RATE
  ) {
    return;
  }
  chrome.tabs
    .sendMessage(runtime.contentTabId, {
      type: MESSAGE_TYPES.APPLY_REMOTE_EVENT,
      payload: { event: envelope }
    })
    .catch(() => {});
}

function reconcileTransportStatus(status, options = {}) {
  const previousPhase = runtime.state.transport.phase;
  const previousRole = runtime.state.room.role;

  dispatch(
    {
      type: "TRANSPORT_STATUS_CHANGED",
      status
    },
    options
  );

  const nextPhase = runtime.state.transport.phase;
  if (nextPhase === CONNECTION_PHASES.CONNECTED && previousPhase !== CONNECTION_PHASES.CONNECTED) {
    if (runtime.state.room.role === "host") {
      sendToast("对方已加入！");
      sendStateSnapshotToPeer().catch((error) => logDiagnostic("error", error.message, { step: "send_snapshot" }, error.message));
    } else {
      sendToast("已连接到房主！");
    }
  } else if (nextPhase === CONNECTION_PHASES.DISCONNECTED && previousPhase === CONNECTION_PHASES.CONNECTED) {
    sendToast("连接已断开，需要重新建房或加入");
  } else if (
    nextPhase === CONNECTION_PHASES.FAILED &&
    previousPhase !== CONNECTION_PHASES.FAILED &&
    runtime.state.transport.lastError
  ) {
    sendToast(runtime.state.transport.lastError);
  } else if (
    nextPhase === CONNECTION_PHASES.HOSTING &&
    previousPhase === CONNECTION_PHASES.CONNECTED &&
    previousRole === "guest"
  ) {
    sendToast("已回到建房状态");
  }
}

async function syncOffscreenStatus() {
  try {
    const status = await callOffscreen(OFFSCREEN_COMMAND_TYPES.GET_STATUS);
    reconcileTransportStatus(status);
  } catch (error) {
    logDiagnostic("error", error.message, { step: "sync_offscreen" }, error.message);
  }
}

async function handleCreateRoom() {
  const roomCode = generateRoomCode(6);
  const result = await callOffscreen(OFFSCREEN_COMMAND_TYPES.CREATE_ROOM, { roomCode });
  reconcileTransportStatus(result.status);
  return { roomId: roomCode };
}

async function handleJoinRoom(roomId) {
  const result = await callOffscreen(OFFSCREEN_COMMAND_TYPES.JOIN_ROOM, { roomCode: roomId });
  reconcileTransportStatus(result.status);
  return { ok: true };
}

async function handleResetSession() {
  await callOffscreen(OFFSCREEN_COMMAND_TYPES.RESET);
  dispatch({ type: "RESET_SESSION" }, { persist: false });
  await clearSessionSnapshot().catch(() => {});
  await saveSessionSnapshot(serializePersistedSession(runtime.state)).catch(() => {});
  return serializeAppState(runtime.state);
}

async function handlePopupMessage(message) {
  switch (message.type) {
    case MESSAGE_TYPES.GET_APP_STATE:
      return serializeAppState(runtime.state);
    case MESSAGE_TYPES.CREATE_ROOM:
      return handleCreateRoom();
    case MESSAGE_TYPES.JOIN_ROOM:
      return handleJoinRoom(message.payload.roomId);
    case MESSAGE_TYPES.RESET_SESSION:
      return handleResetSession();
    case MESSAGE_TYPES.OPEN_BILIBILI:
      await chrome.tabs.create({ url: "https://www.bilibili.com/" });
      return { ok: true };
    default:
      return null;
  }
}

async function handleContentReady(tabId, payload) {
  rememberContentTab(tabId);
  if (payload?.nickname && payload.nickname !== runtime.state.identity?.nickname) {
    const nextIdentity = await saveIdentity({
      ...runtime.state.identity,
      nickname: payload.nickname
    });
    dispatch({ type: "SET_IDENTITY", identity: nextIdentity });
  }
  if (runtime.state.transport.phase === CONNECTION_PHASES.CONNECTED) {
    applyStateSnapshotToContent();
  }
  return { ok: true };
}

async function handleContentMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    return null;
  }
  rememberContentTab(tabId);

  switch (message.type) {
    case MESSAGE_TYPES.CONTENT_READY:
      return handleContentReady(tabId, message.payload);
    case MESSAGE_TYPES.CONTENT_PLAYBACK_STATE:
      dispatch({
        type: "LOCAL_PLAYBACK_UPDATED",
        playbackState: message.payload.playbackState,
        videoIdentity: message.payload.videoIdentity,
        updatedBy: runtime.state.identity?.peerId || ""
      });
      return { ok: true };
    case MESSAGE_TYPES.CONTENT_CONTROL_EVENT: {
      const envelope = buildEnvelope(runtime.state.identity, message.payload.kind, {
        playbackState: message.payload.playbackState,
        videoIdentity: message.payload.videoIdentity || runtime.state.media.videoIdentity
      });
      dispatch({ type: "LOCAL_ENVELOPE_CREATED", envelope });
      if (runtime.state.transport.phase === CONNECTION_PHASES.CONNECTED) {
        await sendEnvelopeToPeer(envelope);
      } else {
        logPeerUnavailable(message.payload.kind);
      }
      return { ok: true };
    }
    case MESSAGE_TYPES.CONTENT_SEND_CHAT: {
      const text = String(message.payload.text || "").trim();
      if (!text) {
        return { ok: false };
      }
      const envelope = buildEnvelope(runtime.state.identity, ROOM_EVENT_TYPES.CHAT_MESSAGE, { text });
      dispatch({ type: "LOCAL_ENVELOPE_CREATED", envelope });
      if (runtime.state.transport.phase === CONNECTION_PHASES.CONNECTED) {
        await sendEnvelopeToPeer(envelope);
      } else {
        logPeerUnavailable(ROOM_EVENT_TYPES.CHAT_MESSAGE);
      }
      return { ok: true };
    }
    default:
      return null;
  }
}

function handleOffscreenEvent(message) {
  if (message.type === OFFSCREEN_EVENT_TYPES.STATUS_CHANGED) {
    reconcileTransportStatus(message.payload.status);
    return;
  }

  if (message.type === OFFSCREEN_EVENT_TYPES.PEER_MESSAGE) {
    dispatch({ type: "REMOTE_ENVELOPE_RECEIVED", envelope: message.payload.envelope });
    applyRemoteEnvelopeToContent(message.payload.envelope);
    return;
  }

  if (message.type === OFFSCREEN_EVENT_TYPES.ERROR) {
    dispatch({
      type: "TRANSPORT_ERROR",
      message: message.payload.error,
      meta: message.payload.meta
    });
    return;
  }

  if (message.type === OFFSCREEN_EVENT_TYPES.DIAGNOSTIC) {
    logDiagnostic(message.payload.level, message.payload.message, message.payload.meta, message.payload.lastError);
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup") {
    return;
  }
  runtime.popupPorts.add(port);
  port.postMessage({
    type: MESSAGE_TYPES.APP_STATE_UPDATED,
    payload: serializeAppState(runtime.state)
  });
  port.onDisconnect.addListener(() => runtime.popupPorts.delete(port));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message?.source === "offscreen") {
        handleOffscreenEvent(message);
        sendResponse({ ok: true });
        return;
      }

      if (message.type?.startsWith("CONTENT_")) {
        sendResponse({ ok: true, data: await handleContentMessage(message, sender) });
        return;
      }

      sendResponse({ ok: true, data: await handlePopupMessage(message) });
    } catch (error) {
      const text = error?.message || String(error);
      logDiagnostic("error", text, { messageType: message?.type }, text);
      sendResponse({ ok: false, error: text });
    }
  })();

  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (runtime.contentTabId === tabId) {
    runtime.contentTabId = null;
  }
});

async function bootstrap() {
  const identity = await loadIdentity();
  const restoredState = hydrateSessionState(identity, await loadSessionSnapshot());
  runtime.state = restoredState;
  await saveSessionSnapshot(serializePersistedSession(runtime.state)).catch(() => {});
  broadcastState();
  await syncOffscreenStatus();
}

chrome.runtime.onInstalled.addListener(() => {
  bootstrap().catch((error) => logDiagnostic("error", error.message, { step: "onInstalled" }, error.message));
});

chrome.runtime.onStartup.addListener(() => {
  bootstrap().catch((error) => logDiagnostic("error", error.message, { step: "onStartup" }, error.message));
});

bootstrap().catch((error) => logDiagnostic("error", error.message, { step: "bootstrap" }, error.message));
