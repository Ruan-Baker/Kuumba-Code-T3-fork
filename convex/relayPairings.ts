/**
 * Convex functions for persistent device pairings.
 * Called by the relay server to save/load pairings that survive restarts.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/** Save a bi-directional pairing between two devices. */
export const savePairing = mutation({
  args: {
    deviceId: v.string(),
    pairedDeviceId: v.string(),
    deviceName: v.string(),
    pairedDeviceName: v.string(),
    publicKey: v.string(),
    pairedPublicKey: v.string(),
  },
  handler: async (ctx, args) => {
    // Upsert: check if this exact pairing already exists
    const existing = await ctx.db
      .query("devicePairings")
      .withIndex("by_pair", (q) =>
        q.eq("deviceId", args.deviceId).eq("pairedDeviceId", args.pairedDeviceId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        deviceName: args.deviceName,
        pairedDeviceName: args.pairedDeviceName,
        publicKey: args.publicKey,
        pairedPublicKey: args.pairedPublicKey,
      });
      return existing._id;
    }

    return await ctx.db.insert("devicePairings", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

/** Get all pairings for a specific device. */
export const getDevicePairings = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("devicePairings")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .collect();
  },
});

/** Remove a specific pairing between two devices. */
export const removePairing = mutation({
  args: {
    deviceId: v.string(),
    pairedDeviceId: v.string(),
  },
  handler: async (ctx, args) => {
    // Remove both directions
    const forward = await ctx.db
      .query("devicePairings")
      .withIndex("by_pair", (q) =>
        q.eq("deviceId", args.deviceId).eq("pairedDeviceId", args.pairedDeviceId),
      )
      .first();
    if (forward) await ctx.db.delete(forward._id);

    const reverse = await ctx.db
      .query("devicePairings")
      .withIndex("by_pair", (q) =>
        q.eq("deviceId", args.pairedDeviceId).eq("pairedDeviceId", args.deviceId),
      )
      .first();
    if (reverse) await ctx.db.delete(reverse._id);
  },
});

/** Remove all pairings for a device (used on unpair-all). */
export const removeAllDevicePairings = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const pairings = await ctx.db
      .query("devicePairings")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .collect();
    for (const p of pairings) {
      await ctx.db.delete(p._id);
    }

    // Also remove reverse references
    const reverse = await ctx.db
      .query("devicePairings")
      .withIndex("by_paired_device", (q) => q.eq("pairedDeviceId", args.deviceId))
      .collect();
    for (const p of reverse) {
      await ctx.db.delete(p._id);
    }
  },
});
