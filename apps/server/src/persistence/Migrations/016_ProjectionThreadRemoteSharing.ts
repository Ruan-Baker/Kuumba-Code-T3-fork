import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_remote_sharing (
      thread_id TEXT PRIMARY KEY,
      shared_remotely INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS remote_command_receipts (
      command_id TEXT PRIMARY KEY,
      client_instance_id TEXT NOT NULL,
      result_json TEXT,
      issued_at TEXT NOT NULL,
      completed_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_remote_command_receipts_client_issued
    ON remote_command_receipts(client_instance_id, issued_at)
  `;
});
