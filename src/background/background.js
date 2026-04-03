importScripts("../shared/constants.js", "../shared/utils.js", "../shared/storage.js");

const { DEFAULT_SESSION_STATE, INVITE_PROTOCOL_VERSION, MESSAGE_TYPES, ROOM_EVENT_TYPES, TOAST_DURATION_MS } =
  BiliTogetherConstants;
const {
  canonicalizePlaybackState,
  compareEventOrder,
  now,
  randomId,
  safeJsonParse,
  shallowEqualVideoIdentity,
  trimChatHistory
} = BiliTogetherUtils;
const { loadIdentity, loadLastInvite, saveIdentity, saveLastInvite } = BiliTogetherStorage;

const OFFSCREEN_PATH = "src/offscreen/offscreen.html";

const state = {
  identity: null,
  popupPorts: new Set(),
  contentTabId: null,
  remotePeer: null,
  connectionPhase: "idle",
  lastError: "",
  lastInvite: "",
  pendingSignal: {
    localDescription: null,
    localCandidates: []
  },
  sessionState: JSON.parse(JSON.stringify(DEFAULT_SESSION_STATE))
};

let creatingOffscreen;

function resetSessionState() {
  state.remotePeer = null;
  state.contentTabId = null;
  state.connectionPhase = "idle";
  state.lastError = "";
  state.pendingSignal = {
    localDescription: null,
    localCandidates: []
  };
  state.sessionState = JSON.parse(JSON.stringify(DEFAULT_SESSION_STATE));
}

function serializeAppState() {
  return {
    identity: state.identity,
    connectionPhase: state.connectionPhase,
    remotePeer: state.remotePeer,
    lastError: state.lastError,
    lastInvite: state.lastInvite,
    sessionState: state.sessionState,
    isConnected: state.connectionPhase === "connected"
  };
}

function broadcastState() {
  const snapshot = serializeAppState();
  state.popupPorts.forEach((port) => {
    try {
      port.postMessage({ type: MESSAGE_TYPES.APP_STATE_UPDATED, payload: snapshot });
    } catch (error) {
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
  if (!state.contentTabId) {
    return;
  }
  chrome.tabs.sendMessage(state.contentTabId, {
    type: MESSAGE_TYPES.SHOW_TOAST,
    payload: {
      text,
      duration: TOAST_DURATION_MS
    }
  }).catch(() => {});
}

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

function encodeSignalPayload(payload) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

function decodeSignalPayload(rawValue) {
  return safeJsonParse(decodeURIComponent(escape(atob(String(rawValue || "").trim()))), null);
}

function createInvitePayload(role, description, candidates) {
  return encodeSignalPayload({
    version: INVITE_PROTOCOL_VERSION,
    role,
    sender: {
      peerId: state.identity.peerId,
      nickname: state.identity.nickname
    },
    description,
    candidates: candidates || []
  });
}

async function hasOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  if ("getContexts" in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    return contexts.length > 0;
  }
  const matchedClients = await clients.matchAll();
  return matchedClients.some((client) => client.url.includes(offscreenUrl));
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["WEB_RTC"],
      justification: "Create and manage WebRTC connections for manual invite pairing."
    });
    await creatingOffscreen;
    creatingOffscreen = null;
  } else {
    await creatingOffscreen;
  }
}

async function sendOffscreenCommand(type, payload = {}) {
  await ensureOffscreenDocument();
  return chrome.runtime.sendMessage({
    target: "offscreen",
    type,
    payload
  });
}

function maybeApplyPlaybackEvent(envelope) {
  const comparison = compareEventOrder(
    envelope.timestamp,
    envelope.id,
    state.sessionState.lastControlTimestamp,
    state.sessionState.lastControlId
  );
  if (comparison < 0) {
    return false;
  }
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
  if (!state.contentTabId) {
    return;
  }
  chrome.tabs.sendMessage(state.contentTabId, {
    type: MESSAGE_TYPES.APPLY_REMOTE_EVENT,
    payload: { event: envelope }
  }).catch(() => {});
}

