// Unit kebijakan akses bersama Pengajuan Biaya (C2.1): divisi vs peran, adapter peran lama, workspace, kepemilikan baris.
// Murni (tanpa DB) — kebijakan yang sama dipakai Delivery, Produksi, Gudang, Marketing, Management, HR-GA.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DIVISI_KEANGGOTAAN, ADAPTER_PERAN_DIVISI, divisiEfektif, bolehWorkspace, divisiTerlarang, punyaKeanggotaan,
  pemilikPengajuan, pastikanAksesBaris, workspaceUntukDivisi, stafFinance, bolehLihatSemua,
} from "../src/services/expenseSubmission/access.js";
import { WORKSPACES } from "../src/services/expenseSubmission/config.js";

const user = (roles, divisi = [], id = "u1") => ({ id, role: roles[0], roles, divisi });

test("setiap workspace punya kunci keanggotaan yang valid dan unik", () => {
  const kunci = Object.values(WORKSPACES).map((c) => c.keanggotaan);
  assert.ok(kunci.every((k) => DIVISI_KEANGGOTAAN.includes(k)));
  assert.equal(new Set(kunci).size, kunci.length);
  assert.equal(kunci.length, 6);
});

test("SALES bukan otomatis Marketing; keanggotaan eksplisit yang membukanya", () => {
  assert.equal(bolehWorkspace(user(["SALES"]), "MARKETING"), false);
  assert.equal(bolehWorkspace(user(["SALES"], ["MARKETING"]), "MARKETING"), true);
  assert.deepEqual([...divisiEfektif(user(["SALES"]))], []);
});

test("adapter peran lama: hanya jalur C1/Delivery yang sudah hidup; tidak ada SALES/FINANCE", () => {
  assert.deepEqual(Object.keys(ADAPTER_PERAN_DIVISI).sort(), ["DISPATCHER", "DRIVER", "HELPER", "LEADER_DRIVER", "PRODUCTION_LEAD", "WAREHOUSE"]);
  assert.equal(bolehWorkspace(user(["PRODUCTION_LEAD"]), "PRODUKSI"), true);
  assert.equal(bolehWorkspace(user(["WAREHOUSE"]), "WAREHOUSE"), true);
  assert.equal(bolehWorkspace(user(["DISPATCHER"]), "DELIVERY"), true);
  assert.equal(bolehWorkspace(user(["DRIVER"]), "DELIVERY"), true);
});

test("tidak ada akses lintas divisi implisit", () => {
  const pl = user(["PRODUCTION_LEAD"]);
  for (const ws of ["WAREHOUSE", "DELIVERY", "MARKETING", "MANAGEMENT", "HR_GA"]) assert.equal(bolehWorkspace(pl, ws), false, ws);
  const sales = user(["SALES"], ["MARKETING"]);
  for (const ws of ["PRODUKSI", "WAREHOUSE", "DELIVERY", "MANAGEMENT", "HR_GA"]) assert.equal(bolehWorkspace(sales, ws), false, ws);
});

test("multi-divisi: membuka semua divisi yang dipegang, tidak lebih", () => {
  const u = user(["SALES"], ["MARKETING", "HR_GA"]);
  assert.equal(bolehWorkspace(u, "MARKETING"), true);
  assert.equal(bolehWorkspace(u, "HR_GA"), true);
  assert.equal(bolehWorkspace(u, "MANAGEMENT"), false);
  assert.deepEqual(divisiTerlarang(u).sort(), ["DELIVERY", "GUDANG", "MANAGEMENT", "PRODUKSI"]);
});

test("adapter dan keanggotaan bersifat aditif", () => {
  const u = user(["WAREHOUSE"], ["MARKETING"]);
  assert.deepEqual([...divisiEfektif(u)].sort(), ["MARKETING", "WAREHOUSE"]);
});

test("Finance/Admin/Owner/Approver melihat semua workspace tanpa keanggotaan", () => {
  for (const r of ["FINANCE", "ADMIN", "OWNER", "APPROVER"]) {
    const u = user([r]);
    assert.equal(stafFinance(u), true, r);
    for (const ws of Object.keys(WORKSPACES)) assert.equal(bolehWorkspace(u, ws), true, `${r}/${ws}`);
    assert.deepEqual(divisiTerlarang(u), [], r);
  }
});

