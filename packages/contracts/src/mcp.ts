/**
 * MCP (Model Context Protocol) server configuration schemas.
 *
 * Defines the shape of user-configured MCP servers that can be
 * passed to provider adapters (Codex, Claude) at session start.
 */
import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

// ── Transport types ─────────────────────────────────────────────────

export const McpTransportKind = Schema.Literals(["stdio", "sse", "streamable-http"]);
export type McpTransportKind = typeof McpTransportKind.Type;

// ── Server config ───────────────────────────────────────────────────

export const McpServerConfig = Schema.Struct({
  /** Unique identifier for this server entry. */
  id: TrimmedNonEmptyString,
  /** Human-readable display name (e.g. "GitHub", "Filesystem"). */
  name: TrimmedNonEmptyString,
  /** Transport mechanism. */
  transport: McpTransportKind,
  /** For stdio transport: the command to spawn. */
  command: Schema.optional(Schema.String),
  /** For stdio transport: command-line arguments. */
  args: Schema.optional(Schema.Array(Schema.String)),
  /** For sse / streamable-http transport: the server URL. */
  url: Schema.optional(Schema.String),
  /** Optional environment variables passed to stdio servers. */
  env: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** Whether this server is enabled (disabled servers are not started). */
  enabled: Schema.Boolean,
});
export type McpServerConfig = typeof McpServerConfig.Type;

// ── Server runtime status ───────────────────────────────────────────

export const McpServerState = Schema.Literals(["connecting", "connected", "disconnected", "error"]);
export type McpServerState = typeof McpServerState.Type;

export const McpServerStatus = Schema.Struct({
  serverId: Schema.optional(TrimmedNonEmptyString),
  serverName: Schema.optional(TrimmedNonEmptyString),
  state: McpServerState,
  error: Schema.optional(Schema.String),
});
export type McpServerStatus = typeof McpServerStatus.Type;
