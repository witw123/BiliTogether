(function initPopup() {
  const { MESSAGE_TYPES } = BiliTogetherConstants;
  const { formatRelativeTime } = BiliTogetherUtils;
  const $ = (id) => document.getElementById(id);

  const els = {
    connectionStatus: $("connectionStatus"),
    sessionMeta: $("sessionMeta"),
    homePanel: $("homePanel"),
    createRoomBtn: $("createRoomBtn"),
    roomIdInput: $("roomIdInput"),
    joinRoomBtn: $("joinRoomBtn"),
    hostPanel: $("hostPanel"),
    roomIdDisplay: $("roomIdDisplay"),
    copyRoomIdBtn: $("copyRoomIdBtn"),
    guestPanel: $("guestPanel"),
    joiningRoomId: $("joiningRoomId"),
    connectedPanel: $("connectedPanel"),
    peerName: $("peerName"),
    diagnosticPanel: $("diagnosticPanel"),
    diagRoom: $("diagRoom"),
    diagPeer: $("diagPeer"),
    diagLastEvent: $("diagLastEvent"),
    diagError: $("diagError"),
    errorPanel: $("errorPanel"),
    openBilibiliButton: $("openBilibiliButton"),
    resetSessionButton: $("resetSessionButton")
  };

  async function request(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.ok) {
      throw new Error(response?.error || "请求失败");
    }
    return response.data;
  }

  function showError(message) {
    els.errorPanel.textContent = message;
    els.errorPanel.classList.remove("hidden");
  }

  function clearError() {
    els.errorPanel.classList.add("hidden");
    els.errorPanel.textContent = "";
  }

  function showOnly(...panels) {
    [els.homePanel, els.hostPanel, els.guestPanel, els.connectedPanel].forEach((panel) => panel.classList.add("hidden"));
    panels.forEach((panel) => panel.classList.remove("hidden"));
  }

  function phaseText(phase) {
    switch (phase) {
      case "hosting":
        return "等待加入";
      case "joining":
        return "加入中";
      case "connected":
        return "已连接";
      case "disconnected":
        return "已断开";
      case "failed":
        return "连接失败";
      default:
        return "未连接";
    }
  }

  function phaseTone(phase) {
    if (phase === "connected") {
      return "ok";
    }
    if (phase === "hosting" || phase === "joining") {
      return "warn";
    }
    if (phase === "failed" || phase === "disconnected") {
      return "err";
    }
    return "neutral";
  }

  function phaseMeta(state) {
    switch (state.connectionPhase) {
      case "hosting":
        return "房间已创建，等待对方加入。";
      case "joining":
        return `正在加入 ${state.room?.code || "房间"}...`;
      case "connected":
        return "连接成功，开始同步。";
      case "disconnected":
        return "连接已断开，需要重新建房或加入。";
      case "failed":
        return state.lastError || "连接失败，请重试。";
      default:
        return "分享房间号，快速一起看。";
    }
  }

  function renderDiagnostics(state) {
    els.diagRoom.textContent = state.room?.code || "—";
    els.diagPeer.textContent = state.remotePeer?.nickname || state.remotePeer?.peerId || "—";
    els.diagLastEvent.textContent = state.diagnostics?.lastEventAt ? formatRelativeTime(state.diagnostics.lastEventAt) : "—";
    els.diagError.textContent = state.lastError || "—";
  }

  function renderPanels(state) {
    if (state.connectionPhase === "hosting") {
      els.roomIdDisplay.textContent = state.room?.code || "——";
      showOnly(els.hostPanel);
      return;
    }
    if (state.connectionPhase === "joining") {
      els.joiningRoomId.textContent = state.room?.code || "——";
      showOnly(els.guestPanel);
      return;
    }
    if (state.connectionPhase === "connected") {
      els.peerName.textContent = `正在和 ${state.remotePeer?.nickname || "对方"} 一起看`;
      showOnly(els.connectedPanel);
      return;
    }
    showOnly(els.homePanel);
  }

  function render(state) {
    els.connectionStatus.textContent = phaseText(state.connectionPhase);
    els.connectionStatus.className = `status-pill ${phaseTone(state.connectionPhase)}`;
    els.sessionMeta.textContent = phaseMeta(state);
    renderPanels(state);
    renderDiagnostics(state);

    if (state.connectionPhase === "failed") {
      showError(state.lastError || "连接失败");
    } else if (state.connectionPhase !== "disconnected") {
      clearError();
    }
  }

  async function handleCreateRoom() {
    clearError();
    els.createRoomBtn.disabled = true;
    els.createRoomBtn.textContent = "创建中...";
    try {
      const { roomId } = await request(MESSAGE_TYPES.CREATE_ROOM);
      els.roomIdDisplay.textContent = roomId;
      showOnly(els.hostPanel);
      els.sessionMeta.textContent = "把房间号发给朋友";
      await navigator.clipboard.writeText(roomId);
      els.copyRoomIdBtn.textContent = "已复制 ✓";
      setTimeout(() => {
        els.copyRoomIdBtn.textContent = "复制房间号";
      }, 2000);
    } catch (error) {
      showError(error.message);
    } finally {
      els.createRoomBtn.disabled = false;
      els.createRoomBtn.textContent = "创建房间";
    }
  }

  async function handleJoinRoom() {
    const roomId = els.roomIdInput.value.trim().toUpperCase().replace(/^BT_/, "");
    if (!roomId) {
      showError("请输入房间号");
      return;
    }

    clearError();
    els.joinRoomBtn.disabled = true;
    els.joinRoomBtn.textContent = "加入中...";
    els.joiningRoomId.textContent = roomId;
    showOnly(els.guestPanel);
    els.sessionMeta.textContent = `正在加入 ${roomId}...`;

    try {
      await request(MESSAGE_TYPES.JOIN_ROOM, { roomId });
    } catch (error) {
      showError(error.message);
      showOnly(els.homePanel);
      els.sessionMeta.textContent = "分享房间号，快速一起看。";
    } finally {
      els.joinRoomBtn.disabled = false;
      els.joinRoomBtn.textContent = "加入房间";
    }
  }

  async function handleReset() {
    clearError();
    try {
      await request(MESSAGE_TYPES.RESET_SESSION);
    } catch {}
    els.roomIdInput.value = "";
    showOnly(els.homePanel);
    els.sessionMeta.textContent = "分享房间号，快速一起看。";
  }

  els.createRoomBtn.addEventListener("click", handleCreateRoom);
  els.joinRoomBtn.addEventListener("click", handleJoinRoom);
  els.roomIdInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handleJoinRoom();
    }
  });
  els.copyRoomIdBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(els.roomIdDisplay.textContent);
    els.copyRoomIdBtn.textContent = "已复制 ✓";
    setTimeout(() => {
      els.copyRoomIdBtn.textContent = "复制房间号";
    }, 2000);
  });
  els.resetSessionButton.addEventListener("click", handleReset);
  els.openBilibiliButton.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://www.bilibili.com/" });
  });

  const port = chrome.runtime.connect({ name: "popup" });
  port.onMessage.addListener((message) => {
    if (message.type === MESSAGE_TYPES.APP_STATE_UPDATED) {
      render(message.payload);
    }
  });

  request(MESSAGE_TYPES.GET_APP_STATE).then(render).catch(() => {});
})();
