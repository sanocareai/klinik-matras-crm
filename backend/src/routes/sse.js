import express from "express";
import jwt from "jsonwebtoken";

export const sseRouter = express.Router();

// Map clientId → { res, userId } — semua client yang sedang terkoneksi
const clients = new Map();
let clientCounter = 0;

// Kirim event ke semua client yang terkoneksi
export function broadcast(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, client] of clients) {
    try {
      client.res.write(payload);
    } catch {
      // Client sudah disconnect, abaikan
    }
  }
}

// GET /api/events?token=xxx
// EventSource tidak mendukung Authorization header, jadi token dikirim via query param
sseRouter.get("/", (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).end();

  let userId;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    userId = decoded.id;
  } catch {
    return res.status(401).end();
  }

  // SSE headers — X-Accel-Buffering: no penting agar Nginx tidak buffer event
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const clientId = ++clientCounter;
  clients.set(clientId, { res, userId });

  // Heartbeat tiap 30s — cegah proxy/load-balancer putuskan koneksi idle
  const heartbeat = setInterval(() => {
    try { res.write(":keep-alive\n\n"); } catch {}
  }, 30000);

  // Bersihkan saat client disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(clientId);
  });
});
