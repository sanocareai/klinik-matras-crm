// "+ Tambah pemakaian" dan tombol "Edit" per bahan pada tabel Pemakaian aktual (ubah jumlah / ganti bahan): model murni + pengawatan sumber. Tanpa React/DOM.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DETAIL_TEKNIS, MODE, PILIHAN_SUMBER, badanPengajuan, badanPenerapan, badanPratinjau, barisLangkah, bolehSimpan, labelJalur, pesanHasil, sidikPerubahan, validasiPerubahan } from "../src/features/production/bahan/perubahanModel.js";

const src = (...p) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", ...p), "utf8").replace(/\r\n/g, "\n");
const SEKARANG = new Date("2026-10-26T05:00:00Z");

test("pilihan sumber: tiga pilihan sederhana (Bahan Gudang, Bahan belum tercatat, Komponen lama); rincian teknis di bagian yang bisa dibuka", () => {
  assert.deepEqual(Object.values(PILIHAN_SUMBER).map((x) => x.label), ["Bahan Gudang", "Bahan belum tercatat", "Komponen lama"]);
  assert.ok(DETAIL_TEKNIS.some((d) => /Persetujuan/.test(d.judul)) && DETAIL_TEKNIS.some((d) => /Tanggal dan harga/.test(d.judul)));
  const b = src("features", "production", "bahan", "PemakaianAktualBagian.jsx");
  assert.match(b, /<details[^>]*data-testid="detail-teknis"/); assert.ok(!b.includes("A · Tambah catatan TANPA"), "panel A/B panjang tidak lagi tampil");
});

test("validasi Edit: ubah jumlah (≥0, harus beda dari yang tercatat), ganti bahan (bahan pengganti, sisa lama < pemakaian, jumlah pengganti > 0), alasan ≥5, tanggal wajib hanya unit terkirim", () => {
  const dasar = { mode: MODE.UBAH, qtyBaru: "3", alasan: "Salah catat saat produksi", tanggal: "", selesai: false, bersih: 5, sekarang: SEKARANG };
  assert.equal(validasiPerubahan(dasar).ok, true); assert.equal(validasiPerubahan({ ...dasar, qtyBaru: "3" }).qtyBaru, 3);
  assert.equal(validasiPerubahan({ ...dasar, qtyBaru: "0" }).ok, true, "0 = tidak jadi dipakai");
  assert.match(validasiPerubahan({ ...dasar, qtyBaru: "5" }).galat, /sama dengan yang tercatat/); assert.equal(validasiPerubahan({ ...dasar, qtyBaru: "-1" }).ok, false); assert.equal(validasiPerubahan({ ...dasar, qtyBaru: "" }).ok, false);
  assert.match(validasiPerubahan({ ...dasar, alasan: "x" }).galat, /Alasan wajib/);
  assert.match(validasiPerubahan({ ...dasar, selesai: true }).galat, /tanggal pemakaian/i); assert.equal(validasiPerubahan({ ...dasar, selesai: true, tanggal: "2026-10-20" }).tanggal, "2026-10-20"); assert.match(validasiPerubahan({ ...dasar, selesai: true, tanggal: "2026-11-01" }).galat, /masa depan/);
  const ganti = { ...dasar, mode: MODE.GANTI, qtyBaru: "0", keBahan: { materialId: "m2" }, qtyKe: "4" };
  assert.equal(validasiPerubahan(ganti).ok, true); assert.equal(validasiPerubahan(ganti).qtyKe, 4);
  assert.match(validasiPerubahan({ ...ganti, keBahan: null }).galat, /bahan pengganti/); assert.match(validasiPerubahan({ ...ganti, qtyKe: "0" }).galat, /pengganti/); assert.match(validasiPerubahan({ ...ganti, qtyBaru: "5" }).galat, /kurang dari pemakaian/);
});

