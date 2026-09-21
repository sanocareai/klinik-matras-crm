// Foto profil dari Finance Mobile (POST /api/mobile/me/avatar): kolom User.avatarUrl SAMA dengan SANSS Hub. Token mobile tidak boleh menjangkau /api/users/*.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw, DEVICE } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";

let server; let raw;
const dibuat = [];
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.after(async () => {
  for (const f of dibuat) fs.rmSync(f, { force: true });
  await truncateAll(); await server.close(); await testPrisma.$disconnect();
});

const uploadsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../uploads");
async function png(warna) { return sharp({ create: { width: 300, height: 200, channels: 3, background: warna } }).png().toBuffer(); }
async function kirim(token, buf, mime = "image/png", nama = "foto.png") {
  const form = new FormData();
  form.append("file", new Blob([buf], { type: mime }), nama);
  const r = await fetch(`${server.baseUrl}/api/mobile/me/avatar`, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function masuk(roles) {
  const u = await createLoginUser({ roles });
  const r = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: u.password, device: DEVICE("d-avatar") } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...u, token: r.body.accessToken };
}

test("Ganti foto profil: tersimpan di User.avatarUrl (sama dengan Hub), muncul di /auth/me, foto lama dihapus", async () => {
  const u = await masuk(["FINANCE"]);
  const a = await kirim(u.token, await png("#2064b7"));
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.match(a.body.avatarUrl, /^\/uploads\/avatars\/.+\.png$/);
  const f1 = path.join(uploadsRoot, "avatars", path.basename(a.body.avatarUrl));
  dibuat.push(f1);
  assert.ok(fs.existsSync(f1), "berkas ada");
  assert.equal((await testPrisma.user.findUnique({ where: { id: u.user.id } })).avatarUrl, a.body.avatarUrl);
  assert.equal((await raw("GET", "/api/auth/me", { token: u.token })).body.avatarUrl, a.body.avatarUrl);

  await new Promise((r) => setTimeout(r, 5));
  const b = await kirim(u.token, await png("#c0392b"));
  assert.equal(b.status, 200);
  dibuat.push(path.join(uploadsRoot, "avatars", path.basename(b.body.avatarUrl)));
  assert.notEqual(b.body.avatarUrl, a.body.avatarUrl);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!fs.existsSync(f1), "foto lama dihapus");
});

test("Ditolak: tanpa login (401), bukan gambar (400), terlalu besar (400), tanpa file (400); tidak bisa mengganti foto orang lain lewat /api/users", async () => {
  const u = await masuk(["FINANCE"]);
  assert.equal((await kirim(null, await png("#000"))).status, 401);
  assert.equal((await kirim(u.token, Buffer.from("bukan gambar"), "text/plain", "x.txt")).status, 400);
  assert.equal((await kirim(u.token, Buffer.alloc(9 * 1024 * 1024, 1), "image/png", "besar.png")).status, 400);
  const form = new FormData();
  const r = await fetch(`${server.baseUrl}/api/mobile/me/avatar`, { method: "POST", headers: { Authorization: `Bearer ${u.token}` }, body: form });
  assert.equal(r.status, 400);
  const lain = await createLoginUser({ roles: ["FINANCE"] });
  const hub = await fetch(`${server.baseUrl}/api/users/${lain.user.id}/avatar`, { method: "POST", headers: { Authorization: `Bearer ${u.token}` }, body: new FormData() });
  assert.equal(hub.status, 403, "token mobile tidak berlaku untuk /api/users/*");
  assert.equal((await testPrisma.user.findUnique({ where: { id: u.user.id } })).avatarUrl, null, "tidak ada perubahan pada penolakan");
});
