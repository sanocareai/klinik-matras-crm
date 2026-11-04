// HPP pada pencatatan bahan Produksi (3 Nov 2026): model murni + pengawatan. Perilaku nyata diuji di mock QA; angka resmi dibekukan SERVER.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { barisAktualDariKatalog, hppBaris, ringkasHpp, rupiahHpp } from "../src/features/production/bahan/bahanModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8").replace(/\r\n/g, "\n");
const be = (...p) => fs.readFileSync(path.join(here, "..", "..", "backend", ...p), "utf8").replace(/\r\n/g, "\n");
const kat = (o = {}) => ({ materialId: "m1", kode: "BR-001", nama: "Busa", satuan: "Lembar", tersedia: 10, saldoDiketahui: true, ...o });

test("rupiahHpp: bulat tanpa desimal, pecahan sampai 2 desimal, kosong = em dash", () => {
  assert.equal(rupiahHpp(12500), "Rp12.500"); assert.equal(rupiahHpp(300.5), "Rp300,5"); assert.equal(rupiahHpp(1234.567), "Rp1.234,57"); assert.equal(rupiahHpp(null), "—");
});

test("hppBaris: harga + jumlah → subtotal; desimal koma; tanpa harga TIDAK jadi Rp0; peran tanpa izin tersembunyi; belum dimuat", () => {
  const b = barisAktualDariKatalog(kat({ harga: { harga: 12500, terjadwal: null } }));
  assert.deepEqual({ ...hppBaris(b, ""), terjadwal: undefined, berlakuMulai: undefined }, { status: "ada", harga: 12500, hargaPakai: null, subtotal: null, terjadwal: undefined, berlakuMulai: undefined }, "jumlah kosong: harga tampil, subtotal belum");
  assert.equal(hppBaris(b, "2").subtotal, 25000); assert.equal(hppBaris(b, "2,5").subtotal, 31250); assert.equal(hppBaris(b, "0").subtotal, null);
  assert.equal(hppBaris({ ...b, harga: { harga: 0.3333 } }, "3").subtotal, 1, "pembulatan 2 desimal");
  assert.equal(hppBaris(barisAktualDariKatalog(kat({ harga: { harga: null } })), "5").status, "tanpa_harga");
  assert.equal(hppBaris(barisAktualDariKatalog(kat({ harga: null })), "5").status, "tersembunyi");
  assert.equal(hppBaris(barisAktualDariKatalog(kat()), "5").status, "memuat", "tanpa kunci harga = belum dimuat");
});

test("ringkasHpp: bahan tanpa harga tidak dihitung dan DILAPORKAN (lengkap=false); baris yang sudah tercatat tidak ikut; tersembunyi = tidak tampil", () => {
  const a = { ...barisAktualDariKatalog(kat({ harga: { harga: 12500 } })), qty: "2" };
  const t = { ...barisAktualDariKatalog(kat({ materialId: "m2", harga: { harga: null } })), qty: "3" };
  const r = ringkasHpp([a, t]); assert.deepEqual({ tampil: r.tampil, total: r.total, nTanpaHarga: r.nTanpaHarga, lengkap: r.lengkap, nBerharga: r.nBerharga }, { tampil: true, total: 25000, nTanpaHarga: 1, lengkap: false, nBerharga: 1 });
  assert.equal(ringkasHpp([a]).lengkap, true);
  assert.equal(ringkasHpp([a, t], (x) => x.materialId === "m2").nTanpaHarga, 0, "baris tercatat dikecualikan");
  assert.equal(ringkasHpp([{ ...a, harga: null }]).tampil, false);
  assert.equal(ringkasHpp([{ ...a, harga: undefined }]).nMemuat, 1);
  assert.equal(ringkasHpp([]).tampil, false);
});

test("pengawatan UI: harga di pemilih, HPP per baris, total, hasil tercatat dari harga BEKU server; payload tidak memuat harga", () => {
  const c = src("features", "production", "bahan", "CatatBahanBaru.jsx"); const p = src("features", "production", "bahan", "PemilihBahanKatalog.jsx");
  assert.ok(p.includes("rupiahHpp(b.harga.harga)") && p.includes("Harga belum ada"), "pemilih: harga per satuan atau 'Harga belum ada'");
  assert.ok(c.includes("<HppBaris b={b} />") && c.includes('data-testid="hpp-total"') && c.includes("belum punya Harga Berlaku — belum masuk total (bukan Rp0)"), "baris + total + pesan tanpa harga");
  assert.ok(c.includes("row.hppBeku") && c.includes("hppBeku?.nilai") && c.includes("dibekukan saat dicatat"), "setelah tercatat: angka dari server");
  assert.ok(c.includes("api.addUnitMaterial(unitId, { materialId: b.materialId, qty: v, note: catatan.trim() || undefined, ...(aturanBaris(b) ? { satuan: satuanIsianBaris(b) } : {}) }"), "payload hanya materialId, qty, note (+ satuan untuk bahan beraturan satuan pakai); server yang membekukan harga");
  assert.ok(!/harga|hpp/i.test(c.match(/api\.addUnitMaterial\([^)]*\)/)[0]), "tidak mengirim harga");
  assert.ok(c.includes("getKatalogBahanProduksi({ q: b.kode || b.nama") && c.includes("hargaDimintaRef"), "baris dari rencana memuat harga dari katalog, sekali per bahan");
  assert.ok(!/estimasi|perkiraan harga/i.test(c), "tanpa estimasi/angka karangan");
});

test("server: katalog membawa Harga Berlaku hanya untuk peran berizin; baris pemakaian membawa HPP beku", () => {
  const r = be("src", "routes", "productionAdopsi.js"); const s = be("src", "services", "productionAdoptionService.js"); const h = be("src", "services", "finance", "hargaBerlaku.js");
  assert.ok(r.includes("izinHarga: hasPermission(req.user, P.FINANCE_READ) || hasPermission(req.user, P.UNIT_MATERIAL_WRITE)"), "izin sama dengan pemakaian aktual");
  assert.ok(s.includes("hargaPeta = izinHarga ? await hargaBerlakuBanyak(") && s.includes("harga: hargaPeta ?"), "tanpa izin = null, tidak query harga");
  assert.ok(s.includes("hppBeku:") && s.includes('status: "DINILAI", harga: izinHarga'), "HPP beku di baris aktual, nominal hanya untuk berizin");
  assert.ok(/export async function hargaBerlakuBanyak/.test(h) && !/\.(create|update|delete|upsert)\(/.test(h.slice(h.indexOf("export async function hargaBerlakuBanyak"), h.indexOf("export async function keadaanHarga"))), "baca-saja, satu query");
});
