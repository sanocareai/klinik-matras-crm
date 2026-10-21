// Penerimaan workshop oleh petugas (frontend): model murni + pengawatan komponen. Server tetap penentu (izin, UNIQUE per unit, lokasi sah); di sini dijaga yang rawan salah di layar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DAMPAK_PENERIMAAN, bolehKirimPenerimaan, lokasiAwalPenerimaan, teksDampakAktivasi } from "../src/features/production/orderProduksiModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");

test("formulir penerimaan: boleh dikirim hanya bila pernyataan fisik dicentang DAN lokasi dipilih; tidak saat sibuk (klik ganda)", () => {
  assert.equal(bolehKirimPenerimaan({ fisik: true, locationId: "loc-1" }), true);
  assert.equal(bolehKirimPenerimaan({ fisik: false, locationId: "loc-1" }), false);
  assert.equal(bolehKirimPenerimaan({ fisik: true, locationId: "" }), false);
  assert.equal(bolehKirimPenerimaan({ fisik: true, locationId: "loc-1", sibuk: true }), false);
  assert.equal(bolehKirimPenerimaan({ fisik: "true", locationId: "loc-1" }), false, "hanya boolean true");
  assert.equal(bolehKirimPenerimaan(), false);
});

test("lokasi awal: lokasi workshop bawaan Admin bila ada; selain itu kosong — tidak menebak", () => {
  assert.equal(lokasiAwalPenerimaan({ bawaan: { id: "loc-9", code: "RCV-1" }, lokasi: [{ id: "loc-1" }] }), "loc-9");
  assert.equal(lokasiAwalPenerimaan({ bawaan: null, lokasi: [{ id: "loc-1" }] }), "");
  assert.equal(lokasiAwalPenerimaan(null), "");
});

test("dampak penerimaan ditulis di layar: apa yang dicatat dan apa yang TIDAK terjadi", () => {
  const semua = [...DAMPAK_PENERIMAAN.dicatat, ...DAMPAK_PENERIMAAN.tidak].join(" ");
  for (const k of [/waktu sekarang/i, /lokasi/i, /Rencana Produksi/, /Production Run/, /stok/i, /status order Sales/i]) assert.match(semua, k);
});

test("dampak aktivasi V2: unit belum diterima → kedatangan tetap lewat Terima Unit; sudah diterima → memakai catatan, tidak dicatat dua kali", () => {
  const belum = teksDampakAktivasi();
  assert.match(belum, /membuka Production Run/); assert.match(belum, /belum tiba di workshop/); assert.doesNotMatch(belum, /tidak dicatat dua kali/);
  const sudah = teksDampakAktivasi({ diterimaWorkshop: { basis: "WORKSHOP_RECEIPT", label: "Penerimaan dicatat petugas" } });
  assert.match(sudah, /membuka Production Run/); assert.match(sudah, /Penerimaan dicatat petugas/); assert.match(sudah, /tidak dicatat dua kali/); assert.doesNotMatch(sudah, /belum tiba di workshop/);
});

test("kartu backlog → view jadwal membawa bukti terima (untuk teks dampak aktivasi)", () => {
  const m = src("features", "production", "unitCardModel.js");
  assert.ok(m.includes("diterimaWorkshop: c.receivedBasis ? { basis: c.receivedBasis, label: c.receivedBasisLabel ?? null } : null"));
});

test("pengawatan: panel memakai status order Sales sebenarnya, tombol penerimaan + Ubah ke Diproses dengan catatan wajib; Gudang punya antrean; API memakai kunci idempotensi", () => {
  const panel = src("features", "production", "OrderProduksiPanel.jsx");
  assert.match(panel, /ad\.orderSales \?\? statusOf/, "status order Sales sebenarnya didahulukan");
  assert.match(panel, /case "CONFIRM_ARRIVAL": tombol = izin\.catatPenerimaan/); assert.match(panel, /PenerimaanWorkshopModal/);
  assert.match(panel, /case "UBAH_ORDER_DIPROSES": tombol = izin\.statusOrder/);
  assert.match(panel, /status: "PROCESSING", statusOverrideNote: catatanOrder\.trim\(\)/); assert.match(panel, /catatanOrder\.trim\(\)\.length < 3/, "catatan wajib");
  assert.match(panel, /hanya order ini/); assert.match(panel, /tindakan-penghalang/);
  const modal = src("features", "production", "PenerimaanWorkshopModal.jsx");
  assert.match(modal, /kunciRef\.current \?\?= kunciIdempoten\("penerimaan"\)/, "satu niat = satu kunci"); assert.match(modal, /fisikDiterima: true/); assert.match(modal, /DAMPAK_PENERIMAAN/);
  const api = src("api.js");
  assert.match(api, /catatPenerimaanWorkshop: \(unitId/); assert.match(api, /\/production\/units\/\$\{unitId\}\/penerimaan-workshop/); assert.match(api, /"Idempotency-Key": idempotencyKey/);
  const gudang = src("pages", "warehouse", "WarehouseUnitCustody.jsx");
  assert.match(gudang, /MenungguPenerimaanSection/);
  assert.match(src("features", "warehouse", "MenungguPenerimaanSection.jsx"), /getPenerimaanWorkshopMenunggu/);
  assert.match(src("features", "production", "ScheduleModals.jsx"), /teksDampakAktivasi\(\{ diterimaWorkshop: target\.diterimaWorkshop \}\)/);
});
