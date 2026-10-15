// Penyesuaian stok Gudang (Okt 2026): UI tidak lagi menulis ledger satu langkah; alur = pengajuan → persetujuan orang lain → posting.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hitungSelisihPengajuan, aksiPermintaan, bolehMenyetujui, bolehMenulis, ROLE_PENYETUJU, ROLE_PENULIS } from "../src/features/warehouse/penyesuaianLogic.js";
import { ROLE_PERMISSIONS, PERMISSIONS as P } from "../../backend/src/constants/permissions.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");

// Akun aktif production (dump 15 Okt 2026): role nyata, bukan asumsi.
const AKUN = {
  Gulam: ["ADMIN"], Novi: ["ADMIN"], "OWNER (Admin)": ["ADMIN"], "Yadi / Oben": ["ADMIN"],
  Natasha: ["ADMIN", "FINANCE"], Gilang: ["ADMIN", "FINANCE", "OWNER"], Juri: ["ADMIN", "FINANCE", "OWNER"], Kemal: ["ADMIN", "FINANCE", "OWNER"],
  "Nadya Marsha": ["ADMIN", "PRODUCTION_WORKER", "WAREHOUSE"],
};
const punyaIzin = (roles, izin) => roles.some((r) => (ROLE_PERMISSIONS[r] || []).includes(izin));

test("cermin UI = izin server: role penyetuju/penulis di UI sama dengan ROLE_PERMISSIONS backend untuk SEMUA role", () => {
  for (const r of Object.keys(ROLE_PERMISSIONS)) {
    assert.equal(bolehMenyetujui([r]), (ROLE_PERMISSIONS[r] || []).includes(P.INVENTORY_ADJUSTMENT_APPROVE), `penyetuju ${r}`);
    assert.equal(bolehMenulis([r]), (ROLE_PERMISSIONS[r] || []).includes(P.INVENTORY_WRITE), `penulis ${r}`);
  }
  assert.deepEqual([...ROLE_PENYETUJU].sort(), ["FINANCE", "OWNER"]);
  assert.ok(ROLE_PENULIS.includes("WAREHOUSE"));
});

test("akun production nyata: hanya Natasha, Gilang, Juri, Kemal yang dapat menyetujui; 'OWNER (Admin)' (role ADMIN saja) tidak", () => {
  const penyetuju = Object.entries(AKUN).filter(([, r]) => bolehMenyetujui(r)).map(([n]) => n).sort();
  assert.deepEqual(penyetuju, ["Gilang", "Juri", "Kemal", "Natasha"]);
  assert.equal(bolehMenyetujui(AKUN["OWNER (Admin)"]), false);
  for (const [n, r] of Object.entries(AKUN)) assert.equal(bolehMenyetujui(r), punyaIzin(r, P.INVENTORY_ADJUSTMENT_APPROVE), n);
  assert.ok(Object.values(AKUN).every((r) => bolehMenulis(r)), "kesembilan akun memegang inventory:write (ADMIN/WAREHOUSE/OWNER)");
});

test("hitungSelisihPengajuan: hasil hitung absolut → selisih bertanda; kosong ≠ 0; nol fisik sah; sama dengan saldo ditolak", () => {
  assert.deepEqual(hitungSelisihPengajuan(27, "20"), { ok: true, selisih: -7, saldo: 27, hasil: 20 });
  assert.equal(hitungSelisihPengajuan(-388.5, 5).selisih, 393.5);
  assert.equal(hitungSelisihPengajuan(12, 0).selisih, -12, "nol fisik = selisih penuh");
  assert.equal(hitungSelisihPengajuan(12, "").ok, false, "kosong bukan nol");
  assert.equal(hitungSelisihPengajuan(12, -1).ok, false);
  assert.equal(hitungSelisihPengajuan(12, "abc").ok, false);
  assert.match(hitungSelisihPengajuan(12, 12).pesan, /Tidak ada selisih/);
  assert.equal(hitungSelisihPengajuan(0.1 + 0.2, 0.3).ok, false, "selisih floating dibulatkan ke nol");
});

test("aksiPermintaan: tombol sesuai status/role; pemohon tidak melihat 'Setujui' untuk permintaannya sendiri", () => {
  const gudang = ["WAREHOUSE"]; const finance = ["FINANCE"]; const owner = ["ADMIN", "FINANCE", "OWNER"];
  assert.equal(aksiPermintaan({ status: "DRAFT", roles: gudang, userId: "u1", requestedById: "u1" }).majukan, true);
  const tunggu = (roles, userId, requestedById = "u1") => aksiPermintaan({ status: "WAITING_APPROVAL", roles, userId, requestedById });
  assert.equal(tunggu(gudang, "u1").setujui, false);
  assert.match(tunggu(gudang, "u1").catatan, /Owner atau Finance/);
  assert.equal(tunggu(owner, "u1").setujui, false, "Owner yang juga pemohon");
  assert.match(tunggu(owner, "u1").catatan, /orang lain/);
  assert.equal(tunggu(owner, "u9").setujui, true);
  assert.equal(tunggu(finance, "u9").setujui, true);
  const setuju = (roles) => aksiPermintaan({ status: "APPROVED", roles, userId: "u9", requestedById: "u1" });
  assert.equal(setuju(finance).posting, false, "Finance tidak menulis ledger");
  assert.equal(setuju(gudang).posting, true);
  assert.equal(setuju(owner).posting, true);
  for (const st of ["POSTED", "CANCELLED"]) assert.deepEqual(aksiPermintaan({ status: st, roles: owner, userId: "u9", requestedById: "u1" }), { majukan: false, setujui: false, posting: false, batalkan: false, catatan: "" });
});

test("pemasangan: Gudang.jsx tidak memanggil koreksi satu langkah; memakai pengajuan → WAITING_APPROVAL; api.adjustStock dihapus", () => {
  const gudang = baca("../src/pages/Gudang.jsx");
  const api = baca("../src/api.js");
  assert.doesNotMatch(gudang, /adjustStock/);
  assert.doesNotMatch(api, /adjustStock|movements\/adjustment/);
  assert.match(gudang, /createAdjustmentRequest\(/);
  assert.match(gudang, /updateAdjustmentRequest\(req\.id, \{ status: "WAITING_APPROVAL" \}\)/);
  assert.match(gudang, /hitungSelisihPengajuan/);
  assert.match(gudang, /label: "Ajukan Penyesuaian"/);
  assert.match(gudang, /penyesuaian-diajukan/);
  const tab = baca("../src/features/warehouse/components/AdjustmentsTab.jsx");
  assert.match(tab, /aksiPermintaan\(/);
  assert.match(tab, /aksi\.posting/);
});

test("regresi: label tombol 'Ajukan' hanya di MovementModal (AddMaterialModal tidak punya variabel `type`)", () => {
  const g = baca("../src/pages/Gudang.jsx");
  const awalAdd = g.indexOf("function AddMaterialModal(");
  const awalMove = g.indexOf("function MovementModal(");
  assert.ok(awalAdd >= 0 && awalMove > awalAdd);
  assert.doesNotMatch(g.slice(awalAdd, awalMove), /type === "adjustment"/);
  assert.match(g.slice(awalMove), /type === "adjustment" \? "Ajukan" : "Simpan"/);
});
