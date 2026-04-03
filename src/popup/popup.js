(function initPopup() {
  const { MESSAGE_TYPES } = BiliTogetherConstants;

  const elements = {
    connectionStatus: document.getElementById("connectionStatus"),
    sessionMeta: document.getElementById("sessionMeta"),
    hostModeButton: document.getElementById("hostModeButton"),
    guestModeButton: document.getElementById("guestModeButton"),
    hostPanel: document.getElementById("hostPanel"),
    guestPanel: document.getElementById("guestPanel"),
    createInviteButton: document.getElementById("createInviteButton"),
    inviteOutput: document.getElementById("inviteOutput"),
    copyInviteButton: document.getElementById("copyInviteButton"),
    responseInput: document.getElementById("responseInput"),
    completeHandshakeButton: document.getElementById("completeHandshakeButton"),
    inviteInput: document.getElementById("inviteInput"),
    acceptInviteButton: document.getElementById("acceptInviteButton"),
    responseOutput: document.getElementById("responseOutput"),
    copyResponseButton: document.getElementById("copyResponseButton"),
    remotePeer: document.getElementById("remotePeer"),
    openBilibiliButton: document.getElementById("openBilibiliButton"),
    resetSessionButton: document.getElementById("resetSessionButton"),
    errorPanel: document.getElementById("errorPanel")
  };

  let currentMode = "host";

  function setMode(mode) {
    currentMode = mode;
    elements.hostModeButton.classList.toggle("active", mode === "host");
    elements.guestModeButton.classList.toggle("active", mode === "guest");
    elements.hostPanel.classList.toggle("hidden", mode !== "host");
    elements.guestPanel.classList.toggle("hidden", mode !== "guest");
  }

  function connectPort() {
    const port = chrome.runtime.connect({ name: "popup" });
    port.onMessage.addListener((message) => {
      if (message.type === MESSAGE_TYPES.APP_STATE_UPDATED) {
        render(message.payload);
      }
    });
  }

  async function request(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.ok) {
      throw new Error(response?.error || "请求失败");
    }
    return response.data;
  }

  function render(appState) {
    elements.connectionStatus.textContent = phaseText(appState.connectionPhase);
    elements.connectionStatus.className = `status-pill ${phaseTone(appState.connectionPhase)}`;
    elements.sessionMeta.textContent = metaText(appState.connectionPhase, appState.isConnected);
    elements.remotePeer.textContent = appState.remotePeer
      ? `已配对：${appState.remotePeer.nickname || "远端成员"}`
      : "尚未连接对方";
    elements.inviteOutput.value = appState.lastInvite || "";
    elements.errorPanel.textContent = appState.lastError || "";
    elements.errorPanel.classList.toggle("hidden", !appState.lastError);

    if (appState.connectionPhase === "answer-created") {
      setMode("guest");
    } else if (["offer-created", "connecting", "connected"].includes(appState.connectionPhase)) {
      setMode("host");
    }
  }

  function phaseText(phase) {
    switch (phase) {
      case "creating-offer":
        return "生成中";
      case "offer-created":
        return "等待对方";
      case "answer-created":
        return "等待房主";
      case "connecting":
        return "连接中";
      case "connected":
        return "已连接";
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
    if (["creating-offer", "offer-created", "answer-created", "connecting", "failed"].includes(phase)) {
      return "warn";
    }
    return "neutral";
  }

  function metaText(phase, isConnected) {
    if (isConnected) {
      return "双方已连通，播放控制和聊天会实时同步。";
    }
    if (phase === "offer-created") {
      return "把连接码发给对方，等对方把确认码发回来。";
    }
    if (phase === "answer-created") {
      return "把确认码发回房主，等对方点完成连接。";
    }
    if (phase === "connecting") {
      return "正在建立点对点连接，请保持弹窗不要立刻关闭。";
    }
    return "先选择你是房主还是加入方。";
  }

  async function copyText(value) {
    if (!value) {
      return;
    }
    await navigator.clipboard.writeText(value);
  }

  async function bootstrap() {
    connectPort();
    render(await request(MESSAGE_TYPES.GET_APP_STATE));

    elements.hostModeButton.addEventListener("click", () => setMode("host"));
    elements.guestModeButton.addEventListener("click", () => setMode("guest"));

    elements.createInviteButton.addEventListener("click", async () => {
      const result = await request(MESSAGE_TYPES.CREATE_INVITE);
      elements.inviteOutput.value = result.invite;
      await copyText(result.invite);
    });

    elements.copyInviteButton.addEventListener("click", async () => {
      await copyText(elements.inviteOutput.value);
    });

    elements.acceptInviteButton.addEventListener("click", async () => {
      const result = await request(MESSAGE_TYPES.ACCEPT_INVITE, {
        invite: elements.inviteInput.value
      });
      elements.responseOutput.value = result.response;
      await copyText(result.response);
    });

    elements.copyResponseButton.addEventListener("click", async () => {
      await copyText(elements.responseOutput.value);
    });

    elements.completeHandshakeButton.addEventListener("click", async () => {
      await request(MESSAGE_TYPES.COMPLETE_HANDSHAKE, {
        response: elements.responseInput.value
      });
    });

    elements.resetSessionButton.addEventListener("click", async () => {
      await request(MESSAGE_TYPES.RESET_SESSION);
      elements.responseInput.value = "";
      elements.responseOutput.value = "";
      elements.inviteInput.value = "";
      setMode("host");
    });

    elements.openBilibiliButton.addEventListener("click", async () => {
      await request(MESSAGE_TYPES.OPEN_BILIBILI);
    });
  }

  bootstrap().catch((error) => {
    elements.errorPanel.textContent = error?.message || String(error);
    elements.errorPanel.classList.remove("hidden");
  });
})();
