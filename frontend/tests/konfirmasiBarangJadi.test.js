// Konfirmasi Barang Jadi + kandidat Route Planner "Menunggu konfirmasi siap kirim". Pola proyek: fungsi murni dieksekusi dari modul; kontrak tampilan lewat text-scan sumber.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KBJ_ALASAN_MIN, kbjAlasanValid, kbjBolehKonfirmasi, kbjKunciBaru } from "../src/features/production/konfirmasiBarangJadiLogic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");

test("kbjAlasanValid: minimal 10 karakter setelah spasi dirapatkan, maksimal 500", () => {
  assert.equal(KBJ_ALASAN_MIN, 10);
  assert.equal(kbjAlasanValid("selesai"), false);
  assert.equal(kbjAlasanValid("  sudah   jadi  "), true); // "sudah jadi" = 10
  assert.equal(kbjAlasanValid("x".repeat(500)), true);
  assert.equal(kbjAlasanValid("x".repeat(501)), false);
});

test("kbjBolehKonfirmasi: hanya run adaptasi ACTIVE, unit masih dikerjakan Produksi, peran berwenang", () => {
  const dasar = { adaptation: true, runStatus: "ACTIVE", unitStatus: "IN_PRODUCTION", canConfirm: true };
  assert.equal(kbjBolehKonfirmasi(dasar), true);
  assert.equal(kbjBolehKonfirmasi({ ...dasar, unitStatus: "RECEIVED" }), true);
  for (const o of [{ adaptation: false }, { runStatus: "COMPLETED" }, { runStatus: "PENDING_ARRIVAL" }, { unitStatus: "READY_FOR_DELIVERY" }, { unitStatus: "CANCELLED" }, { canConfirm: false }]) {
    assert.equal(kbjBolehKonfirmasi({ ...dasar, ...o }), false, JSON.stringify(o));
  }
});

test("kbjKunciBaru: unik dan sesuai pola Idempotency-Key server", () => {
  const a = kbjKunciBaru(); const b = kbjKunciBaru();
  assert.notEqual(a, b); assert.match(a, /^[A-Za-z0-9._:-]{12,128}$/);
});

const DIALOG = read("features", "production", "KonfirmasiBarangJadi.jsx");
const DRAWER = read("features", "production", "UnitOverviewDrawer.jsx");
const API = read("api.js");
const ARMADA = read("pages", "Armada.jsx");
const BADGES = read("features", "armada", "components", "JobBadges.jsx");
const RUTE = read("features", "armada", "components", "RouteCard.jsx");
const UNROUTED = read("features", "armada", "components", "UnroutedJobsPanel.jsx");

test("dialog: pratinjau server dulu; kode unit diketik ulang; lokasi sah; alasan; verifikasi fisik; galat server tampil di dialog; kunci idempotensi diganti setelah galat", () => {
  assert.match(DIALOG, /api\.getProductionV2FinishPreview\(/);
  assert.match(DIALOG, /api\.getProductionV2FinishedGoodsLocations\(/);
  assert.match(DIALOG, /api\.confirmProductionV2FinishedGoods\(/);
  for (const id of ["kbj-kode", "kbj-lokasi", "kbj-alasan", "kbj-verif", "kbj-konfirmasi", "kbj-galat", "kbj-pratinjau"]) assert.match(DIALOG, new RegExp(`data-testid="${id}"`), id);
  assert.match(DIALOG, /kodeUnit\.trim\(\) === kode/);
  assert.match(DIALOG, /physicalVerified: true/);
  assert.match(DIALOG, /setKunci\(kbjKunciBaru\(\)\)/);
  assert.doesNotMatch(DIALOG, /window\.(prompt|confirm|alert)/);
  assert.match(DIALOG, /tidak ada foto, hasil uji, stok, atau serah terima Gudang yang dibuat/i);
});

test("Unit 360: panel konfirmasi dipasang di tab Pekerjaan untuk peran berwenang", () => {
  assert.match(DRAWER, /<KonfirmasiBarangJadi d=\{d\} canConfirm=\{canApplyAdaptation\}/);
});

test("Route Planner: label 'Menunggu konfirmasi siap kirim' di kartu rute + panel job; Terbitkan dimatikan selama ada unit menunggu", () => {
  assert.match(BADGES, /export function MenungguKonfirmasiBadge/);
  assert.match(BADGES, /Menunggu konfirmasi siap kirim/);
  assert.match(RUTE, /<MenungguKonfirmasiBadge job=\{j\} \/>/);
  assert.match(UNROUTED, /<MenungguKonfirmasiBadge job=\{j\} \/>/);
  assert.match(RUTE, /jobs\.some\(\(j\) => \(j\.menungguKonfirmasi\?\.length \?\? 0\) > 0\)/);
  assert.match(RUTE, /data-testid="rute-terbitkan"/);
});

test("Penjadwalan: kandidat draf opt-in (termasukMenunggu), tab 'Menunggu konfirmasi', job draf dikirim dengan menungguKonfirmasi:true; galat server tampil", () => {
  assert.match(API, /termasukMenunggu: type === "DELIVERY"|opts\.termasukMenunggu \? "&termasukMenunggu=1"/);
  assert.match(ARMADA, /menunggu=\{board\.availableMenunggu \?\? \[\]\}/);
  assert.match(ARMADA, /\.\.\.\(draf \? \{ menungguKonfirmasi: true \} : \{\}\)/);
  assert.match(ARMADA, /data-testid="galat-buat-job"/);
  assert.match(ARMADA, /Menunggu konfirmasi siap kirim/);
});
