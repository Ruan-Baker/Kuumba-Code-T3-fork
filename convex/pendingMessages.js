/**
 * Convex functions for offline message queuing.
 * When the relay forwards a message but the target device is offline,
 * the message is stored here. When the target reconnects, messages are drained.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
/** Queue a message for an offline device. */
export const enqueue = mutation({
    args: {
        targetDeviceId: v.string(),
        fromDeviceId: v.string(),
        payloadJson: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("pendingMessages", {
            ...args,
            createdAt: Date.now(),
        });
    },
});
/** Get all pending messages for a device (called when device reconnects). */
export const drain = mutation({
    args: { targetDeviceId: v.string() },
    handler: async (ctx, args) => {
        const messages = await ctx.db
            .query("pendingMessages")
            .withIndex("by_target", (q) => q.eq("targetDeviceId", args.targetDeviceId))
            .collect();
        // Delete all drained messages
        for (const msg of messages) {
            await ctx.db.delete(msg._id);
        }
        return messages;
    },
});
/** Get pending message count for a device (diagnostic). */
export const countPending = query({
    args: { targetDeviceId: v.string() },
    handler: async (ctx, args) => {
        const messages = await ctx.db
            .query("pendingMessages")
            .withIndex("by_target", (q) => q.eq("targetDeviceId", args.targetDeviceId))
            .collect();
        return messages.length;
    },
});
/** Clean up old pending messages (older than 24 hours). */
export const cleanup = mutation({
    args: {},
    handler: async (ctx) => {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const old = await ctx.db
            .query("pendingMessages")
            .filter((q) => q.lt(q.field("createdAt"), cutoff))
            .collect();
        for (const msg of old) {
            await ctx.db.delete(msg._id);
        }
        return old.length;
    },
});
