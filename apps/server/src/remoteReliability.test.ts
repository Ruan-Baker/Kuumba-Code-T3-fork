/**
 * Remote Reliability Tests
 *
 * Tests for the durable remote session features:
 * - Durable remote sharing persistence (Phase B)
 * - Command receipt deduplication (Phase E)
 * - Presence state transitions (Phase A)
 */
import { describe, it, expect } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite";
import {
  RemoteSharingRepository,
  RemoteSharingRepositoryLive,
} from "./persistence/RemoteSharingRepository";
import {
  RemoteCommandReceiptRepository,
  RemoteCommandReceiptRepositoryLive,
  type CommandReceipt,
} from "./persistence/RemoteCommandReceiptRepository";

// ── Test Layers ─────────────────────────────────────────────────────

const RemoteSharingRepoLayer = Layer.effect(
  RemoteSharingRepository,
  RemoteSharingRepositoryLive,
);

const RemoteCommandReceiptRepoLayer = Layer.effect(
  RemoteCommandReceiptRepository,
  RemoteCommandReceiptRepositoryLive,
);

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(RemoteSharingRepoLayer),
  Layer.provideMerge(RemoteCommandReceiptRepoLayer),
  Layer.provideMerge(SqlitePersistenceMemory),
);

function runTest<A, E>(effect: Effect.Effect<A, E, RemoteSharingRepository | RemoteCommandReceiptRepository>) {
  return Effect.runPromise(effect.pipe(Effect.provide(TestLayer), Effect.orDie));
}

// ── Durable Remote Sharing ──────────────────────────────────────────

describe("RemoteSharingRepository", () => {
  it("stores and retrieves sharing state", () =>
    runTest(
      Effect.gen(function* () {
        const repo = yield* RemoteSharingRepository;

        // Initially not shared
        const before = yield* repo.isShared("thread-1");
        expect(before).toBe(false);

        // Share it
        yield* repo.setSharing("thread-1", true);
        const after = yield* repo.isShared("thread-1");
        expect(after).toBe(true);

        // Unshare it
        yield* repo.setSharing("thread-1", false);
        const unshared = yield* repo.isShared("thread-1");
        expect(unshared).toBe(false);
      }),
    ));

  it("returns all shared thread IDs", () =>
    runTest(
      Effect.gen(function* () {
        const repo = yield* RemoteSharingRepository;

        yield* repo.setSharing("thread-a", true);
        yield* repo.setSharing("thread-b", true);
        yield* repo.setSharing("thread-c", false);

        const shared = yield* repo.getAllSharedThreadIds();
        expect(shared.has("thread-a")).toBe(true);
        expect(shared.has("thread-b")).toBe(true);
        expect(shared.has("thread-c")).toBe(false);
        expect(shared.size).toBe(2);
      }),
    ));

  it("handles toggle sharing on same thread idempotently", () =>
    runTest(
      Effect.gen(function* () {
        const repo = yield* RemoteSharingRepository;

        // Share twice — should not fail
        yield* repo.setSharing("thread-x", true);
        yield* repo.setSharing("thread-x", true);
        const shared = yield* repo.isShared("thread-x");
        expect(shared).toBe(true);

        // Unshare twice — should not fail
        yield* repo.setSharing("thread-x", false);
        yield* repo.setSharing("thread-x", false);
        const unshared = yield* repo.isShared("thread-x");
        expect(unshared).toBe(false);
      }),
    ));

  it("removes sharing state for deleted threads", () =>
    runTest(
      Effect.gen(function* () {
        const repo = yield* RemoteSharingRepository;

        yield* repo.setSharing("thread-del", true);
        expect(yield* repo.isShared("thread-del")).toBe(true);

        yield* repo.removeThread("thread-del");
        expect(yield* repo.isShared("thread-del")).toBe(false);

        const allShared = yield* repo.getAllSharedThreadIds();
        expect(allShared.has("thread-del")).toBe(false);
      }),
    ));

  it("persists sharing state across separate reads", () =>
    runTest(
      Effect.gen(function* () {
        const repo = yield* RemoteSharingRepository;

        // Set sharing
        yield* repo.setSharing("persistent-thread", true);

        // Read back in a separate call
        const allShared = yield* repo.getAllSharedThreadIds();
        expect(allShared.has("persistent-thread")).toBe(true);

        // Individual check
        const isShared = yield* repo.isShared("persistent-thread");
        expect(isShared).toBe(true);
      }),
    ));
});

