(function initOffscreen() {
  let manager = null;

  function ensureManager() {
    if (manager) {
      return manager;
    }
    manager = new PeerConnectionManager({
      onPeerMessage: (envelope) => {
        chrome.runtime.sendMessage({
          source: "offscreen",
          type: "OFFSCREEN_PEER_EVENT",
          payload: { envelope }
        }).catch(() => {});
      },
      onPeerState: (state) => {
        chrome.runtime.sendMessage({
          source: "offscreen",
          type: "OFFSCREEN_PEER_STATE",
          payload: { state }
        }).catch(() => {});
      },
      onLocalDescription: (description) => {
        chrome.runtime.sendMessage({
          source: "offscreen",
          type: "OFFSCREEN_SIGNAL_UPDATE",
          payload: { description }
        }).catch(() => {});
      },
      onLocalCandidate: (candidate) => {
        chrome.runtime.sendMessage({
          source: "offscreen",
          type: "OFFSCREEN_SIGNAL_UPDATE",
          payload: { candidate }
        }).catch(() => {});
      }
    });
    return manager;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.target !== "offscreen") {
      return false;
    }
    (async () => {
      try {
        const peer = ensureManager();
        switch (message.type) {
          case "OFFSCREEN_RESET":
            peer.reset();
            sendResponse({ ok: true });
            break;
          case "OFFSCREEN_CREATE_OFFER":
            peer.createAsHost();
            await peer.createOffer();
            sendResponse({ ok: true });
            break;
          case "OFFSCREEN_ACCEPT_OFFER":
            peer.createAsGuest();
            await peer.acceptOffer(message.payload.description);
            for (const candidate of message.payload.candidates || []) {
              await peer.addRemoteCandidate(candidate);
            }
            sendResponse({ ok: true });
            break;
          case "OFFSCREEN_ACCEPT_ANSWER":
            await peer.acceptAnswer(message.payload.description);
            for (const candidate of message.payload.candidates || []) {
              await peer.addRemoteCandidate(candidate);
            }
            sendResponse({ ok: true });
            break;
          case "OFFSCREEN_SEND_ENVELOPE":
            sendResponse({ ok: peer.send(message.payload.envelope) });
            break;
          default:
            sendResponse({ ok: false, error: "未知 offscreen 命令" });
            break;
        }
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  });
})();
