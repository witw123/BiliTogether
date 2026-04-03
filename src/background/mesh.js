(function initPeerConnectionManager(globalScope) {
  const { STUN_SERVERS } = globalScope.BiliTogetherConstants;
  const { safeJsonParse } = globalScope.BiliTogetherUtils;

  class PeerConnectionManager {
    constructor({ onPeerMessage, onPeerState, onLocalDescription, onLocalCandidate }) {
      this.onPeerMessage = onPeerMessage;
      this.onPeerState = onPeerState;
      this.onLocalDescription = onLocalDescription;
      this.onLocalCandidate = onLocalCandidate;
      this.pc = null;
      this.channel = null;
      this.pendingCandidates = [];
    }

    reset() {
      try {
        this.channel?.close();
      } catch (error) {}
      try {
        this.pc?.close();
      } catch (error) {}
      this.pc = null;
      this.channel = null;
      this.pendingCandidates = [];
      this.onPeerState?.("idle", null);
    }

    createAsHost() {
      this.reset();
      this.pc = this.createPeerConnection();
      this.attachDataChannel(this.pc.createDataChannel("biltogether"));
    }

    createAsGuest() {
      this.reset();
      this.pc = this.createPeerConnection();
    }

    async createOffer() {
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.onLocalDescription?.(this.pc.localDescription);
      return this.pc.localDescription;
    }

    async acceptOffer(offerDescription) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(offerDescription));
      await this.flushPendingCandidates();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.onLocalDescription?.(this.pc.localDescription);
      return this.pc.localDescription;
    }

    async acceptAnswer(answerDescription) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answerDescription));
      await this.flushPendingCandidates();
    }

    async addRemoteCandidate(candidate) {
      if (!candidate) {
        return;
      }
      if (this.pc?.remoteDescription) {
        await this.pc.addIceCandidate(candidate);
      } else {
        this.pendingCandidates.push(candidate);
      }
    }

    send(eventEnvelope) {
      if (this.channel?.readyState === "open") {
        this.channel.send(JSON.stringify(eventEnvelope));
        return true;
      }
      return false;
    }

    isConnected() {
      return this.channel?.readyState === "open";
    }

    createPeerConnection() {
      const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
      pc.addEventListener("icecandidate", (event) => {
        if (event.candidate) {
          this.onLocalCandidate?.(event.candidate);
        }
      });
      pc.addEventListener("connectionstatechange", () => {
        this.onPeerState?.(pc.connectionState, null);
      });
      pc.addEventListener("datachannel", (event) => this.attachDataChannel(event.channel));
      return pc;
    }

    attachDataChannel(channel) {
      this.channel = channel;
      channel.addEventListener("open", () => this.onPeerState?.("connected", null));
      channel.addEventListener("close", () => this.onPeerState?.("closed", null));
      channel.addEventListener("message", (event) => {
        const payload = safeJsonParse(event.data, null);
        if (payload) {
          this.onPeerMessage?.(payload);
        }
      });
    }

    async flushPendingCandidates() {
      while (this.pendingCandidates.length && this.pc) {
        await this.pc.addIceCandidate(this.pendingCandidates.shift());
      }
    }
  }

  globalScope.PeerConnectionManager = PeerConnectionManager;
})(typeof globalThis !== "undefined" ? globalThis : window);
