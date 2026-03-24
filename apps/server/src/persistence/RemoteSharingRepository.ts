/**
 * RemoteSharingRepository - Durable persistence for remote session sharing state.
 *
 * Replaces the in-memory Set<string> with SQLite-backed storage so that
 * remote-sharing state survives server restarts.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { Effect, ServiceMap } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";

export interface RemoteSharingRepositoryShape {
  /** Mark a thread as shared or unshared remotely. */
  readonly setSharing: (threadId: string, shared: boolean) => Effect.Effect<void, SqlError>;

  /** Check if a thread is currently shared remotely. */
  readonly isShared: (threadId: string) => Effect.Effect<boolean, SqlError>;

  /** Get all thread IDs that are currently shared remotely. */
  readonly getAllSharedThreadIds: () => Effect.Effect<ReadonlySet<string>, SqlError>;

  /** Remove sharing state for a deleted thread. */
  readonly removeThread: (threadId: string) => Effect.Effect<void, SqlError>;
}

export class RemoteSharingRepository extends ServiceMap.Service<
  RemoteSharingRepository,
  RemoteSharingRepositoryShape
>()("t3/persistence/RemoteSharingRepository") {}

/**
 * Live implementation backed by SQLite.
 */
export const RemoteSharingRepositoryLive = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const setSharing = (threadId: string, shared: boolean) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      if (shared) {
        yield* sql`
          INSERT INTO projection_thread_remote_sharing (thread_id, shared_remotely, updated_at)
          VALUES (${threadId}, 1, ${now})
          ON CONFLICT(thread_id) DO UPDATE SET shared_remotely = 1, updated_at = ${now}
        `;
      } else {
        yield* sql`
          UPDATE projection_thread_remote_sharing
          SET shared_remotely = 0, updated_at = ${now}
          WHERE thread_id = ${threadId}
        `;
      }
    });

  const isShared = (threadId: string) =>
    Effect.gen(function* () {
      const rows = yield* sql`
        SELECT shared_remotely FROM projection_thread_remote_sharing
        WHERE thread_id = ${threadId} AND shared_remotely = 1
      `;
      return rows.length > 0;
    });

  const getAllSharedThreadIds = () =>
    Effect.gen(function* () {
      const rows = yield* sql`
        SELECT thread_id FROM projection_thread_remote_sharing
        WHERE shared_remotely = 1
      `;
      return new Set(rows.map((r: any) => r.thread_id as string));
    });

  const removeThread = (threadId: string) =>
    sql`DELETE FROM projection_thread_remote_sharing WHERE thread_id = ${threadId}`.pipe(
      Effect.asVoid,
    );

  return {
    setSharing,
    isShared,
    getAllSharedThreadIds,
    removeThread,
  } satisfies RemoteSharingRepositoryShape;
});
