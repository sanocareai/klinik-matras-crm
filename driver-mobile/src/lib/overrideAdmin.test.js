// Penanda "Siap Kirim — override Admin" di app Driver (16 Okt 2026). Keputusan Admin, BUKAN klaim pemeriksaan/QC. Pola proyek: fungsi murni lewat node:test; kontrak tampilan lewat text-scan sumber.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { overrideAdminInfo } from "./jobHelpers.js";

test("overrideAdminInfo: job biasa / server lama tanpa field → null (tampilan lama utuh)", () => {
  for (const j of [null, undefined, {}, { overrideAdmin: [] }, { overrideAdmin: null }, { overrideAdmin: [{ unitId: "x" }] }, { overrideAdmin: "x" }]) assert.equal(overrideAdminInfo(j), null, JSON.stringify(j));
});

test("overrideAdminInfo: judul jujur + satu baris per unit dengan lokasi pengambilan; lokasi kosong tidak ditebak", () => {
  const r = overrideAdminInfo({ overrideAdmin: [
    { unitId: "u1", unitCode: "RES-1-U1", pickupLocationCode: "FG-01" },
    { unitId: "u2", unitCode: "RES-1-U2", pickupLocationCode: null },
  ] });
  assert.equal(r.judul, "Siap Kirim — override Admin (pencatatan produksi belum selesai)");
  assert.deepEqual(r.baris, [{ kunci: "u1", teks: "RES-1-U1: ambil di FG-01" }, { kunci: "u2", teks: "RES-1-U2: ambil di lokasi belum tercatat" }]);
});

test("overrideAdminInfo: tidak pernah mengklaim pemeriksaan fisik atau QC", () => {
  const r = overrideAdminInfo({ overrideAdmin: [{ unitId: "u1", unitCode: "A-U1", pickupLocationCode: "FG-01" }] });
  assert.doesNotMatch(JSON.stringify(r), /diperiksa|pemeriksa|QC lulus|lulus QC|inspeksi/i);
});

test("JobCard memakai overrideAdminInfo (banner override-admin-banner) dan tidak memuat klaim pemeriksaan", () => {
  const src = fs.readFileSync(new URL("../components/JobCard.js", import.meta.url), "utf8");
  assert.match(src, /overrideAdminInfo\(job\)/); assert.match(src, /testID="override-admin-banner"/); assert.match(src, /overrideInfo\.baris\.map/);
  const blok = src.slice(src.indexOf("override-admin-banner") - 250, src.indexOf("override-admin-banner") + 600);
  assert.doesNotMatch(blok, /diperiksa|pemeriksa|QC lulus/i);
});
