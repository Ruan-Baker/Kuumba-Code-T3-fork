/**
 * Convex functions for remote thread state sync.
 * Desktop writes thread state here; mobile subscribes to it.
 * This ensures mobile always has current state even if relay messages are missed.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
/** Update the thread state for a remote session (called by desktop). */
export const upsertThreadState = mutation({
    args: {
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
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("remoteThreadState")
            .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
            .first();
        const data = { ...args, updatedAt: Date.now() };
        if (existing) {
            await ctx.db.patch(existing._id, data);
            return existing._id;
        }
        return await ctx.db.insert("remoteThreadState", data);
    },
});
/** Get the current thread state (used by mobile for initial load + subscription). */
export const getThreadState = query({
    args: { threadId: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("remoteThreadState")
            .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
            .first();
    },
});
/** Get all thread states for a specific host device. */
export const getHostThreadStates = query({
    args: { hostDeviceId: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("remoteThreadState")
            .withIndex("by_host", (q) => q.eq("hostDeviceId", args.hostDeviceId))
            .collect();
    },
});
/** Remove thread state when remote sharing is disabled. */
export const removeThreadState = mutation({
    args: { threadId: v.string() },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("remoteThreadState")
            .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
            .first();
        if (existing) {
            await ctx.db.delete(existing._id);
        }
    },
});
/** Remove all thread states for a host device (cleanup). */
export const removeHostThreadStates = mutation({
    args: { hostDeviceId: v.string() },
    handler: async (ctx, args) => {
        const states = await ctx.db
            .query("remoteThreadState")
            .withIndex("by_host", (q) => q.eq("hostDeviceId", args.hostDeviceId))
            .collect();
        for (const s of states) {
            await ctx.db.delete(s._id);
        }
    },
});
