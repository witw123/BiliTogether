(function initConstants(globalScope) {
  const MESSAGE_TYPES = {
    GET_APP_STATE: "GET_APP_STATE",
    CREATE_INVITE: "CREATE_INVITE",
    ACCEPT_INVITE: "ACCEPT_INVITE",
    COMPLETE_HANDSHAKE: "COMPLETE_HANDSHAKE",
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
    LAST_INVITE: "biltogether.lastInvite"
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

  globalScope.BiliTogetherConstants = {
    APP_NAME: "BiliTogether",
    CHAT_HISTORY_LIMIT: 50,
    DEFAULT_SESSION_STATE,
    INVITE_PROTOCOL_VERSION: 1,
    MESSAGE_TYPES,
    REMOTE_APPLY_GUARD_MS: 1200,
    ROOM_EVENT_TYPES,
    STORAGE_KEYS,
    STUN_SERVERS: [{ urls: "stun:stun.l.google.com:19302" }],
    TOAST_DURATION_MS: 2600,
    VIDEO_STATE_POLL_MS: 1500
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
