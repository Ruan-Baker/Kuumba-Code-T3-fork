import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { Relay } from "./relay.js";

const PORT = Number(process.env.RELAY_PORT ?? 4400);
const relay = new Relay();

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    const stats = relay.getStats();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", ...stats }));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    "unknown";
  relay.handleConnection(ws, ip);
});

httpServer.listen(PORT, () => {
  console.log(`[relay] Kuumba Code relay server listening on port ${PORT}`);
});
