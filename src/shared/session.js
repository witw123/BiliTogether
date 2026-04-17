(function initSession(globalScope, factory) {
  const constants =
    globalScope.BiliTogetherConstants ||
    (typeof require === "function" ? require("./constants.js") : null);
  const utils =
    globalScope.BiliTogetherUtils ||
    (typeof require === "function" ? require("./utils.js") : null);
  const api = factory(constants, utils);
  globalScope.BiliTogetherSession = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function sessionFactory(constants, utils) {
  const { CONNECTION_PHASES, DEFAULT_SESSION_STATE, DIAGNOSTIC_LOG_LIMIT, ROOM_EVENT_TYPES } = constants;
  const { canonicalizePlaybackState, compareEventOrder, now, randomId, trimChatHistory } = utils;

  function cloneDefaultSessionState() {
    return JSON.parse(JSON.stringify(DEFAULT_SESSION_STATE));
  }

  function createDiagnostics() {
    return {
      lastError: "",
      lastEventAt: 0,
      logs: []
    };
  }

  function createInitialState(identity = null) {
    const defaults = cloneDefaultSessionState();
    return {
      identity,
      transport: {
        phase: CONNECTION_PHASES.IDLE,
        roomCode: "",
        hostPeerId: "",
        role: "",
        localPeerId: "",
        remotePeerId: "",
        lastError: ""
      },
      room: {
        code: "",
        hostPeerId: "",
        role: ""
      },
      remotePeer: null,
      media: {
        videoIdentity: defaults.videoIdentity,
        playbackState: canonicalizePlaybackState(defaults.playbackState),
        lastControlTimestamp: defaults.lastControlTimestamp,
        lastControlId: defaults.lastControlId,
        lastAppliedRemoteEventId: "",
        lastAppliedRemoteAt: 0
      },
      chat: {
        messages: defaults.chatMessages.slice()
      },
      diagnostics: createDiagnostics()
    };
  }

  function buildHostPeerId(roomCode) {
    return `bt_${String(roomCode || "").trim().toUpperCase()}`;
  }

  function createDiagnosticEntry(level, message, meta = null, timestamp = now()) {
    return {
      id: randomId("log"),
      level: level || "info",
      message: String(message || ""),
      meta: meta || null,
      timestamp
    };
  }

  function appendDiagnostic(diagnostics, entry, nextLastError = diagnostics.lastError) {
    return {
      lastError: nextLastError,
      lastEventAt: entry.timestamp,
      logs: [...diagnostics.logs, entry].slice(-DIAGNOSTIC_LOG_LIMIT)
    };
  }

  function mergeTransportStatus(state, status = {}) {
    const phase = status.phase || state.transport.phase;
    const roomCode = status.roomCode ?? state.room.code;
    const hostPeerId = status.hostPeerId ?? state.room.hostPeerId;
    const role = status.role ?? state.room.role;
    const remotePeerId = status.remotePeerId ?? "";
    const diagnosticsEntry = createDiagnosticEntry(
      status.lastError ? "error" : "info",
      status.lastError || `传输状态: ${phase}`,
      {
        phase,
        roomCode,
        role,
        remotePeerId
      },
      status.lastEventAt || now()
    );

    return {
      ...state,
      transport: {
        phase,
        roomCode,
        hostPeerId,
        role,
        localPeerId: status.localPeerId ?? state.transport.localPeerId,
        remotePeerId,
        lastError: status.lastError || ""
      },
      room: {
        code: roomCode,
        hostPeerId,
        role
      },
      remotePeer:
        phase === CONNECTION_PHASES.CONNECTED && remotePeerId
          ? {
              peerId: remotePeerId,
              nickname:
                state.remotePeer?.peerId === remotePeerId ? state.remotePeer.nickname : state.remotePeer?.nickname || "对方",
              connectionState: "connected"
            }
          : phase === CONNECTION_PHASES.DISCONNECTED || phase === CONNECTION_PHASES.IDLE
            ? null
            : state.remotePeer,
      diagnostics: appendDiagnostic(
        state.diagnostics,
        diagnosticsEntry,
        status.lastError ? status.lastError : phase === CONNECTION_PHASES.FAILED ? state.diagnostics.lastError : ""
      )
    };
  }

  function applyPlaybackEnvelope(state, envelope, fromRemote) {
    const cmp = compareEventOrder(
      envelope.timestamp,
      envelope.id,
      state.media.lastControlTimestamp,
      state.media.lastControlId
    );
    if (cmp < 0) {
      return state;
    }

    return {
      ...state,
      media: {
        ...state.media,
        playbackState: canonicalizePlaybackState({
          ...state.media.playbackState,
          ...envelope.data?.playbackState,
          updatedAt: envelope.timestamp,
          updatedBy: fromRemote ? envelope.senderId : state.identity?.peerId || ""
        }),
        videoIdentity: envelope.data?.videoIdentity || state.media.videoIdentity,
        lastControlTimestamp: envelope.timestamp,
        lastControlId: envelope.id,
        lastAppliedRemoteEventId: fromRemote ? envelope.id : state.media.lastAppliedRemoteEventId,
        lastAppliedRemoteAt: fromRemote ? envelope.timestamp : state.media.lastAppliedRemoteAt
      },
      remotePeer:
        fromRemote && envelope.senderId
          ? {
              peerId: envelope.senderId,
              nickname: envelope.senderNickname || "对方",
              connectionState: "connected"
            }
          : state.remotePeer
    };
  }

  function applyRemoteEnvelope(state, envelope) {
    if (!envelope?.kind) {
      return state;
    }

    switch (envelope.kind) {
      case ROOM_EVENT_TYPES.STATE_SNAPSHOT:
        return {
          ...state,
          remotePeer: {
            peerId: envelope.senderId,
            nickname: envelope.senderNickname || "对方",
            connectionState: "connected"
          },
          media: {
            ...state.media,
            videoIdentity: envelope.data?.videoIdentity || state.media.videoIdentity,
            playbackState: canonicalizePlaybackState(envelope.data?.playbackState),
            lastControlTimestamp: Number(envelope.data?.lastControlTimestamp || state.media.lastControlTimestamp || 0),
            lastControlId: String(envelope.data?.lastControlId || state.media.lastControlId || ""),
            lastAppliedRemoteEventId: envelope.id,
            lastAppliedRemoteAt: envelope.timestamp
          },
          chat: {
            messages: trimChatHistory(envelope.data?.chatMessages || [])
          }
        };
      case ROOM_EVENT_TYPES.CHAT_MESSAGE:
        return {
          ...state,
          remotePeer: {
            peerId: envelope.senderId,
            nickname: envelope.senderNickname || "对方",
            connectionState: "connected"
          },
          chat: {
            messages: trimChatHistory([
              ...state.chat.messages,
              {
                id: envelope.id,
                senderId: envelope.senderId,
                senderNickname: envelope.senderNickname,
                text: envelope.data?.text || "",
                timestamp: envelope.timestamp
              }
            ])
          }
        };
      case ROOM_EVENT_TYPES.SYNC_VIDEO_CHANGE:
        return {
          ...state,
          remotePeer: {
            peerId: envelope.senderId,
            nickname: envelope.senderNickname || "对方",
            connectionState: "connected"
          },
          media: {
            ...state.media,
            videoIdentity: envelope.data?.videoIdentity || state.media.videoIdentity,
            lastControlTimestamp: envelope.timestamp,
            lastControlId: envelope.id,
            lastAppliedRemoteEventId: envelope.id,
            lastAppliedRemoteAt: envelope.timestamp
          }
        };
      case ROOM_EVENT_TYPES.SYNC_PLAY:
      case ROOM_EVENT_TYPES.SYNC_PAUSE:
      case ROOM_EVENT_TYPES.SYNC_SEEK:
      case ROOM_EVENT_TYPES.SYNC_RATE:
        return applyPlaybackEnvelope(state, envelope, true);
      default:
        return state;
    }
  }

  function applyLocalEnvelope(state, envelope) {
    if (!envelope?.kind) {
      return state;
    }
    if (envelope.kind === ROOM_EVENT_TYPES.CHAT_MESSAGE) {
      return {
        ...state,
        chat: {
          messages: trimChatHistory([
            ...state.chat.messages,
            {
              id: envelope.id,
              senderId: envelope.senderId,
              senderNickname: envelope.senderNickname,
              text: envelope.data?.text || "",
              timestamp: envelope.timestamp
            }
          ])
        }
      };
    }
    if (envelope.kind === ROOM_EVENT_TYPES.SYNC_VIDEO_CHANGE) {
      return {
        ...state,
        media: {
          ...state.media,
          videoIdentity: envelope.data?.videoIdentity || state.media.videoIdentity,
          lastControlTimestamp: envelope.timestamp,
          lastControlId: envelope.id
        }
      };
    }
    if (
      envelope.kind === ROOM_EVENT_TYPES.SYNC_PLAY ||
      envelope.kind === ROOM_EVENT_TYPES.SYNC_PAUSE ||
      envelope.kind === ROOM_EVENT_TYPES.SYNC_SEEK ||
      envelope.kind === ROOM_EVENT_TYPES.SYNC_RATE
    ) {
      return applyPlaybackEnvelope(state, envelope, false);
    }
    return state;
  }

  function reduceSessionState(state, action) {
    switch (action.type) {
      case "SET_IDENTITY":
        return {
          ...state,
          identity: action.identity
        };
      case "HYDRATE_STATE":
        return hydrateSessionState(action.identity || state.identity, action.snapshot);
      case "TRANSPORT_STATUS_CHANGED":
        return mergeTransportStatus(state, action.status);
      case "TRANSPORT_ERROR": {
        const entry = createDiagnosticEntry("error", action.message, action.meta, action.timestamp || now());
        return {
          ...state,
          transport: {
            ...state.transport,
            phase: CONNECTION_PHASES.FAILED,
            lastError: action.message
          },
          diagnostics: appendDiagnostic(state.diagnostics, entry, action.message)
        };
      }
      case "LOCAL_PLAYBACK_UPDATED":
        return {
          ...state,
          media: {
            ...state.media,
            playbackState: canonicalizePlaybackState({
              ...state.media.playbackState,
              ...action.playbackState,
              updatedBy: action.updatedBy || state.identity?.peerId || state.media.playbackState.updatedBy
            }),
            videoIdentity: action.videoIdentity || state.media.videoIdentity
          }
        };
      case "LOCAL_ENVELOPE_CREATED":
        return applyLocalEnvelope(state, action.envelope);
      case "REMOTE_ENVELOPE_RECEIVED":
        return applyRemoteEnvelope(state, action.envelope);
      case "LOG_DIAGNOSTIC": {
        const entry = createDiagnosticEntry(action.level, action.message, action.meta, action.timestamp || now());
        return {
          ...state,
          diagnostics: appendDiagnostic(state.diagnostics, entry, action.lastError ?? state.diagnostics.lastError)
        };
      }
      case "RESET_SESSION":
        return createInitialState(state.identity);
      default:
        return state;
    }
  }

  function buildEnvelope(identity, kind, data = {}) {
    return {
      id: randomId("evt"),
      kind,
      senderId: identity?.peerId || "",
      senderNickname: identity?.nickname || "",
      timestamp: now(),
      data
    };
  }

  function buildStateSnapshotEnvelope(identity, state) {
    return buildEnvelope(identity, ROOM_EVENT_TYPES.STATE_SNAPSHOT, {
      videoIdentity: state.media.videoIdentity,
      playbackState: state.media.playbackState,
      lastControlTimestamp: state.media.lastControlTimestamp,
      lastControlId: state.media.lastControlId,
      chatMessages: state.chat.messages
    });
  }

  function serializeAppState(state) {
    return {
      identity: state.identity,
      connectionPhase: state.transport.phase,
      transport: state.transport,
      room: state.room,
      remotePeer: state.remotePeer,
      lastError: state.diagnostics.lastError,
      diagnostics: state.diagnostics,
      sessionState: {
        videoIdentity: state.media.videoIdentity,
        playbackState: state.media.playbackState,
        lastControlTimestamp: state.media.lastControlTimestamp,
        lastControlId: state.media.lastControlId,
        chatMessages: state.chat.messages
      },
      isConnected: state.transport.phase === CONNECTION_PHASES.CONNECTED
    };
  }

  function serializePersistedSession(state) {
    return {
      transport: state.transport,
      room: state.room,
      remotePeer: state.remotePeer,
      media: state.media,
      chat: state.chat,
      diagnostics: {
        ...state.diagnostics,
        logs: state.diagnostics.logs.slice(-DIAGNOSTIC_LOG_LIMIT)
      }
    };
  }

  function hydrateSessionState(identity, snapshot) {
    const base = createInitialState(identity);
    if (!snapshot) {
      return base;
    }
    return {
      ...base,
      transport: {
        ...base.transport,
        ...(snapshot.transport || {})
      },
      room: {
        ...base.room,
        ...(snapshot.room || {})
      },
      remotePeer: snapshot.remotePeer || null,
      media: {
        ...base.media,
        ...(snapshot.media || {}),
        playbackState: canonicalizePlaybackState(snapshot.media?.playbackState || base.media.playbackState)
      },
      chat: {
        messages: trimChatHistory(snapshot.chat?.messages || [])
      },
      diagnostics: {
        ...createDiagnostics(),
        ...(snapshot.diagnostics || {}),
        logs: (snapshot.diagnostics?.logs || []).slice(-DIAGNOSTIC_LOG_LIMIT)
      }
    };
  }

  return {
    buildEnvelope,
    buildHostPeerId,
    buildStateSnapshotEnvelope,
    createDiagnosticEntry,
    createInitialState,
    hydrateSessionState,
    reduceSessionState,
    serializeAppState,
    serializePersistedSession
  };
});
