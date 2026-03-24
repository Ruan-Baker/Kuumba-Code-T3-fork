/**
 * RemoteCommandReceiptRepository - Idempotent command receipt storage.
 *
 * Ensures remote commands are deduplicated: if a client retries a command
 * (e.g. after reconnect), the server returns the prior result instead of
 * re-executing the command.
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { Effect, ServiceMap } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";

export interface CommandReceipt {
  readonly commandId: string;
  readonly clientInstanceId: string;
  readonly resultJson: string | null;
  readonly issuedAt: string;
  readonly completedAt: string;
}

export interface RemoteCommandReceiptRepositoryShape {
  /** Look up a prior receipt for the given command id. Returns null if not found. */
  readonly findReceipt: (commandId: string) => Effect.Effect<CommandReceipt | null, SqlError>;

  /** Store a receipt for a completed command. */
  readonly storeReceipt: (receipt: CommandReceipt) => Effect.Effect<void, SqlError>;

  /** Prune old receipts older than the given age in milliseconds. */
  readonly pruneOlderThan: (maxAgeMs: number) => Effect.Effect<number, SqlError>;
}

export class RemoteCommandReceiptRepository extends ServiceMap.Service<
  RemoteCommandReceiptRepository,
  RemoteCommandReceiptRepositoryShape
>()("t3/persistence/RemoteCommandReceiptRepository") {}

/**
 * Live implementation backed by SQLite.
 */
export const RemoteCommandReceiptRepositoryLive = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const findReceipt = (commandId: string) =>
    Effect.gen(function* () {
      const rows = yield* sql`
        SELECT command_id, client_instance_id, result_json, issued_at, completed_at
        FROM remote_command_receipts
        WHERE command_id = ${commandId}
        LIMIT 1
      `;
      if (rows.length === 0) return null;
      const row = rows[0]!;
      return {
        commandId: row.command_id as string,
        clientInstanceId: row.client_instance_id as string,
        resultJson: (row.result_json as string | null) ?? null,
        issuedAt: row.issued_at as string,
        completedAt: row.completed_at as string,
      } satisfies CommandReceipt;
    });

  const storeReceipt = (receipt: CommandReceipt) =>
    sql`
      INSERT INTO remote_command_receipts (command_id, client_instance_id, result_json, issued_at, completed_at)
      VALUES (${receipt.commandId}, ${receipt.clientInstanceId}, ${receipt.resultJson}, ${receipt.issuedAt}, ${receipt.completedAt})
      ON CONFLICT(command_id) DO NOTHING
    `.pipe(Effect.asVoid);

  const pruneOlderThan = (maxAgeMs: number) =>
    Effect.gen(function* () {
      const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
      const result = yield* sql`
        DELETE FROM remote_command_receipts
        WHERE completed_at < ${cutoff}
      `;
      return (result as any).changes ?? 0;
    });

  return {
    findReceipt,
    storeReceipt,
    pruneOlderThan,
  } satisfies RemoteCommandReceiptRepositoryShape;
});
