import test from "node:test";
import assert from "node:assert/strict";
import { bentukProfil, inisial, kedaluwarsaToken, labelDivisi, labelPeran, perubahanProfil, validasiProfil } from "./lib/profil.js";

test("label peran & divisi Indonesia dengan cadangan aman", () => {
  assert.equal(labelPeran("LEADER_DRIVER"), "Leader Driver");
  assert.equal(labelPeran("ACCOUNTANT"), "Akuntan");
  assert.equal(labelPeran("PERAN_BARU"), "Peran Baru");
  assert.equal(labelDivisi("DIGITAL_TECHNOLOGY"), "Digital & Technology");
  assert.equal(labelDivisi("HRGA"), "HR & GA");
  assert.equal(labelDivisi(undefined), "-");
  assert.equal(inisial("Rudy Admin Besar"), "RA");
  assert.equal(inisial(""), "?");
});

test("bentukProfil menggabungkan /auth/me dan /users/me tanpa mengarang field (HP tidak ada di server)", () => {
  const p = bentukProfil(
    { id: "u1", name: "Rudy", role: "ADMIN", roles: ["ADMIN", "OWNER"], divisions: ["DELIVERY"], avatarUrl: "/uploads/avatars/a.png" },
    { id: "u1", email: "rudy@sano.id", createdAt: "2026-01-01T00:00:00Z" },
  );
  assert.deepEqual(p, { id: "u1", nama: "Rudy", email: "rudy@sano.id", roles: ["ADMIN", "OWNER"], divisi: ["DELIVERY"], avatarUrl: "/uploads/avatars/a.png", bergabung: "2026-01-01T00:00:00Z" });
  assert.equal("phone" in p, false);
  assert.deepEqual(bentukProfil({ role: "DRIVER" }, null).roles, ["DRIVER"]);
  assert.deepEqual(bentukProfil(null, null).divisi, []);
});

test("validasi & perubahan profil: hanya field berubah yang dikirim", () => {
  assert.equal(validasiProfil({ nama: "A", email: "a@b.co" }).ok, true);
  assert.ok(validasiProfil({ nama: " ", email: "a@b.co" }).errors.nama);
  assert.ok(validasiProfil({ nama: "A", email: "bukan-email" }).errors.email);
  assert.ok(validasiProfil({ nama: "A", email: "" }).errors.email);
  const asli = { nama: "Rudy", email: "rudy@sano.id" };
  assert.deepEqual(perubahanProfil(asli, { nama: "Rudy", email: "RUDY@sano.id " }), {});
  assert.deepEqual(perubahanProfil(asli, { nama: " Rudy Baru ", email: "rudy@sano.id" }), { name: "Rudy Baru" });
  assert.deepEqual(perubahanProfil(asli, { nama: "Rudy", email: "Baru@Sano.id" }), { email: "baru@sano.id" });
});

test("kedaluwarsaToken membaca exp JWT; token rusak = null", () => {
  const payload = Buffer.from(JSON.stringify({ id: "u1", exp: 1790000000 })).toString("base64url");
  assert.equal(kedaluwarsaToken(`aaa.${payload}.zzz`), 1790000000 * 1000);
  assert.equal(kedaluwarsaToken("bukan-jwt"), null);
  assert.equal(kedaluwarsaToken(null), null);
  assert.equal(kedaluwarsaToken(`aaa.${Buffer.from("{}").toString("base64url")}.zzz`), null);
});
