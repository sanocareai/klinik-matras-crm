// Mock CRM API + static server untuk profiling (data sintetis, tanpa data pelanggan).
// Pakai: node mock-server.cjs <distDir> <port>
const path = require("path");
const BACKEND = require("path").join(__dirname, "../../backend/node_modules");
const express = require(BACKEND + "/express");
const http = require("http");
const { Server } = require(BACKEND + "/socket.io");
const sharp = require(BACKEND + "/sharp");
const zlib = require("zlib");

const dist = process.argv[2];
const port = Number(process.argv[3] || 5199);
const app = express();
app.use(express.json());

const NOW = Date.now();
const WORDS = "halo kak kasur springbed ukuran 160 x 200 harga promo bisa cod kirim hari ini alamat jakarta selatan terima kasih baik siap order dp transfer".split(" ");
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const sentence = (n) => Array.from({ length: n }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(" ");

const convs = Array.from({ length: 100 }, (_, i) => {
  const last = NOW - i * 7 * 60000;
  return {
    id: `c${i}`, type: "INDIVIDUAL", channel: "WHATSAPP", status: "OPEN", pinned: false, pinnedAt: null,
    unread: i % 5 === 0, unreadCount: i % 5 === 0 ? 2 : 0, isRead: i % 5 !== 0, isUnanswered: i % 3 === 0,
    unansweredMinutes: i % 3 === 0 ? i * 7 : null, canTakeOver: false, assignedToId: "u1", sessionId: "s1",
    lastMessageAt: new Date(last).toISOString(), lastMessagePreview: sentence(6),
    customerId: `cu${i}`,
    customer: { id: `cu${i}`, name: `Pelanggan ${i} ${sentence(1)}`, phone: `62812000${String(i).padStart(4, "0")}`, tags: [], avatarUrl: null },
    assignedTo: { id: "u1", name: "Tester", avatarUrl: null },
    messages: [{ id: `lm${i}`, content: sentence(8), direction: i % 3 === 0 ? "INBOUND" : "OUTBOUND", createdAt: new Date(last).toISOString(), ack: 3 }],
  };
});
// c0 = percakapan panjang (3000 pesan, sebagian media)
const LONG = 3000;
const msgsByConv = {};
function genMsgs(cid, n) {
  return Array.from({ length: n }, (_, k) => {
    const isMedia = k % 40 === 7;
    return {
      id: `${cid}-m${String(k).padStart(5, "0")}`, conversationId: cid, direction: k % 2 ? "OUTBOUND" : "INBOUND",
      content: isMedia ? "" : sentence(4 + Math.floor(rnd() * 25)),
      createdAt: new Date(NOW - (n - k) * 90000).toISOString(), ack: 3, externalId: `wa-${cid}-${k}`,
      mediaType: isMedia ? "image" : null, mediaUrl: isMedia ? `/uploads/img${k % 6}.jpg` : null, senderName: null,
    };
  });
}
convs.forEach((c, i) => { msgsByConv[c.id] = genMsgs(c.id, i === 0 ? LONG : 200); });

const unknown = new Set();
const stats = { requests: [] };
app.use((req, _res, next) => { if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) stats.requests.push(req.method + " " + req.path); next(); });
app.get("/__stats", (_q, r) => r.json({ count: stats.requests.length, requests: stats.requests, unknown: [...unknown] }));
app.post("/__stats/reset", (_q, r) => { stats.requests.length = 0; r.json({}); });

const imgCache = {};
app.get("/uploads/:n.jpg", async (req, res) => {
  // Foto resolusi penuh sintetis (4000x3000, noise) — mensimulasikan foto kamera HP
  const n = req.params.n;
  if (!imgCache[n]) {
    const w = 4000, h = 3000;
    const buf = Buffer.alloc(w * h * 3); for (let i = 0; i < buf.length; i += 97) buf[i] = (i * 31) & 255;
    imgCache[n] = await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).blur(0.6).jpeg({ quality: 82 }).toBuffer();
  }
  res.type("jpeg").send(imgCache[n]);
});

const api = express.Router();
api.get("/conversations/unread-count", (_q, r) => r.json({ count: 5 }));
api.get("/conversations/latest-unread", (_q, r) => r.json({ count: 5, latest: null }));
api.get("/conversations/counts", (_q, r) => r.json({}));
api.get("/conversations", (q, r) => r.json({ data: convs, nextCursor: null }));
api.get("/conversations/:id/messages", (q, r) => {
  const all = msgsByConv[q.params.id] || [];
  const limit = parseInt(q.query.limit, 10) || 0;
  if (!limit) return r.json(all);
  let end = all.length;
  if (q.query.before) end = all.findIndex((m) => m.id === q.query.before);
  if (end < 0) end = all.length;
  r.json(all.slice(Math.max(0, end - limit), end));
});
api.get("/conversations/:id/participants", (_q, r) => r.json([]));
api.get("/conversations/:id/handover-history", (_q, r) => r.json([]));
api.get("/conversations/:id", (q, r) => r.json(convs.find((c) => c.id === q.params.id) || {}));
api.post("/conversations/:id/read", (_q, r) => r.json({}));
api.post("/conversations/:id/messages", (q, r) => {
  const m = { id: `${q.params.id}-new${Date.now()}`, conversationId: q.params.id, direction: "OUTBOUND", content: q.body.content, createdAt: new Date().toISOString(), ack: 1, clientId: q.body.clientId, externalId: null };
  (msgsByConv[q.params.id] ||= []).push(m);
  setTimeout(() => io.to(`conv:${q.params.id}`).emit("message:new", m), 30);
  r.json(m);
});
api.get("/customers/:id", (q, r) => r.json({ id: q.params.id, name: "Pelanggan", phone: "62812000", tags: [], orders: [], notes: [], activities: [] }));
api.get("/users", (_q, r) => r.json([{ id: "u1", name: "Tester", role: "SALES" }]));
api.use((q, r) => { unknown.add(q.method + " " + q.path); r.json(q.method === "GET" ? [] : {}); });
app.use("/api", api);

const gz = (req, res, next) => next(); // kompresi diuji terpisah di produksi; lokal tanpa
app.use(gz, express.static(dist, { index: false }));
app.get("*", (_q, r) => r.sendFile(path.join(dist, "index.html")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
io.on("connection", (s) => { s.on("join", (c) => s.join(`conv:${c}`)); s.on("leave", (c) => s.leave(`conv:${c}`)); });
// Dorong pesan masuk untuk konv tertentu: POST /__push/:id
app.post("/__push/:id", (q, r) => {
  const id = q.params.id;
  const m = { id: `${id}-in${Date.now()}${Math.random()}`, conversationId: id, direction: "INBOUND", content: sentence(6), createdAt: new Date().toISOString(), ack: 3 };
  (msgsByConv[id] ||= []).push(m);
  const c = convs.find((x) => x.id === id);
  io.to(`conv:${id}`).emit("message:new", m);
  io.emit("conversation:update", { id, lastMessagePreview: m.content, unreadCount: 1, unread: true, lastMessageAt: m.createdAt, status: "OPEN", isRead: false });
  io.emit("new_message", { conversationId: id, customerId: c?.customerId });
  r.json({});
});
server.listen(port, () => console.log("mock ready", port, dist));
