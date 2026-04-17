(function initStorage(globalScope) {
  const { STORAGE_KEYS } = globalScope.BiliTogetherConstants;
  const { createFallbackNickname, randomId } = globalScope.BiliTogetherUtils;

  function getSessionArea() {
    return chrome.storage.session || chrome.storage.local;
  }

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

  async function loadSessionSnapshot() {
    const result = await getSessionArea().get(STORAGE_KEYS.SESSION);
    return result[STORAGE_KEYS.SESSION] || null;
  }

  async function saveSessionSnapshot(snapshot) {
    await getSessionArea().set({ [STORAGE_KEYS.SESSION]: snapshot || null });
  }

  async function clearSessionSnapshot() {
    await getSessionArea().remove(STORAGE_KEYS.SESSION);
  }

  globalScope.BiliTogetherStorage = {
    loadIdentity,
    saveIdentity,
    loadSessionSnapshot,
    saveSessionSnapshot,
    clearSessionSnapshot
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
