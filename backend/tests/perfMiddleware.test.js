import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import compression from "compression";
import sharp from "sharp";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { thumbnailMiddleware } from "../src/middleware/thumbnails.js";

async function withServer(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thumbs-"));
  fs.writeFileSync(path.join(dir, "secret.txt"), "rahasia");
  // Foto "kamera" 3000x2000 penuh noise supaya jelas jauh lebih besar dari thumbnail.
  const raw = Buffer.alloc(3000 * 2000 * 3); for (let i = 0; i < raw.length; i += 7) raw[i] = (i * 13) & 255;
  await sharp(raw, { raw: { width: 3000, height: 2000, channels: 3 } }).jpeg({ quality: 85 }).toFile(path.join(dir, "foto.jpg"));

  const app = express();
  // Sama dengan konfigurasi di src/index.js
  app.use(compression({ filter: (req, res) => (req.path.startsWith("/api/events") ? false : compression.filter(req, res) ) }));
  app.get("/api/big", (_q, r) => r.json({ data: "x".repeat(20000) }));
  app.get("/api/events", (_q, r) => { r.type("text/event-stream").send("data: " + "y".repeat(5000) + "\n\n"); });
  app.use("/uploads", thumbnailMiddleware(dir));
  app.use("/uploads", express.static(dir));
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base, dir); } finally { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

// fetch() otomatis mendekompres; pakai http mentah agar header content-encoding terlihat.
import http from "node:http";
const raw = (url, headers = {}) => new Promise((res, rej) => http.get(url, { headers }, (r) => {
  const chunks = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
}).on("error", rej));

test("JSON API dikompres gzip; ukuran di jaringan jauh lebih kecil", () => withServer(async (base) => {
  const r = await raw(base + "/api/big", { "Accept-Encoding": "gzip" });
  assert.equal(r.headers["content-encoding"], "gzip");
  assert.ok(r.body.length < 1000, `wire=${r.body.length}`);
}));

test("SSE (/api/events) TIDAK dikompres", () => withServer(async (base) => {
  const r = await raw(base + "/api/events", { "Accept-Encoding": "gzip" });
  assert.equal(r.headers["content-encoding"], undefined);
}));

test("thumbnail ?w=480 → WebP kecil, jauh lebih ringan dari file asli, di-cache", () => withServer(async (base, dir) => {
  const orig = fs.statSync(path.join(dir, "foto.jpg")).size;
  const t = await raw(base + "/uploads/foto.jpg?w=480");
  assert.equal(t.status, 200);
  assert.equal(t.headers["content-type"], "image/webp");
  assert.ok(t.body.length < orig / 5, `thumb=${t.body.length} orig=${orig}`);
  const meta = await sharp(t.body).metadata();
  assert.equal(meta.width, 480);
  const again = await raw(base + "/uploads/foto.jpg?w=480");
  assert.equal(again.body.length, t.body.length);
  assert.equal(fs.readdirSync(path.join(dir, ".thumbs")).filter((f) => f.endsWith(".webp")).length, 1);
}));

test("tanpa ?w atau lebar tidak diizinkan → file asli dilayani apa adanya", () => withServer(async (base, dir) => {
  const orig = fs.statSync(path.join(dir, "foto.jpg")).size;
  assert.equal((await raw(base + "/uploads/foto.jpg")).body.length, orig);
  assert.equal((await raw(base + "/uploads/foto.jpg?w=99999")).body.length, orig);
}));

test("path traversal & non-gambar tidak menghasilkan thumbnail", () => withServer(async (base) => {
  const a = await raw(base + "/uploads/..%2fsecret.txt?w=480");
  assert.notEqual(a.headers["content-type"], "image/webp");
  const b = await raw(base + "/uploads/secret.txt?w=480");
  assert.notEqual(b.headers["content-type"], "image/webp");
  assert.equal((await raw(base + "/uploads/tidak-ada.jpg?w=480")).status, 404);
}));
