import { describe, expect, it } from "vitest";
import { decodePacket, encodePacket, MessageType } from "../src/net/packet.js";
import type { SnapshotMessage } from "../src/net/messages/snapshot.js";
import { MAX_SNAPSHOT_PROJECTILES } from "../src/net/messages/projectiles.js";

describe("a snapshot's projectiles, sentries and radar", () => {
  it("round-trip beside a detonation", () => {
    const message: SnapshotMessage = {
      tick: 3,
      ack: 0,
      presence: null,
      players: [],
      actors: [],
      projectiles: [
        { id: 4095, kind: "semtex", position: { x: 1.5, y: 2, z: -3.25 } },
        { id: 0, kind: "flashbang", position: { x: 0, y: 0, z: 0 } },
      ],
      streaks: { package: "support", streaks: ["uav", "sam_turret", "ac130"], ready: [true, false, true], progress: 11, hardline: true },
      sentries: [{ id: 255, owner: "abc12345", position: { x: 4, y: 0, z: -1 }, yaw: 1.25, pitch: -0.1, firing: true }],
      revealed: [true, false, true],
      counters: [],
      events: [{ kind: "detonate", id: 9, what: "missile", at: { x: 10, y: 0.5, z: -4 }, by: null }],
    };
    const back = decodePacket(encodePacket(MessageType.snapshot, message)).message as SnapshotMessage;
    expect(back.projectiles).toEqual(message.projectiles);
    expect(back.streaks).toEqual(message.streaks);
    expect(back.revealed).toEqual(message.revealed);
    expect(back.sentries[0]).toMatchObject({ id: 255, owner: "abc12345", position: { x: 4, y: 0, z: -1 }, firing: true });
    expect(back.sentries[0]!.yaw).toBeCloseTo(1.25, 3);
    expect(back.events).toEqual(message.events);
  });

  it("carries at most the cap, and refuses one more", () => {
    const at = { x: 0, y: 0, z: 0 };
    const many = (n: number): SnapshotMessage => ({
      tick: 1,
      ack: 0,
      presence: null,
      players: [],
      actors: [],
      projectiles: Array.from({ length: n }, (_, id) => ({ id, kind: "frag" as const, position: at })),
      streaks: null,
      sentries: [],
      revealed: [],
      counters: [],
      events: [],
    });
    expect(() => encodePacket(MessageType.snapshot, many(MAX_SNAPSHOT_PROJECTILES))).not.toThrow();
    expect(() => encodePacket(MessageType.snapshot, many(MAX_SNAPSHOT_PROJECTILES + 1))).toThrow();
  });
});
