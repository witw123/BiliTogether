const test = require("node:test");
const assert = require("node:assert/strict");

const constants = require("../src/shared/constants.js");
const utils = require("../src/shared/utils.js");
const session = require("../src/shared/session.js");

test("room code normalization and host peer id stay stable", () => {
  assert.equal(utils.normalizeRoomCode(" bt-7x 9k "), "BT7X9K");
  assert.equal(session.buildHostPeerId("BT7X9K"), "bt_BT7X9K");
});

test("transport status reducer keeps room metadata", () => {
  const initial = session.createInitialState({ peerId: "peer_self", nickname: "self" });
  const hosting = session.reduceSessionState(initial, {
    type: "TRANSPORT_STATUS_CHANGED",
    status: {
      phase: constants.CONNECTION_PHASES.HOSTING,
      roomCode: "BT7X9K",
      hostPeerId: "bt_BT7X9K",
      role: "host",
      localPeerId: "bt_BT7X9K",
      lastEventAt: 1
    }
  });

  assert.equal(hosting.transport.phase, constants.CONNECTION_PHASES.HOSTING);
  assert.equal(hosting.room.code, "BT7X9K");
  assert.equal(hosting.room.role, "host");
  assert.equal(hosting.transport.localPeerId, "bt_BT7X9K");
});

test("older remote playback events are ignored", () => {
  const initial = session.createInitialState({ peerId: "peer_self", nickname: "self" });
  const local = session.reduceSessionState(initial, {
    type: "LOCAL_ENVELOPE_CREATED",
    envelope: {
      id: "evt_new",
      kind: constants.ROOM_EVENT_TYPES.SYNC_SEEK,
      senderId: "peer_self",
      senderNickname: "self",
      timestamp: 200,
      data: {
        playbackState: {
          currentTime: 42,
          isPlaying: true,
          playbackRate: 1
        }
      }
    }
  });

  const remote = session.reduceSessionState(local, {
    type: "REMOTE_ENVELOPE_RECEIVED",
    envelope: {
      id: "evt_old",
      kind: constants.ROOM_EVENT_TYPES.SYNC_SEEK,
      senderId: "peer_remote",
      senderNickname: "remote",
      timestamp: 100,
      data: {
        playbackState: {
          currentTime: 12,
          isPlaying: false,
          playbackRate: 1
        }
      }
    }
  });

  assert.equal(remote.media.playbackState.currentTime, 42);
  assert.equal(remote.media.lastControlId, "evt_new");
});

test("state snapshot merges playback state and trims chat history", () => {
  const initial = session.createInitialState({ peerId: "peer_self", nickname: "self" });
  const remote = session.reduceSessionState(initial, {
    type: "REMOTE_ENVELOPE_RECEIVED",
    envelope: {
      id: "evt_snapshot",
      kind: constants.ROOM_EVENT_TYPES.STATE_SNAPSHOT,
      senderId: "peer_host",
      senderNickname: "host",
      timestamp: 300,
      data: {
        videoIdentity: { key: "video:BV1:test", url: "https://www.bilibili.com/video/BV1" },
        playbackState: {
          currentTime: 18,
          isPlaying: true,
          playbackRate: 1.25
        },
        lastControlTimestamp: 290,
        lastControlId: "evt_control",
        chatMessages: Array.from({ length: constants.CHAT_HISTORY_LIMIT + 5 }, (_, index) => ({
          id: `msg_${index}`,
          senderId: "peer_host",
          senderNickname: "host",
          text: `message-${index}`,
          timestamp: index
        }))
      }
    }
  });

  assert.equal(remote.media.videoIdentity.key, "video:BV1:test");
  assert.equal(remote.media.playbackState.playbackRate, 1.25);
  assert.equal(remote.chat.messages.length, constants.CHAT_HISTORY_LIMIT);
  assert.equal(remote.chat.messages[0].id, "msg_5");
});