// ── Command Receipt Deduplication ───────────────────────────────────

describe("RemoteCommandReceiptRepository", () => {
  it("stores and retrieves a command receipt", () =>
    runTest(
      Effect.gen(function* () {
        const repo = yield* RemoteCommandReceiptRepository;

        const receipt: CommandReceipt = {
          commandId: "cmd-1",
          clientInstanceId: "client-a",
          resultJson: JSON.stringify({ success: true }),
          issuedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };

        yield* repo.storeReceipt(receipt);

        const found = yield* repo.findReceipt("cmd-1");
        expect(found).not.toBeNull();
        expect(found!.commandId).toBe("cmd-1");
        expect(found!.clientInstanceId).toBe("client-a");
        expect(found!.resultJson).toBe(JSON.stringify({ success: true }));
      }),
    ));

  it("returns null for unknown command IDs", () =>
    runTest(
      Effect.gen(function* () {
        const repo = yield* RemoteCommandReceiptRepository;
        const found = yield* repo.findReceipt("nonexistent");
        expect(found).toBeNull();
      }),
    ));

  it("does not overwrite existing receipt on conflict", () =>
    runTest(
      Effect.gen(function* () {
        const repo = yield* RemoteCommandReceiptRepository;

        const receipt1: CommandReceipt = {
          commandId: "cmd-dup",
          clientInstanceId: "client-a",
          resultJson: JSON.stringify({ attempt: 1 }),
          issuedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };

        const receipt2: CommandReceipt = {
          commandId: "cmd-dup",
          clientInstanceId: "client-a",
          resultJson: JSON.stringify({ attempt: 2 }),
          issuedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };

        yield* repo.storeReceipt(receipt1);
        yield* repo.storeReceipt(receipt2); // Should be ignored (ON CONFLICT DO NOTHING)

        const found = yield* repo.findReceipt("cmd-dup");
        expect(found).not.toBeNull();
        expect(found!.resultJson).toBe(JSON.stringify({ attempt: 1 }));
      }),
    ));

  it("prunes old receipts", () =>
    runTest(
      Effect.gen(function* () {
        const repo = yield* RemoteCommandReceiptRepository;

        const oldReceipt: CommandReceipt = {
          commandId: "cmd-old",
          clientInstanceId: "client-a",
          resultJson: null,
          issuedAt: new Date(Date.now() - 86_400_000).toISOString(), // 24h ago
          completedAt: new Date(Date.now() - 86_400_000).toISOString(),
        };

        const recentReceipt: CommandReceipt = {
          commandId: "cmd-recent",
          clientInstanceId: "client-a",
          resultJson: null,
          issuedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };

        yield* repo.storeReceipt(oldReceipt);
        yield* repo.storeReceipt(recentReceipt);

        // Prune anything older than 1 hour
        yield* repo.pruneOlderThan(3_600_000);

        const oldFound = yield* repo.findReceipt("cmd-old");
        expect(oldFound).toBeNull();

        const recentFound = yield* repo.findReceipt("cmd-recent");
        expect(recentFound).not.toBeNull();
      }),
    ));

  it("handles null result_json", () =>
    runTest(
      Effect.gen(function* () {
        const repo = yield* RemoteCommandReceiptRepository;

        const receipt: CommandReceipt = {
          commandId: "cmd-void",
          clientInstanceId: "client-b",
          resultJson: null,
          issuedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        };

        yield* repo.storeReceipt(receipt);
        const found = yield* repo.findReceipt("cmd-void");
        expect(found).not.toBeNull();
        expect(found!.resultJson).toBeNull();
      }),
    ));
});