test("sidik isian berubah saat tanggal/jumlah/bahan/alasan/ajukan berubah (pratinjau lama tidak berlaku); sama bila isian sama", () => {
  const a = { mode: MODE.UBAH, materialId: "m1", qtyBaru: "3", keBahan: null, qtyKe: "", alasan: "Salah catat", tanggal: "2026-10-20", ajukan: false };
  assert.equal(sidikPerubahan(a), sidikPerubahan({ ...a })); assert.equal(sidikPerubahan(a), sidikPerubahan({ ...a, qtyBaru: " 3 ", alasan: " Salah catat " }));
  for (const u of [{ tanggal: "2026-10-21" }, { qtyBaru: "4" }, { alasan: "Lain" }, { ajukan: true }, { keBahan: { materialId: "m2" }, mode: MODE.GANTI }]) assert.notEqual(sidikPerubahan(a), sidikPerubahan({ ...a, ...u }), JSON.stringify(u));
});

test("simpan hanya setelah pratinjau yang boleh, isian tidak berubah, dan (bila ada kemungkinan ganda) pernyataan pemeriksaan; label tombol mengikuti jalur server", () => {
  const pra = { boleh: true, jalur: "LANGSUNG", perluKonfirmasiGanda: false }; const g = { ...pra, perluKonfirmasiGanda: true };
  assert.equal(bolehSimpan(null, "a", "a"), false); assert.equal(bolehSimpan(pra, "a", "a"), true); assert.equal(bolehSimpan(pra, "b", "a"), false, "isian berubah sejak pratinjau");
  assert.equal(bolehSimpan({ ...pra, boleh: false }, "a", "a"), false); assert.equal(bolehSimpan(g, "a", "a"), false); assert.equal(bolehSimpan(g, "a", "a", { sudahPeriksa: true }), true);
  assert.equal(labelJalur({ jalur: "LANGSUNG" }), "Simpan perubahan"); assert.equal(labelJalur({ jalur: "AJUKAN" }), "Ajukan perubahan"); assert.equal(labelJalur(null), "Simpan perubahan");
});

test("badan permintaan: pratinjau memuat tanggal hanya unit terkirim; penerapan membawa alasan + apa yang dilihat (sidik server); pengajuan membawa total yang benar + tanggal", () => {
  const v = { qtyBaru: 3, qtyKe: null, alasan: "Salah catat", tanggal: "2026-10-20" };
  assert.deepEqual(badanPratinjau({ mode: MODE.UBAH, materialId: "m1", v, keBahan: null, ajukan: false }), { materialId: "m1", qtyBaru: 3, tanggalPemakaian: "2026-10-20" });
  assert.deepEqual(badanPratinjau({ mode: MODE.UBAH, materialId: "m1", v: { ...v, tanggal: null }, keBahan: null, ajukan: true }), { materialId: "m1", qtyBaru: 3, ajukan: true });
  const vg = { qtyBaru: 0, qtyKe: 4, alasan: "Salah bahan", tanggal: null }; assert.deepEqual(badanPratinjau({ mode: MODE.GANTI, materialId: "m1", v: vg, keBahan: { materialId: "m2" }, ajukan: false }), { materialId: "m1", qtyBaru: 0, keMaterialId: "m2", qtyKe: 4 });
  const pra = { sidik: { bersih: 5, legs: [{ materialId: "m1", jenis: "RETURN", saldo: 95, hppSidik: "SEKARANG|TANPA|-|HARGA_ISSUE_ASAL" }] } };
  const t = badanPenerapan(pra, { mode: MODE.UBAH, materialId: "m1", v, keBahan: null, sudahPeriksa: true }); assert.equal(t.alasan, "Salah catat"); assert.deepEqual(t.dilihat, pra.sidik); assert.equal(t.konfirmasiBukanGanda, true); assert.ok(!("ajukan" in t));
  assert.deepEqual(badanPengajuan({ materialId: "m1", v }), { materialId: "m1", qtyBaru: 3, alasan: "Salah catat", tanggalPemakaian: "2026-10-20" });
});

