(function initUtils(globalScope) {
  const { CHAT_HISTORY_LIMIT } = globalScope.BiliTogetherConstants;

  function now() {
    return Date.now();
  }

  function randomId(prefix = "id") {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function generateRoomCode(length = 6) {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let result = "";
    for (let index = 0; index < length; index += 1) {
      result += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return result;
  }

  function safeJsonParse(value, fallback = null) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function normalizeRoomCode(roomId) {
    return String(roomId || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 12);
  }

  function compareEventOrder(candidateTimestamp, candidateId, currentTimestamp, currentId) {
    if (candidateTimestamp !== currentTimestamp) {
      return candidateTimestamp - currentTimestamp;
    }
    return String(candidateId || "").localeCompare(String(currentId || ""));
  }

  function createFallbackNickname() {
    return `B站观众${Math.floor(Math.random() * 900 + 100)}`;
  }

  function trimChatHistory(messages) {
    return (messages || []).slice(-CHAT_HISTORY_LIMIT);
  }

  function shallowEqualVideoIdentity(left, right) {
    if (!left && !right) {
      return true;
    }
    if (!left || !right) {
      return false;
    }
    return left.key === right.key || left.url === right.url;
  }

  function formatRelativeTime(timestamp) {
    if (!timestamp) {
      return "";
    }
    const delta = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (delta < 10) {
      return "刚刚";
    }
    if (delta < 60) {
      return `${delta} 秒前`;
    }
    const minutes = Math.floor(delta / 60);
    if (minutes < 60) {
      return `${minutes} 分钟前`;
    }
    return `${Math.floor(minutes / 60)} 小时前`;
  }

  function canonicalizePlaybackState(state) {
    return {
      currentTime: Number(state?.currentTime || 0),
      isPlaying: Boolean(state?.isPlaying),
      playbackRate: Number(state?.playbackRate || 1),
      updatedAt: Number(state?.updatedAt || 0),
      updatedBy: state?.updatedBy || ""
    };
  }

  globalScope.BiliTogetherUtils = {
    canonicalizePlaybackState,
    compareEventOrder,
    createFallbackNickname,
    formatRelativeTime,
    generateRoomCode,
    normalizeRoomCode,
    now,
    randomId,
    safeJsonParse,
    shallowEqualVideoIdentity,
    trimChatHistory
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
