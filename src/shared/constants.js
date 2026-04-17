(function initConstants(globalScope) {
  const MESSAGE_TYPES = {
    GET_APP_STATE: "GET_APP_STATE",
    CREATE_ROOM: "CREATE_ROOM",
    JOIN_ROOM: "JOIN_ROOM",
    RESET_SESSION: "RESET_SESSION",
    OPEN_BILIBILI: "OPEN_BILIBILI",
    CONTENT_READY: "CONTENT_READY",
    CONTENT_CONTROL_EVENT: "CONTENT_CONTROL_EVENT",
    CONTENT_SEND_CHAT: "CONTENT_SEND_CHAT",
    CONTENT_PLAYBACK_STATE: "CONTENT_PLAYBACK_STATE",
    APP_STATE_UPDATED: "APP_STATE_UPDATED",
    APPLY_REMOTE_EVENT: "APPLY_REMOTE_EVENT",
    SHOW_TOAST: "SHOW_TOAST"
  };

  const OFFSCREEN_COMMAND_TYPES = {
    GET_STATUS: "OFFSCREEN_GET_STATUS",
    CREATE_ROOM: "OFFSCREEN_CREATE_ROOM",
    JOIN_ROOM: "OFFSCREEN_JOIN_ROOM",
    SEND_ENVELOPE: "OFFSCREEN_SEND_ENVELOPE",
    RESET: "OFFSCREEN_RESET"
  };

  const OFFSCREEN_EVENT_TYPES = {
    STATUS_CHANGED: "OFFSCREEN_STATUS_CHANGED",
    PEER_MESSAGE: "OFFSCREEN_PEER_MESSAGE",
    ERROR: "OFFSCREEN_ERROR",
    DIAGNOSTIC: "OFFSCREEN_DIAGNOSTIC"
  };

  const CONNECTION_PHASES = {
    IDLE: "idle",
    HOSTING: "hosting",
    JOINING: "joining",
    CONNECTED: "connected",
    DISCONNECTED: "disconnected",
    FAILED: "failed"
  };

  const ROOM_EVENT_TYPES = {
    SYNC_PLAY: "SYNC_PLAY",
    SYNC_PAUSE: "SYNC_PAUSE",
    SYNC_SEEK: "SYNC_SEEK",
    SYNC_RATE: "SYNC_RATE",
    SYNC_VIDEO_CHANGE: "SYNC_VIDEO_CHANGE",
    CHAT_MESSAGE: "CHAT_MESSAGE",
    STATE_SNAPSHOT: "STATE_SNAPSHOT"
  };

  const STORAGE_KEYS = {
    IDENTITY: "biltogether.identity",
    SESSION: "biltogether.session"
  };

  const DEFAULT_SESSION_STATE = {
    videoIdentity: null,
    playbackState: {
      currentTime: 0,
      isPlaying: false,
      playbackRate: 1,
      updatedAt: 0,
      updatedBy: ""
    },
    lastControlTimestamp: 0,
    lastControlId: "",
    chatMessages: []
  };

  const constants = {
    APP_NAME: "BiliTogether",
    CHAT_HISTORY_LIMIT: 50,
    CONNECTION_PHASES,
    DEFAULT_SESSION_STATE,
    DIAGNOSTIC_LOG_LIMIT: 20,
    HEARTBEAT_SYNC_MS: 4000,
    MESSAGE_TYPES,
    OFFSCREEN_COMMAND_TYPES,
    OFFSCREEN_EVENT_TYPES,
    REMOTE_APPLY_GUARD_MS: 1200,
    REMOTE_NAVIGATION_GUARD_MS: 3200,
    ROOM_EVENT_TYPES,
    ROUTE_CHANGE_DEBOUNCE_MS: 180,
    SEEK_SYNC_THRESHOLD_S: 0.8,
    STORAGE_KEYS,
    TOAST_DURATION_MS: 2600,
    // PeerJS 免费云信令（数据走 P2P 直连，仅信令过 PeerJS 服务器）
    // Key 可在 https://peerjs.com 免费注册获取，不填则用 PeerJS 官方 demo 服务器（有限制）
    PEERJS_KEY: "",
    PEER_OPTIONS: {
      debug: 0,
      config: {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
      }
    }
  };

  globalScope.BiliTogetherConstants = constants;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = constants;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