test("user lama tanpa field divisi / peran tak dikenal tidak error dan tidak dapat akses", () => {
  assert.equal(bolehWorkspace({ id: "x", role: "SALES" }, "MARKETING"), false);
  assert.equal(bolehWorkspace(null, "MARKETING"), false);
  assert.equal(punyaKeanggotaan({ id: "x" }), false);
  assert.equal(punyaKeanggotaan(user(["SALES"], ["HR_GA"])), true);
  assert.equal(bolehWorkspace(user(["SALES"], ["MARKETING"]), "TIDAK_ADA"), false);
});

test("workspaceUntukDivisi memetakan GUDANG -> WAREHOUSE", () => {
  assert.equal(workspaceUntukDivisi("GUDANG"), "WAREHOUSE");
  assert.equal(workspaceUntukDivisi("MARKETING"), "MARKETING");
});

test("pemilikPengajuan: pemohon atau pembuat", () => {
  assert.equal(pemilikPengajuan({ requestedById: "u1", createdById: "z" }, user(["SALES"])), true);
  assert.equal(pemilikPengajuan({ requestedById: "z", createdById: "u1" }, user(["SALES"])), true);
  assert.equal(pemilikPengajuan({ requestedById: "z", createdById: "y" }, user(["SALES"])), false);
});

const baris = (extra = {}) => ({ division: "MARKETING", requestedById: "pemilik", createdById: "pemilik", ...extra });
const kode = (fn) => { try { fn(); return 200; } catch (e) { return e.statusCode; } };

test("pastikanAksesBaris: baris tidak ada / workspace bukan haknya = 404; non-pemilik satu divisi = 403; pemilik = lolos", () => {
  const anggota = user(["SALES"], ["MARKETING"], "lain");
  assert.equal(kode(() => pastikanAksesBaris(anggota, null)), 404);
  assert.equal(kode(() => pastikanAksesBaris(user(["SALES"], [], "lain"), baris())), 404);
  assert.equal(kode(() => pastikanAksesBaris(user(["PRODUCTION_LEAD"], [], "lain"), baris())), 404);
  assert.equal(kode(() => pastikanAksesBaris(anggota, baris())), 403);
  assert.equal(kode(() => pastikanAksesBaris(anggota, baris(), { tulis: true })), 403);
  assert.equal(kode(() => pastikanAksesBaris(user(["SALES"], ["MARKETING"], "pemilik"), baris(), { tulis: true })), 200);
});

test("pastikanAksesBaris: akun own-only (Driver) — mutasi baris orang lain 404, baca 403 (kontrak lama); unggah bukti selalu 404", () => {
  const drv = user(["DRIVER"], [], "d2");
  const lain = baris({ division: "DELIVERY", requestedById: "d1", createdById: "d1" });
  assert.equal(kode(() => pastikanAksesBaris(drv, lain, { tulis: true })), 404);
  assert.equal(kode(() => pastikanAksesBaris(drv, lain)), 403);
  assert.equal(kode(() => pastikanAksesBaris(user(["SALES"], ["MARKETING"], "x"), baris(), { tulis: true, sembunyikan: true })), 404);
  assert.equal(kode(() => pastikanAksesBaris(drv, baris({ division: "DELIVERY", requestedById: "d2", createdById: "d2" }))), 200);
});

test("pastikanAksesBaris: Finance/Admin/Owner; baca vs tulis", () => {
  const b = baris({ division: "DELIVERY" });
  assert.equal(bolehLihatSemua(user(["ADMIN"])), true);
  assert.equal(kode(() => pastikanAksesBaris(user(["ADMIN"], [], "a"), b, { tulis: true })), 200);
  assert.equal(kode(() => pastikanAksesBaris(user(["OWNER"], [], "o"), b)), 200);
  assert.equal(kode(() => pastikanAksesBaris(user(["FINANCE"], [], "f"), b)), 200);
  // Dispatcher satu divisi Delivery tetapi bukan pemilik: tidak boleh mengubah punya orang lain
  assert.equal(kode(() => pastikanAksesBaris(user(["DISPATCHER"], [], "disp2"), b, { tulis: true })), 403);
});
