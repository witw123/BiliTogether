(function initOffscreen() {
  const {
    CONNECTION_PHASES,
    OFFSCREEN_COMMAND_TYPES,
    OFFSCREEN_EVENT_TYPES,
    PEERJS_KEY,
    PEER_OPTIONS
  } = BiliTogetherConstants;
  const { normalizeRoomCode, now, safeJsonParse } = BiliTogetherUtils;
  const { buildHostPeerId } = BiliTogetherSession;

  const transport = {
    peer: null,
    connection: null,
    phase: CONNECTION_PHASES.IDLE,
    roomCode: "",
    hostPeerId: "",
    role: "",
    localPeerId: "",
    remotePeerId: "",
    lastError: "",
    lastEventAt: 0
  };

  function getStatus() {
    return {
      phase: transport.phase,
      roomCode: transport.roomCode,
      hostPeerId: transport.hostPeerId,
      role: transport.role,
      localPeerId: transport.localPeerId,
      remotePeerId: transport.remotePeerId,
      lastError: transport.lastError,
      lastEventAt: transport.lastEventAt
    };
  }

  function emit(type, payload) {
    chrome.runtime
      .sendMessage({
        source: "offscreen",
        type,
        payload
      })
      .catch(() => {});
  }

  function emitStatus() {
    emit(OFFSCREEN_EVENT_TYPES.STATUS_CHANGED, { status: getStatus() });
  }

  function emitDiagnostic(level, message, meta = null, lastError = undefined) {
    emit(OFFSCREEN_EVENT_TYPES.DIAGNOSTIC, {
      level,
      message,
      meta,
      lastError
    });
  }

  function emitError(message, meta = null) {
    emit(OFFSCREEN_EVENT_TYPES.ERROR, {
      error: message,
      meta
    });
    emitDiagnostic("error", message, meta, message);
  }

  function updateStatus(patch, shouldEmit = true) {
    Object.assign(transport, patch, {
      lastEventAt: patch.lastEventAt || now()
    });
    if (shouldEmit) {
      emitStatus();
    }
  }

  function destroyConnectionObjects() {
    try {
      transport.connection?.close();
    } catch {}
    try {
      transport.peer?.destroy();
    } catch {}
    transport.connection = null;
    transport.peer = null;
  }

  function createPeer(peerId) {
    return new Peer(peerId, {
      key: PEERJS_KEY || undefined,
      ...PEER_OPTIONS
    });
  }

  function handleTerminalError(message, meta = null, phase = CONNECTION_PHASES.FAILED) {
    destroyConnectionObjects();
    updateStatus(
      {
        phase,
        remotePeerId: "",
        lastError: message
      },
      true
    );
    emitError(message, meta);
  }

  function bindConnection(connection) {
    transport.connection = connection;

    connection.on("open", () => {
      updateStatus({
        phase: CONNECTION_PHASES.CONNECTED,
        remotePeerId: connection.peer,
        lastError: ""
      });
      emitDiagnostic("info", "P2P 连接已建立", {
        peerId: connection.peer,
        role: transport.role
      });
    });

    connection.on("data", (payload) => {
      const envelope = typeof payload === "string" ? safeJsonParse(payload, null) : payload;
      if (!envelope) {
        emitDiagnostic("warn", "收到无法解析的 DataChannel 消息");
        return;
      }
      emit(OFFSCREEN_EVENT_TYPES.PEER_MESSAGE, { envelope });
    });

    connection.on("close", () => {
      destroyConnectionObjects();
      updateStatus(
        {
          phase: CONNECTION_PHASES.DISCONNECTED,
          remotePeerId: "",
          lastError: "连接已断开"
        },
        true
      );
      emitDiagnostic("warn", "P2P 连接已断开", {
        roomCode: transport.roomCode,
        role: transport.role
      }, "连接已断开");
    });

    connection.on("error", (error) => {
      handleTerminalError(error?.message || "P2P 连接失败", { stage: "data_connection" });
    });
  }

  function attachPeerLifecycle(peer) {
    peer.on("error", (error) => {
      const message =
        error?.type === "peer-unavailable" ? "房间不存在或已过期" : error?.message || "连接错误";
      handleTerminalError(message, { stage: "peer", type: error?.type || "" });
    });
  }

  function createRoom(roomCode) {
    return new Promise((resolve, reject) => {
      const normalizedRoomCode = normalizeRoomCode(roomCode).slice(0, 6);
      if (!normalizedRoomCode) {
        reject(new Error("房间号无效"));
        return;
      }

      destroyConnectionObjects();

      const hostPeerId = buildHostPeerId(normalizedRoomCode);
      updateStatus({
        phase: CONNECTION_PHASES.HOSTING,
        roomCode: normalizedRoomCode,
        hostPeerId,
        role: "host",
        localPeerId: "",
        remotePeerId: "",
        lastError: ""
      });

      try {
        transport.peer = createPeer(hostPeerId);
      } catch {
        handleTerminalError("无法初始化 P2P 连接", { stage: "peer_create" });
        reject(new Error("无法初始化 P2P 连接"));
        return;
      }

      attachPeerLifecycle(transport.peer);

      transport.peer.on("open", (peerId) => {
        updateStatus({
          phase: CONNECTION_PHASES.HOSTING,
          roomCode: normalizedRoomCode,
          hostPeerId,
          role: "host",
          localPeerId: peerId,
          remotePeerId: "",
          lastError: ""
        });
        resolve({ status: getStatus() });
      });

      transport.peer.on("connection", (connection) => {
        if (transport.connection && transport.connection !== connection) {
          connection.close();
          emitDiagnostic("warn", "忽略多余连接请求", { peerId: connection.peer });
          return;
        }
        bindConnection(connection);
      });

      setTimeout(() => {
        if (transport.phase === CONNECTION_PHASES.HOSTING && !transport.localPeerId) {
          handleTerminalError("创建房间超时", { stage: "host_open_timeout" });
          reject(new Error("创建房间超时"));
        }
      }, 15000);
    });
  }

  function joinRoom(roomCode) {
    return new Promise((resolve, reject) => {
      const normalizedRoomCode = normalizeRoomCode(roomCode).slice(0, 6);
      if (!normalizedRoomCode) {
        reject(new Error("房间号无效"));
        return;
      }

      destroyConnectionObjects();

      const hostPeerId = buildHostPeerId(normalizedRoomCode);
      updateStatus({
        phase: CONNECTION_PHASES.JOINING,
        roomCode: normalizedRoomCode,
        hostPeerId,
        role: "guest",
        localPeerId: "",
        remotePeerId: "",
        lastError: ""
      });

      try {
        transport.peer = createPeer(undefined);
      } catch {
        handleTerminalError("无法初始化 P2P 连接", { stage: "peer_create" });
        reject(new Error("无法初始化 P2P 连接"));
        return;
      }

      attachPeerLifecycle(transport.peer);

      transport.peer.on("open", (peerId) => {
        updateStatus({
          phase: CONNECTION_PHASES.JOINING,
          roomCode: normalizedRoomCode,
          hostPeerId,
          role: "guest",
          localPeerId: peerId,
          remotePeerId: "",
          lastError: ""
        });

        const connection = transport.peer.connect(hostPeerId, { reliable: true });
        bindConnection(connection);

        connection.on("open", () => {
          resolve({ status: getStatus() });
        });
      });

      setTimeout(() => {
        if (transport.phase === CONNECTION_PHASES.JOINING) {
          handleTerminalError("连接超时", { stage: "guest_open_timeout" });
          reject(new Error("连接超时"));
        }
      }, 15000);
    });
  }

  function sendEnvelope(envelope) {
    if (!transport.connection?.open) {
      return false;
    }
    transport.connection.send(JSON.stringify(envelope));
    updateStatus({ phase: transport.phase }, false);
    return true;
  }

  function reset() {
    updateStatus(
      {
        phase: CONNECTION_PHASES.IDLE,
        roomCode: "",
        hostPeerId: "",
        role: "",
        localPeerId: "",
        remotePeerId: "",
        lastError: ""
      },
      false
    );
    destroyConnectionObjects();
    emitStatus();
    emitDiagnostic("info", "传输状态已重置");
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== "offscreen") {
      return false;
    }

    (async () => {
      try {
        switch (message.type) {
          case OFFSCREEN_COMMAND_TYPES.GET_STATUS:
            sendResponse({ ok: true, data: getStatus() });
            return;
          case OFFSCREEN_COMMAND_TYPES.CREATE_ROOM:
            sendResponse({ ok: true, data: await createRoom(message.payload.roomCode) });
            return;
          case OFFSCREEN_COMMAND_TYPES.JOIN_ROOM:
            sendResponse({ ok: true, data: await joinRoom(message.payload.roomCode) });
            return;
          case OFFSCREEN_COMMAND_TYPES.SEND_ENVELOPE:
            sendResponse({ ok: true, data: { sent: sendEnvelope(message.payload.envelope) } });
            return;
          case OFFSCREEN_COMMAND_TYPES.RESET:
            reset();
            sendResponse({ ok: true, data: getStatus() });
            return;
          default:
            sendResponse({ ok: false, error: "未知 offscreen 命令" });
        }
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();

    return true;
  });
})();
