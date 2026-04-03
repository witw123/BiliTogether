(function initContent() {
  const { MESSAGE_TYPES, REMOTE_APPLY_GUARD_MS, ROOM_EVENT_TYPES, TOAST_DURATION_MS, VIDEO_STATE_POLL_MS } =
    BiliTogetherConstants;
  const { createFallbackNickname, now, shallowEqualVideoIdentity } = BiliTogetherUtils;

  const state = {
    root: null,
    panel: null,
    toast: null,
    toastTimer: null,
    chatList: null,
    chatInput: null,
    lastUrl: location.href,
    suppressEventsUntil: 0,
    videoPollTimer: null
  };

  function createUi() {
    if (state.root) {
      return;
    }
    state.root = document.createElement("div");
    state.root.id = "biltogether-root";
    state.root.innerHTML = `
      <section class="biltogether-panel collapsed">
        <header class="biltogether-header">
          <div class="biltogether-title">
            <strong>BiliTogether</strong>
            <span id="biltogether-status">未连接</span>
          </div>
          <button class="biltogether-toggle" type="button">展开</button>
        </header>
        <div class="biltogether-body">
          <section class="biltogether-meta">
            <article class="biltogether-card">
              <p class="biltogether-card-label">同步</p>
              <p id="biltogether-sync-state" class="biltogether-card-value">待命</p>
            </article>
            <article class="biltogether-card">
              <p class="biltogether-card-label">对方</p>
              <p id="biltogether-peer" class="biltogether-card-value">未连接</p>
            </article>
          </section>
          <section>
            <p class="biltogether-card-label">状态</p>
            <div id="biltogether-members" class="biltogether-members">
              <span class="biltogether-muted">去插件弹窗里完成邀请配对。</span>
            </div>
          </section>
          <section class="biltogether-chat">
            <p class="biltogether-card-label">聊天</p>
            <div id="biltogether-chat-list" class="biltogether-chat-list">
              <div class="biltogether-muted">连接成功后可以在这里聊天。</div>
            </div>
            <form id="biltogether-chat-form" class="biltogether-chat-form">
              <input id="biltogether-chat-input" type="text" maxlength="200" placeholder="发一条消息..." />
              <button type="submit">发送</button>
            </form>
          </section>
        </div>
      </section>
      <div class="biltogether-toast" id="biltogether-toast"></div>
    `;

    document.documentElement.appendChild(state.root);
    state.panel = state.root.querySelector(".biltogether-panel");
    state.toast = state.root.querySelector("#biltogether-toast");
    state.chatList = state.root.querySelector("#biltogether-chat-list");
    state.chatInput = state.root.querySelector("#biltogether-chat-input");

    state.root.querySelector(".biltogether-toggle").addEventListener("click", () => {
      const collapsed = state.panel.classList.toggle("collapsed");
      state.root.querySelector(".biltogether-toggle").textContent = collapsed ? "展开" : "收起";
    });

    state.root.querySelector("#biltogether-chat-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = state.chatInput.value.trim();
      if (!text) {
        return;
      }
      state.chatInput.value = "";
      await requestRuntime(MESSAGE_TYPES.CONTENT_SEND_CHAT, { text });
    });
  }

  function findVideoElement() {
    return document.querySelector("video");
  }

  const adapter = {
    getPlaybackState() {
      const video = findVideoElement();
      if (!video) {
        return null;
      }
      return {
        currentTime: video.currentTime || 0,
        isPlaying: !video.paused,
        playbackRate: video.playbackRate || 1,
        updatedAt: now()
      };
    },
    play() {
      return findVideoElement()?.play?.();
    },
    pause() {
      return findVideoElement()?.pause?.();
    },
    seekTo(seconds) {
      const video = findVideoElement();
      if (video) {
        video.currentTime = Math.max(0, Number(seconds || 0));
      }
    },
    setPlaybackRate(rate) {
      const video = findVideoElement();
      if (video) {
        video.playbackRate = Number(rate || 1);
      }
    },
    getVideoIdentity() {
      const url = new URL(location.href);
      const videoMatch = url.pathname.match(/\/video\/([^/?]+)/);
      const bangumiMatch = url.pathname.match(/\/bangumi\/play\/([^/?]+)/);
      const title = (document.querySelector("h1")?.textContent || document.title || "").trim();
      if (videoMatch) {
        return {
          type: "video",
          key: `video:${videoMatch[1]}:${url.searchParams.get("p") || "1"}`,
          bvid: videoMatch[1],
          page: url.searchParams.get("p") || "",
          cid: url.searchParams.get("cid") || "",
          title,
          url: url.href
        };
      }
      if (bangumiMatch) {
        return {
          type: "bangumi",
          key: `bangumi:${bangumiMatch[1]}`,
          episodeId: bangumiMatch[1],
          page: url.searchParams.get("p") || "",
          cid: url.searchParams.get("cid") || "",
          title,
          url: url.href
        };
      }
      return {
        type: "unknown",
        key: url.href,
        title,
        url: url.href
      };
    },
    navigateToVideo(identity) {
      if (identity?.url && location.href !== identity.url) {
        location.assign(identity.url);
      }
    }
  };

  async function requestRuntime(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, payload });
    if (!response?.ok) {
      throw new Error(response?.error || "请求失败");
    }
    return response.data;
  }

  function detectNickname() {
    const selectors = [
      ".header-entry-mini",
      ".header-avatar-wrap--container .header-uname",
      ".nav-user-center .header-uname",
      ".user-name"
    ];
    for (const selector of selectors) {
      const text = document.querySelector(selector)?.textContent?.trim();
      if (text) {
        return text;
      }
    }
    return document.querySelector('meta[name="author"]')?.content?.trim() || createFallbackNickname();
  }

  async function announceReady() {
    await requestRuntime(MESSAGE_TYPES.CONTENT_READY, {
      nickname: detectNickname(),
      videoIdentity: adapter.getVideoIdentity()
    });
    await syncPlaybackState();
  }

  async function syncPlaybackState() {
    const playbackState = adapter.getPlaybackState();
    if (!playbackState) {
      return;
    }
    await requestRuntime(MESSAGE_TYPES.CONTENT_PLAYBACK_STATE, {
      videoIdentity: adapter.getVideoIdentity(),
      playbackState
    });
  }

  function applyPlaybackState(playbackState, kind = "") {
    state.suppressEventsUntil = now() + REMOTE_APPLY_GUARD_MS;
    if (typeof playbackState.playbackRate === "number") {
      adapter.setPlaybackRate(playbackState.playbackRate);
    }
    if (typeof playbackState.currentTime === "number") {
      const current = adapter.getPlaybackState()?.currentTime || 0;
      if (Math.abs(current - playbackState.currentTime) > 1) {
        adapter.seekTo(playbackState.currentTime);
      }
    }
    if (kind === ROOM_EVENT_TYPES.SYNC_PLAY || playbackState.isPlaying) {
      adapter.play();
    }
    if (kind === ROOM_EVENT_TYPES.SYNC_PAUSE || playbackState.isPlaying === false) {
      adapter.pause();
    }
  }

  function applyRemoteEvent(envelope) {
    if (!envelope?.kind) {
      return;
    }
    if (envelope.kind === ROOM_EVENT_TYPES.STATE_SNAPSHOT) {
      if (envelope.data?.videoIdentity && !shallowEqualVideoIdentity(envelope.data.videoIdentity, adapter.getVideoIdentity())) {
        state.suppressEventsUntil = now() + REMOTE_APPLY_GUARD_MS * 3;
        showToast(`正在同步到 ${envelope.data.videoIdentity.title || "房间视频"}`);
        adapter.navigateToVideo(envelope.data.videoIdentity);
        return;
      }
      if (envelope.data?.playbackState) {
        applyPlaybackState(envelope.data.playbackState);
      }
      return;
    }
    if (envelope.kind === ROOM_EVENT_TYPES.SYNC_VIDEO_CHANGE) {
      if (!shallowEqualVideoIdentity(envelope.data.videoIdentity, adapter.getVideoIdentity())) {
        state.suppressEventsUntil = now() + REMOTE_APPLY_GUARD_MS * 3;
        showToast(`正在跳转到 ${envelope.data.videoIdentity.title || "对方视频"}`);
        adapter.navigateToVideo(envelope.data.videoIdentity);
      }
      return;
    }
    if (envelope.data?.playbackState) {
      applyPlaybackState(envelope.data.playbackState, envelope.kind);
    }
  }

  function handleVideoEvent(kind) {
    if (now() < state.suppressEventsUntil) {
      return;
    }
    const playbackState = adapter.getPlaybackState();
    if (!playbackState) {
      return;
    }
    requestRuntime(MESSAGE_TYPES.CONTENT_CONTROL_EVENT, {
      kind,
      playbackState,
      videoIdentity: adapter.getVideoIdentity()
    }).catch(() => {});
  }

  function bindVideoListeners() {
    const wire = () => {
      const video = findVideoElement();
      if (!video || video.dataset.biliTogetherBound === "1") {
        return;
      }
      video.dataset.biliTogetherBound = "1";
      video.addEventListener("play", () => handleVideoEvent(ROOM_EVENT_TYPES.SYNC_PLAY));
      video.addEventListener("pause", () => handleVideoEvent(ROOM_EVENT_TYPES.SYNC_PAUSE));
      video.addEventListener("seeked", () => handleVideoEvent(ROOM_EVENT_TYPES.SYNC_SEEK));
      video.addEventListener("ratechange", () => handleVideoEvent(ROOM_EVENT_TYPES.SYNC_RATE));
      syncPlaybackState().catch(() => {});
    };

    wire();
    const observer = new MutationObserver(() => wire());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function monitorRouteChanges() {
    setInterval(() => {
      if (location.href === state.lastUrl) {
        return;
      }
      state.lastUrl = location.href;
      announceReady().catch(() => {});
      handleVideoEvent(ROOM_EVENT_TYPES.SYNC_VIDEO_CHANGE);
    }, 1000);
  }

  function render(appState) {
    const statusNode = document.getElementById("biltogether-status");
    const syncStateNode = document.getElementById("biltogether-sync-state");
    const peerNode = document.getElementById("biltogether-peer");
    const membersNode = document.getElementById("biltogether-members");

    statusNode.textContent = appState.isConnected ? "已连接" : "未连接";
    syncStateNode.textContent = appState.isConnected ? "实时同步中" : "待命";
    peerNode.textContent = appState.remotePeer?.nickname || "未连接";
    membersNode.innerHTML = appState.isConnected
      ? `<span class="biltogether-member self">${escapeHtml(appState.identity.nickname)}<small>你</small></span><span class="biltogether-member">${escapeHtml(appState.remotePeer?.nickname || "远端成员")}</span>`
      : '<span class="biltogether-muted">去插件弹窗里完成邀请配对。</span>';
    renderChat(appState.sessionState?.chatMessages || []);
  }

  function renderChat(messages) {
    if (!messages.length) {
      state.chatList.innerHTML = '<div class="biltogether-muted">连接成功后可以在这里聊天。</div>';
      return;
    }
    state.chatList.innerHTML = messages
      .slice(-20)
      .map(
        (item) =>
          `<article class="biltogether-chat-item"><strong>${escapeHtml(item.senderNickname || "成员")}</strong><div>${escapeHtml(item.text || "")}</div></article>`
      )
      .join("");
    state.chatList.scrollTop = state.chatList.scrollHeight;
  }

  function showToast(text, duration = TOAST_DURATION_MS) {
    state.toast.textContent = text;
    state.toast.classList.add("visible");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => state.toast.classList.remove("visible"), duration);
  }

  function escapeHtml(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === MESSAGE_TYPES.APP_STATE_UPDATED) {
      render(message.payload);
    }
    if (message.type === MESSAGE_TYPES.APPLY_REMOTE_EVENT) {
      applyRemoteEvent(message.payload.event);
      syncPlaybackState().catch(() => {});
    }
    if (message.type === MESSAGE_TYPES.SHOW_TOAST) {
      showToast(message.payload.text, message.payload.duration);
    }
    sendResponse({ ok: true });
    return false;
  });

  function startStatePolling() {
    clearInterval(state.videoPollTimer);
    state.videoPollTimer = setInterval(() => syncPlaybackState().catch(() => {}), VIDEO_STATE_POLL_MS);
  }

  async function bootstrap() {
    createUi();
    bindVideoListeners();
    monitorRouteChanges();
    startStatePolling();
    await announceReady();
  }

  bootstrap().catch((error) => {
    console.error("BiliTogether content bootstrap failed", error);
  });
})();
