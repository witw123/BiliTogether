(function initStorage(globalScope) {
  const { STORAGE_KEYS } = globalScope.BiliTogetherConstants;
  const { createFallbackNickname, randomId } = globalScope.BiliTogetherUtils;

  async function loadIdentity() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.IDENTITY);
    let identity = result[STORAGE_KEYS.IDENTITY];
    if (!identity?.peerId) {
      identity = {
        peerId: randomId("peer"),
        nickname: createFallbackNickname()
      };
      await chrome.storage.local.set({ [STORAGE_KEYS.IDENTITY]: identity });
    }
    return identity;
  }

  async function saveIdentity(identity) {
    const nextIdentity = {
      peerId: identity?.peerId || randomId("peer"),
      nickname: String(identity?.nickname || createFallbackNickname()).trim()
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.IDENTITY]: nextIdentity });
    return nextIdentity;
  }

  async function saveLastInvite(inviteText) {
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_INVITE]: inviteText || "" });
  }

  async function loadLastInvite() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.LAST_INVITE);
    return result[STORAGE_KEYS.LAST_INVITE] || "";
  }

  globalScope.BiliTogetherStorage = {
    loadIdentity,
    loadLastInvite,
    saveIdentity,
    saveLastInvite
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
