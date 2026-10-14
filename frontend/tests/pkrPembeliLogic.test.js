// Logika murni form pembeli/penerima/alamat PKR + paritas normalisasi nomor & validasi Maps dengan backend.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalisasiNomorTelepon, tampilNomor } from "../src/utils/nomorTelepon.js";
import { validasiLinkMaps } from "../src/utils/mapsLink.js";
import {
  LANGKAH_PKR, pembeliKosong, galatCustomer, galatAlamat, galatKebutuhan, bodyPembeli, belumLengkap, formEditDariIdentitas, bodyKoreksiPembeli, adaPerubahanKoreksi,
  galatFormEdit, kemampuanEdit, bolehKoreksiPembeliPkr,
} from "../src/features/finance/pkrPembeliLogic.js";
import { modelSumberPkr, barisSumberPkr } from "../src/features/orders/pkrSumberModel.js";

test("nomor telepon: normalisasi ke 628…, internasional dengan +, penolakan format ambigu", () => {
  const ok = (raw, nomor) => assert.deepEqual(normalisasiNomorTelepon(raw), { ok: true, nomor }, raw);
  ok("0812-1111-2222", "6281211112222");
  ok("+62 812 1111 2222", "6281211112222");
  ok("62812 1111 2222", "6281211112222");
  ok("81211112222", "6281211112222");
  ok("+62 0812 1111 2222", "6281211112222");
  ok("+966 5 5555 1234", "96655555 1234".replace(" ", ""));
  for (const salah of ["", "abc", "12345", "0211234567", "628@lid", "+1 2", "99999999999999999"]) assert.equal(normalisasiNomorTelepon(salah).ok, false, salah);
  assert.equal(tampilNomor("6281211112222"), "0812-1111-2222");
});

test("link Maps: hanya Google Maps, https dipaksa, domain lain/skema berbahaya ditolak, kosong = ok", () => {
  assert.deepEqual(validasiLinkMaps(""), { ok: true, url: null });
  assert.equal(validasiLinkMaps("maps.app.goo.gl/AbC").url, "https://maps.app.goo.gl/AbC");
  assert.equal(validasiLinkMaps("http://www.google.com/maps/place/Bekasi").url, "https://www.google.com/maps/place/Bekasi");
  for (const salah of ["https://evil.example.com/x", "javascript:alert(1)", "https://www.google.com/search?q=maps", "https://goo.gl/abc", "https://maps.app.goo.gl/a b"]) {
    assert.equal(validasiLinkMaps(salah).ok, false, salah);
  }
});

test("paritas dengan backend: vektor nomor & Maps yang sama menghasilkan keputusan yang sama (berkas backend memuat aturan identik)", () => {
  const be = readFileSync(new URL("../../backend/src/lib/domain/pkrPembeli.js", import.meta.url), "utf8");
  for (const host of ["maps.app.goo.gl", "goo.gl", "g.co", "maps.google.com", "www.google.com", "google.com", "www.google.co.id", "google.co.id", "maps.google.co.id", "share.google"]) {
    assert.ok(be.includes(`"${host}"`), `host ${host} ada di backend`);
  }
  assert.ok(/MAKS_URL = 500/.test(be) && /nomor\.startsWith\("628"\)/.test(be));
});

test("langkah wizard berurutan seperti Order CRM Inbox: 7 langkah", () => {
  assert.deepEqual(LANGKAH_PKR.map((l) => l.kode), ["transaksi", "customer", "alamat", "kebutuhan", "item", "bayar", "pratinjau"]);
});