function handlePeerEnvelope(envelope) {
  if (!envelope?.kind) {
    return;
  }
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

function sendStateSnapshot() {
  sendOffscreenCommand("OFFSCREEN_SEND_ENVELOPE", {
    envelope: buildEnvelope(ROOM_EVENT_TYPES.STATE_SNAPSHOT, {
      videoIdentity: state.sessionState.videoIdentity,
      playbackState: state.sessionState.playbackState,
      lastControlTimestamp: state.sessionState.lastControlTimestamp,
      lastControlId: state.sessionState.lastControlId,
      chatMessages: state.sessionState.chatMessages
    })
  }).catch((error) => setLastError(error?.message || String(error)));
}

async function resetSession() {
  await sendOffscreenCommand("OFFSCREEN_RESET");
  resetSessionState();
  state.lastInvite = "";
  await saveLastInvite("");
  broadcastState();
}

async function createInvite() {
  await sendOffscreenCommand("OFFSCREEN_RESET");
  resetSessionState();
  state.connectionPhase = "creating-offer";
  broadcastState();
  await sendOffscreenCommand("OFFSCREEN_CREATE_OFFER");
  await new Promise((resolve) => setTimeout(resolve, 1200));
  if (!state.pendingSignal.localDescription) {
    throw new Error("创建邀请串失败：未生成 offer");
  }
  const invite = createInvitePayload("offer", state.pendingSignal.localDescription, state.pendingSignal.localCandidates);
  state.lastInvite = invite;
  state.connectionPhase = "offer-created";
  await saveLastInvite(invite);
  broadcastState();
  return { invite };
}

async function acceptInvite(inviteText) {
  const payload = decodeSignalPayload(inviteText);
  if (!payload || payload.role !== "offer" || !payload.description) {
    throw new Error("邀请码无效");
  }
  await sendOffscreenCommand("OFFSCREEN_RESET");
  resetSessionState();
  state.remotePeer = {
    peerId: payload.sender?.peerId || "",
    nickname: payload.sender?.nickname || "远端成员",
    connectionState: "connecting"
  };
  state.connectionPhase = "connecting";
  broadcastState();
  await sendOffscreenCommand("OFFSCREEN_ACCEPT_OFFER", {
    description: payload.description,
    candidates: payload.candidates || []
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  if (!state.pendingSignal.localDescription) {
    throw new Error("生成响应串失败：未生成 answer");
  }
  const response = createInvitePayload("answer", state.pendingSignal.localDescription, state.pendingSignal.localCandidates);
  state.connectionPhase = "answer-created";
  broadcastState();
  return { response };
}

async function completeHandshake(responseText) {
  const payload = decodeSignalPayload(responseText);
  if (!payload || payload.role !== "answer" || !payload.description) {
    throw new Error("响应串无效");
  }
  state.remotePeer = {
    peerId: payload.sender?.peerId || "",
    nickname: payload.sender?.nickname || "远端成员",
    connectionState: "connecting"
  };
  state.connectionPhase = "connecting";
  broadcastState();
  await sendOffscreenCommand("OFFSCREEN_ACCEPT_ANSWER", {
    description: payload.description,
    candidates: payload.candidates || []
  });
  return { ok: true };
}

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
  if (!playbackState) {
    return;
  }
  state.sessionState.playbackState = canonicalizePlaybackState({
    ...playbackState,
    updatedBy: state.identity.peerId
  });
  if (videoIdentity && !state.sessionState.videoIdentity) {
    state.sessionState.videoIdentity = videoIdentity;
  }
}

async function relayEnvelope(envelope) {
  const response = await sendOffscreenCommand("OFFSCREEN_SEND_ENVELOPE", { envelope });
  if (!response?.ok) {
    throw new Error("当前未连接对方");
  }
}

async function handlePopupMessage(message) {
  switch (message.type) {
    case MESSAGE_TYPES.GET_APP_STATE:
      return serializeAppState();
    case MESSAGE_TYPES.CREATE_INVITE:
      return createInvite();
    case MESSAGE_TYPES.ACCEPT_INVITE:
      return acceptInvite(message.payload.invite);
    case MESSAGE_TYPES.COMPLETE_HANDSHAKE:
      return completeHandshake(message.payload.response);
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

function handleContentMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    return null;
  }
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
      relayEnvelope(envelope).catch((error) => setLastError(error?.message || String(error)));
      broadcastState();
      return { ok: true };
    }
    case MESSAGE_TYPES.CONTENT_SEND_CHAT: {
      const text = String(message.payload.text || "").trim();
      if (!text) {
        return { ok: false };
      }
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
      relayEnvelope(envelope).catch((error) => setLastError(error?.message || String(error)));
      broadcastState();
      return { ok: true };
    }
    default:
      return null;
  }
}

function handleOffscreenMessage(message) {
  switch (message.type) {
    case "OFFSCREEN_SIGNAL_UPDATE":
      if (message.payload.description) {
        state.pendingSignal.localDescription = message.payload.description;
      }
      if (message.payload.candidate) {
        state.pendingSignal.localCandidates.push(message.payload.candidate);
      }
      broadcastState();
      return { ok: true };
    case "OFFSCREEN_PEER_EVENT":
      handlePeerEnvelope(message.payload.envelope);
      return { ok: true };
    case "OFFSCREEN_PEER_STATE":
      if (message.payload.state === "connected") {
        state.connectionPhase = "connected";
        sendStateSnapshot();
      } else if (["closed", "failed", "disconnected"].includes(message.payload.state)) {
        state.connectionPhase = "failed";
      } else if (["connecting", "new"].includes(message.payload.state)) {
        state.connectionPhase = "connecting";
      }
      broadcastState();
      return { ok: true };
    default:
      return null;
  }
}

async function bootstrap() {
  state.identity = await loadIdentity();
  state.lastInvite = await loadLastInvite();
  await ensureOffscreenDocument();
  broadcastState();
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup") {
    return;
  }
  state.popupPorts.add(port);
  port.postMessage({ type: MESSAGE_TYPES.APP_STATE_UPDATED, payload: serializeAppState() });
  port.onDisconnect.addListener(() => state.popupPorts.delete(port));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "offscreen") {
    return false;
  }
  (async () => {
    try {
      if (message?.source === "offscreen") {
        sendResponse(handleOffscreenMessage(message));
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

chrome.runtime.onInstalled.addListener(() => bootstrap().catch((error) => setLastError(error?.message || String(error))));
chrome.runtime.onStartup.addListener(() => bootstrap().catch((error) => setLastError(error?.message || String(error))));

bootstrap().catch((error) => setLastError(error?.message || String(error)));
