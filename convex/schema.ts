import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  /**
   * Persistent device pairings — survives relay server restarts/deploys.
   * Both directions are stored (A→B and B→A) for efficient lookups.
   */
  devicePairings: defineTable({
    deviceId: v.string(),
    pairedDeviceId: v.string(),
    deviceName: v.string(),
    pairedDeviceName: v.string(),
    publicKey: v.string(),
    pairedPublicKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_device", ["deviceId"])
    .index("by_paired_device", ["pairedDeviceId"])
    .index("by_pair", ["deviceId", "pairedDeviceId"]),

  /**
   * Thread state for remote sessions — the source of truth that mobile
   * subscribes to. Updated by the desktop whenever a shared thread changes.
   * Ensures mobile always has the current state even if relay messages are missed.
   */
  remoteThreadState: defineTable({
    threadId: v.string(),
    hostDeviceId: v.string(),
    sessionStatus: v.string(),
    title: v.string(),
    projectName: v.string(),
    projectCwd: v.string(),
    model: v.string(),
    messagesJson: v.string(),
    activitiesJson: v.string(),
    proposedPlansJson: v.string(),
    pendingApprovalsJson: v.string(),
    isStreaming: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_host", ["hostDeviceId"]),

  /**
   * Message queue for offline delivery — when device A sends to device B
   * through the relay but B is disconnected, the message is stored here.
   * When B reconnects, the relay drains and delivers these messages.
   */
  pendingMessages: defineTable({
    targetDeviceId: v.string(),
    fromDeviceId: v.string(),
    payloadJson: v.string(),
    createdAt: v.number(),
  }).index("by_target", ["targetDeviceId"]),
});