test("galat per langkah: customer (nama + nomor wajib kecuali karyawan), alamat (wajib bila dikirim, Maps valid), kebutuhan (panjang)", () => {
  const f = { buyerName: "Bpk. Indra", pembeli: { ...pembeliKosong(), telepon: "0812-1111-2222" }, daftar: { alamat: "", kota: "", tanggalKirim: "" } };
  assert.equal(galatCustomer(f), null);
  assert.match(galatCustomer({ ...f, buyerName: "A" }), /Nama pembeli/);
  assert.match(galatCustomer({ ...f, pembeli: { ...f.pembeli, telepon: "" } }), /Nomor WhatsApp/);
  assert.equal(galatCustomer({ ...f, pembeli: { ...f.pembeli, telepon: "", adalahKaryawan: true } }), null);
  assert.match(galatCustomer({ ...f, pembeli: { ...f.pembeli, penerimaBeda: true } }), /Nama penerima/);
  assert.match(galatAlamat(f, { perluAlamat: true }), /Alamat lengkap/);
  assert.equal(galatAlamat(f, { perluAlamat: false }), null);
  assert.match(galatAlamat({ ...f, pembeli: { ...f.pembeli, lokasiUrl: "https://evil.example.com" } }), /Google Maps/);
  assert.match(galatKebutuhan({ ...f, pembeli: { ...f.pembeli, keluhan: "x".repeat(1001) } }), /Keluhan maksimal/);
});

test("body: pembeli {telepon}|{adalahKaryawan}, kolom pemenuhan hanya yang terisi, Maps dinormalisasi, penerima berbeda", () => {
  const f = {
    buyerName: "Bpk. Indra",
    pembeli: { ...pembeliKosong(), telepon: " 0812-1111-2222 ", lokasiUrl: "maps.app.goo.gl/AbC", patokan: "Pagar biru", keluhan: "Pegal", catatanDelivery: "Titip satpam", penerimaBeda: true, penerimaNama: "Bu Rina", penerimaTelepon: "0813 5555 6666" },
    daftar: { alamat: "Jl. Mawar 5", kota: "Bekasi", tanggalKirim: "" },
  };
  const b = bodyPembeli(f);
  assert.deepEqual(b.pembeli, { telepon: "0812-1111-2222" });
  assert.equal(b.orderCrmEkstra.lokasiUrl, "https://maps.app.goo.gl/AbC");
  assert.equal(b.orderCrmEkstra.catatanProduksi, undefined);
  assert.deepEqual(b.orderCrmEkstra.penerima, { nama: "Bu Rina", telepon: "0813 5555 6666" });
  assert.deepEqual(bodyPembeli({ ...f, pembeli: { ...f.pembeli, adalahKaryawan: true } }).pembeli, { adalahKaryawan: true });
  assert.ok(belumLengkap({ ...f, pembeli: { ...f.pembeli, telepon: "" } }).includes("Nomor telepon pembeli"));
});

test("edit: hanya kolom yang BERUBAH dikirim; lengkapi legacy mengirim nomor + nama; tanpa perubahan = kosong; penerima dapat dikembalikan 'sama'", () => {
  const identitas = {
    legacy: true, customer: { nama: "Bpk. Indra", telepon: null }, penerima: { berbeda: false }, alamat: { teks: "Jl. Mawar 5", kota: "Bekasi", lokasiUrl: null, patokan: null },
    catatan: { keluhan: null, order: null, produksi: null, delivery: null },
  };
  const awal = formEditDariIdentitas(identitas);
  assert.equal(adaPerubahanKoreksi(bodyKoreksiPembeli(awal, awal)), false);
  const baru = { ...awal, telepon: "0812-1111-2222", lokasiUrl: "https://maps.app.goo.gl/X", catatanDelivery: "Telepon dulu" };
  const b = bodyKoreksiPembeli(baru, awal);
  assert.deepEqual(b.pembeli, { telepon: "0812-1111-2222", nama: "Bpk. Indra" });
  assert.deepEqual(b.pemenuhan, { lokasiUrl: "https://maps.app.goo.gl/X", catatanDelivery: "Telepon dulu" });
  const beda = bodyKoreksiPembeli({ ...baru, penerimaBeda: true, penerimaNama: "Bu Rina" }, awal);
  assert.deepEqual(beda.pemenuhan.penerima, { nama: "Bu Rina", telepon: null });
  const kembali = bodyKoreksiPembeli({ ...awal, penerimaBeda: false }, { ...awal, penerimaBeda: true, penerimaNama: "Bu Rina" });
  assert.equal(kembali.pemenuhan.penerima, null);
  assert.match(galatFormEdit({ ...awal, telepon: "abc" }), /nomor|Nomor/i);
});