test("dampak: satu baris per langkah apa adanya dari server (pengembalian/pengeluaran, stok, Finance, HPP); status AJUKAN = menunggu persetujuan, bukan seolah tersimpan", () => {
  const pra = { langkah: [
    { urutan: 1, jenis: "RETURN", bahan: { kode: "A", nama: "BUSA A", satuan: "KG" }, qty: 5, stok: { saldoSebelum: 95, saldoSesudah: 100 }, finance: { teks: "Jurnal HPP" }, hppOperasional: { teks: "HPP berkurang", status: "DINILAI", tanggalDasar: null } },
    { urutan: 2, jenis: "ISSUE", bahan: { kode: "B", nama: "BUSA B", satuan: "KG" }, qty: 4, stok: { saldoSebelum: null, saldoSesudah: -4 }, finance: { teks: "Celah" }, hppOperasional: { teks: "TANPA_HARGA / belum diketahui", status: "TANPA_HARGA", tanggalDasar: "2026-10-20" } }] };
  const b = barisLangkah(pra); assert.equal(b.length, 2); assert.match(b[0].judul, /Pengembalian ke stok: BUSA A 5 KG/); assert.match(b[1].judul, /Pengeluaran dari stok: BUSA B 4 KG/); assert.equal(b[0].stok, "Stok A: 95 → 100 KG"); assert.equal(b[1].stok, "Stok B: belum diketahui → -4 KG");
  assert.equal(b[1].hppStatus, "TANPA_HARGA"); assert.equal(b[1].tanggalDasar, "2026-10-20");
  assert.match(pesanHasil("AJUKAN", { nomor: "KG-261026-01" }), /DIAJUKAN \(KG-261026-01\).*menunggu persetujuan.*BELUM berubah/); assert.match(pesanHasil("LANGSUNG"), /tersimpan/); assert.match(pesanHasil("LANGSUNG", { ulang: true }), /tidak dicatat dua kali/);
});

test("pengawatan: tombol '+ Tambah pemakaian' tepat di atas tabel; tombol Edit per baris; unit terkirim ikut; jalur resmi + kunci idempotensi + tanpa hapus; label 'Ajukan perubahan'", () => {
  const b = src("features", "production", "bahan", "PemakaianAktualBagian.jsx"); const e = src("features", "production", "bahan", "EditPemakaianForm.jsx"); const o = src("features", "production", "OrderProduksiPanel.jsx"); const api = src("api.js");
  assert.ok(b.indexOf('data-testid="tambah-pemakaian"') > 0 && b.indexOf('data-testid="tambah-pemakaian"') < b.indexOf('data-testid="rencana-vs-aktual"'), "tombol tambah di atas tabel");
  for (const k of ['data-testid="edit-bahan"', "aria-label={`Edit pemakaian ${p.nama}`}", "<EditPemakaianForm", "const terkirim = data.unit.status === \"DELIVERED\"", "bolehTambah = !!izin.pemakaianAktual && (aktif || terkirim)", "edit-menunggu-badge", "data-testid=\"edit-hasil\""]) assert.ok(b.includes(k), k);
  assert.ok(!o.includes('data-testid="rencana-vs-aktual"') && o.includes("PemakaianAktualBagian"), "tabel dipindahkan ke komponen bersama (drawer dan Ruang Kerja memakai yang sama)");
  for (const k of ["api.pratinjauPerubahanPemakaian", "api.perubahanPemakaian", "api.ajukanKoreksiPemakaian", "kunciIdempoten(\"ubah-pemakaian\")", "kirimRef.current", "Lihat dampak", "edit-ajukan", "edit-mode-${k.toLowerCase()}", "Ganti bahan"]) assert.ok(e.includes(k), k);
  assert.ok(!/hapus/i.test(e.replace(/^\s*\/\/.*$/gm, "").replace(/<[^>]+>/g, "").replace(/tidak (pernah )?(diedit atau )?dihapus/gi, "")), "tidak ada aksi hapus");
  for (const k of ["pratinjauPerubahanPemakaian", "/perubahan-pemakaian/pratinjau", "perubahanPemakaian", "Idempotency-Key"]) assert.ok(api.includes(k), k);
  const t = src("features", "production", "bahan", "PembetulanUnitSelesai.jsx"); assert.ok(t.includes("export function Kandidat") && t.includes("JUDUL") && !t.includes("api.ajukanKoreksiPemakaian") && !t.includes("api.pratinjauKoreksiPemakaian"), "panel terkirim kini hanya form Tambah (tiga sumber); koreksi jumlah pindah ke Edit");
});
