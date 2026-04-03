(function initPopup() {
  const { MESSAGE_TYPES } = BiliTogetherConstants;
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
    hostHint: $("hostHint"),
    guestPanel: $("guestPanel"),
    joiningRoomId: $("joiningRoomId"),
    connectedPanel: $("connectedPanel"),
    peerName: $("peerName"),
    errorPanel: $("errorPanel"),
    openBilibiliButton: $("openBilibiliButton"),
    resetSessionButton: $("resetSessionButton")
  };

  // ── 工具 ──────────────────────────────────────
  async function request(type, payload = {}) {
    const resp = await chrome.runtime.sendMessage({ type, payload });
    if (!resp?.ok) throw new Error(resp?.error || "请求失败");
    return resp.data;
  }

  function showError(msg) {
    els.errorPanel.textContent = msg;
    els.errorPanel.classList.remove("hidden");
  }

  function clearError() {
    els.errorPanel.classList.add("hidden");
    els.errorPanel.textContent = "";
  }

  function showOnly(...panels) {
    [els.homePanel, els.hostPanel, els.guestPanel, els.connectedPanel].forEach(p => p.classList.add("hidden"));
    panels.forEach(p => p.classList.remove("hidden"));
  }

  function phaseText(phase) {
    switch (phase) {
      case "connecting": return "连接中";
      case "connected":   return "已连接";
      case "failed":     return "连接失败";
      default:           return "未连接";
    }
  }

  function phaseTone(phase) {
    if (phase === "connected") return "ok";
    if (phase === "failed")    return "err";
    if (phase === "connecting") return "warn";
    return "neutral";
  }

  // ── 渲染状态 ────────────────────────────────────
  function render(appState) {
    els.connectionStatus.textContent = phaseText(appState.connectionPhase);
    els.connectionStatus.className = `status-pill ${phaseTone(appState.connectionPhase)}`;

    if (appState.connectionPhase === "connected") {
      els.peerName.textContent = `正在和 ${appState.remotePeer?.nickname || "对方"} 一起看`;
    }

    // 空闲时显示首页
    if (appState.connectionPhase === "idle" && !els.hostPanel.classList.contains("hidden") === false) {
      showOnly(els.homePanel);
    }
  }

  // ── 创建房间 ────────────────────────────────────
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
      setTimeout(() => { els.copyRoomIdBtn.textContent = "复制房间号"; }, 2000);
    } catch (e) {
      showError(e.message);
    } finally {
      els.createRoomBtn.disabled = false;
      els.createRoomBtn.textContent = "创建房间";
    }
  }

  // ── 加入房间 ────────────────────────────────────
  async function handleJoinRoom() {
    const roomId = els.roomIdInput.value.trim().toUpperCase();
    if (!roomId) { showError("请输入房间号"); return; }
    clearError();
    els.joinRoomBtn.disabled = true;
    els.joinRoomBtn.textContent = "加入中...";
    els.joiningRoomId.textContent = roomId;
    showOnly(els.guestPanel);
    els.sessionMeta.textContent = `正在加入 ${roomId}...`;
    try {
      await request(MESSAGE_TYPES.JOIN_ROOM, { roomId: `bt_${roomId}` });
      // 连接成功由状态更新触发
    } catch (e) {
      showError(e.message);
      showOnly(els.homePanel);
      els.sessionMeta.textContent = "分享房间号，快速一起看。";
    } finally {
      els.joinRoomBtn.disabled = false;
      els.joinRoomBtn.textContent = "加入房间";
    }
  }

  // ── 重置 ────────────────────────────────────────
  async function handleReset() {
    clearError();
    try { await request(MESSAGE_TYPES.RESET_SESSION); } catch {}
    els.roomIdInput.value = "";
    showOnly(els.homePanel);
    els.sessionMeta.textContent = "分享房间号，快速一起看。";
  }

  // ── 事件 ────────────────────────────────────────
  els.createRoomBtn.addEventListener("click", handleCreateRoom);
  els.joinRoomBtn.addEventListener("click", handleJoinRoom);
  els.roomIdInput.addEventListener("keydown", (e) => { if (e.key === "Enter") handleJoinRoom(); });
  els.copyRoomIdBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(els.roomIdDisplay.textContent);
    els.copyRoomIdBtn.textContent = "已复制 ✓";
    setTimeout(() => { els.copyRoomIdBtn.textContent = "复制房间号"; }, 2000);
  });
  els.resetSessionButton.addEventListener("click", handleReset);
  els.openBilibiliButton.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://www.bilibili.com/" });
  });

  // 状态同步
  const port = chrome.runtime.connect({ name: "popup" });
  port.onMessage.addListener((msg) => {
    if (msg.type === MESSAGE_TYPES.APP_STATE_UPDATED) {
      const s = msg.payload;
      render(s);
      if (s.connectionPhase === "connected") {
        showOnly(els.connectedPanel);
        els.sessionMeta.textContent = "连接成功，开始同步！";
      } else if (s.connectionPhase === "failed" && els.guestPanel.classList.contains("hidden") === false) {
        showError(s.lastError || "连接失败");
        showOnly(els.homePanel);
      }
    }
  });

  request(MESSAGE_TYPES.GET_APP_STATE).then(render).catch(() => {});
})();