test("kemampuan edit menurut progres Delivery: terjadwal=sinkron job sama; berjalan/selesai=alamat terkunci", () => {
  assert.equal(kemampuanEdit({ delivery: { kode: "SCHEDULED" } }).status, "TERJADWAL");
  assert.equal(kemampuanEdit({ delivery: { kode: "SCHEDULED" } }).alamat, true);
  assert.equal(kemampuanEdit({ delivery: { kode: "EN_ROUTE" } }).alamat, false);
  assert.equal(kemampuanEdit({ delivery: { kode: "COMPLETED" } }).status, "SELESAI");
  assert.equal(kemampuanEdit({ delivery: null }).alamat, true);
  assert.equal(bolehKoreksiPembeliPkr({ roles: ["SALES"] }), false);
  assert.equal(bolehKoreksiPembeliPkr({ roles: ["FINANCE"] }), true);
});

test("sumber PKR: Indra = customer, Kemal = 'Dijual oleh Kemal'; tanpa nominal; pembayaran hanya bila server mengirim", () => {
  const crm = {
    nomor: "PKR-11102026-005", penjual: { name: "Kemal" }, pembeli: "Bpk. Indra", pembayaran: { label: "Dibayar sebagian" }, items: [{}], ringkasUnit: { total: 3 },
    identitas: { customer: { nama: "Bpk. Indra" }, karyawanPenjual: { nama: "Kemal" }, legacy: false, penerima: { berbeda: true, nama: "Bu Rina", telepon: "6281355556666" } },
  };
  const m = modelSumberPkr(crm);
  assert.equal(m.ringkas, "Dijual oleh Kemal");
  assert.equal(m.customer, "Bpk. Indra");
  const baris = Object.fromEntries(barisSumberPkr(m));
  assert.equal(baris["Customer/pembeli"], "Bpk. Indra");
  assert.equal(baris["Karyawan penjual"], "Kemal");
  assert.equal(baris["Item & unit"], "1 item · 3 unit produksi");
  assert.equal(baris["Status pembayaran"], "Dibayar sebagian");
  const produksi = barisSumberPkr(modelSumberPkr({ nomor: "PKR-1", karyawan: "Kemal", pembeli: "Bpk. Indra", identitas: { customer: { nama: "Bpk. Indra" }, legacy: true } }));
  assert.ok(!produksi.some(([l]) => l === "Status pembayaran"), "Produksi tanpa pembayaran");
  assert.ok(produksi.some(([, v]) => /belum lengkap/.test(v)));
  assert.equal(modelSumberPkr(null), null);
});

test("UI statis: wizard 7 langkah memakai bagian form bersama; drawer punya 4 tombol lengket; dialog edit memakai pratinjau + alasan", () => {
  const halaman = readFileSync(new URL("../src/pages/finance/FinancePenjualanKaryawan.jsx", import.meta.url), "utf8");
  for (const t of ["LANGKAH_PKR", "BagianCustomerPenerima", "BagianAlamatLokasi", "BagianKebutuhan", "Edit Data Customer", "Koreksi Item &amp; Pemenuhan", "Koreksi Nilai", "Riwayat Perubahan", "ModalEditCustomerPkr", "ModalRiwayatPkr"]) {
    assert.ok(halaman.includes(t), `halaman memuat ${t}`);
  }
  const dialog = readFileSync(new URL("../src/features/finance/PkrEditCustomer.jsx", import.meta.url), "utf8");
  assert.match(dialog, /Tinjau Dampak/);
  assert.match(dialog, /Alasan koreksi/);
  assert.match(dialog, /Idempotency|kunciBaru/);
  const detail = readFileSync(new URL("../src/features/finance/detailSpecs.js", import.meta.url), "utf8");
  for (const j of ["Ringkasan keuangan", "Customer & kontak", "Alamat & Maps", "Keluhan & catatan", "Item penjualan", "Unit produksi", "Order CRM & Delivery", "Pembayaran", "Jejak perubahan"]) {
    assert.ok(detail.includes(j), `rincian memuat bagian ${j}`);
  }
});
