// Koreksi Penerimaan — layar: SATU pintu (dialog koreksi yang sama untuk Finance & Gudang), pratinjau dampak dari server wajib dilihat sebelum menyimpan, blokir tampil dengan sebab + arah.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formKoreksiAwal, bodyKoreksi, galatKoreksi, kalimatRiwayat } from "../src/features/kedatangan/kedatanganLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");
const panel = baca("../src/features/kedatangan/PanelKedatangan.jsx");
const api = baca("../src/api.js");

const r = { id: "r1", nomor: "GR-1", status: "COMPLETED", revisi: 2, tanggalTiba: "2026-10-01", penerima: "Budi", catatan: "ok", suratJalan: "SJ-1", bukti: [],
  lines: [{ purchaseOrderLineId: "l1", kode: "BUSA-R50", satuan: "KG", datang: 6, baik: 6, ditolak: 0, pendamping: { satuan: "LEMBAR", mode: "AKTUAL", aktual: 1 }, penggantiDari: { lineId: "asal1", nomor: "GR-0" } }] };

test("formulir: bidang yang bisa dikoreksi mengikuti tahap; hanya yang berubah dikirim; kaitan pengganti dikirim sebagai penggantiDariBarisId", () => {
  const f = formKoreksiAwal(r);
  assert.deepEqual([f.bolehUbahJumlah, f.bolehUbahPeriksa, f.sudahStok], [true, true, true]);
  f.alasan = "Dus keenam salah hitung";
  f.lines[0].jumlahDatang = "5"; f.lines[0].jumlahBaik = "5";
  assert.equal(galatKoreksi(f, r), null);
  assert.deepEqual(bodyKoreksi(f, r).perubahan.lines, [{ purchaseOrderLineId: "l1", jumlahDatang: 5, jumlahBaik: 5 }]);
  f.lines[0].penggantiDariId = "";
  assert.deepEqual(bodyKoreksi(f, r).perubahan.lines[0].penggantiDariBarisId, null, "kosong = lepas kaitan (pengiriman asli)");
  f.lines[0].penggantiDariId = "asal1"; f.lines[0].jumlahLembarTidakDipakai = undefined;
  assert.equal(bodyKoreksi(f, r).perubahan.lines[0].penggantiDariBarisId, undefined, "tidak berubah → tidak dikirim");
  f.lines[0].jumlahDitolak = "2"; f.lines[0].jumlahBaik = "5"; f.lines[0].jumlahDatang = "6";
  assert.match(galatKoreksi(f, r), /melebihi jumlah datang/);
});

test("riwayat: baik, ditolak, kaitan pengganti, dan jalur pembalik+pengganti terbaca manusia", () => {
  const k = kalimatRiwayat({
    jenis: "KEDATANGAN_DIKOREKSI", oleh: "Dewi", workspace: "FINANCE", alasan: "Salah catat",
    sebelum: { lines: [{ purchaseOrderLineId: "l1", kode: "BUSA", datang: 6, baik: 6, ditolak: 0, penggantiDari: null }] },
    sesudah: { jalur: "PEMBALIK_PENGGANTI", jurnalKoreksi: "JU-001", lines: [{ purchaseOrderLineId: "l1", kode: "BUSA", datang: 5, baik: 5, ditolak: 0, penggantiDari: "GR-0" }] },
  });
  assert.match(k, /BUSA: datang 6 → 5/); assert.match(k, /baik 6 → 5/); assert.match(k, /kaitan pengganti pengiriman asli → GR-0/);
  assert.match(k, /pembalik \+ pengganti, jurnal JU-001/);
});

test("dialog koreksi: tombol Simpan hanya aktif setelah 'Lihat Dampak' untuk isian yang SAMA dan hasilnya boleh; pratinjau tanpa Idempotency-Key; penerapan membawa kunci", () => {
  assert.match(panel, /data-testid="lihat-dampak"/);
  assert.match(panel, /disabled=\{!!galatDini \|\| !dampakBerlaku\?\.boleh\}[^>]*data-testid="simpan-koreksi"/);
  assert.match(panel, /dampak\.kunciBody === bodyKini/, "isian berubah → pratinjau lama tidak berlaku");
  assert.match(panel, /api\.pratinjauKoreksiKedatanganFinance\(receipt\.id, body\)/);
  assert.match(panel, /api\.pratinjauKoreksiKedatanganGudang\(receipt\.id, body\)/);
  assert.match(api, /pratinjauKoreksiKedatanganGudang: \(receiptId, data\) => request\([^)]*\{ method: "POST", body: JSON\.stringify\(\{ \.\.\.data, pratinjau: true \}\) \}\)/);
  assert.match(api, /pratinjauKoreksiKedatanganFinance: \(receiptId, data\) => request\([^)]*\{ method: "POST", body: JSON\.stringify\(\{ \.\.\.data, pratinjau: true \}\) \}\)/);
  assert.match(api, /koreksiKedatanganGudang: [^\n]*Idempotency-Key/);
  assert.match(api, /koreksiKedatanganFinance: [^\n]*Idempotency-Key/);
});

test("panel dampak: progres sebelum→sesudah, jatuh tempo, stok, jurnal hanya untuk Finance; blokir menampilkan sebab + yang perlu dilakukan", () => {
  assert.match(panel, /export function DampakKoreksi/);
  for (const id of ["dampak-koreksi", "dampak-progres", "dampak-termin", "dampak-stok", "dampak-jurnal", "dampak-blokir"]) assert.match(panel, new RegExp(`data-testid="${id}"`));
  assert.match(panel, /finance && d\.jurnal/, "nilai rupiah hanya untuk Finance");
  assert.match(panel, /Yang perlu dilakukan: \{b\.arah\}/);
  assert.match(panel, /Koreksi ini diblokir/);
  assert.match(panel, /kaitan pengganti/);
  // satu pintu: tidak ada dialog koreksi kedua / endpoint koreksi baru
  assert.equal((panel.match(/export function ModalKoreksiKedatangan/g) ?? []).length, 1);
  assert.equal((api.match(/koreksi-kedatangan`/g) ?? []).length + (api.match(/penerimaan\/\$\{receiptId\}\/koreksi`/g) ?? []).length, 4, "hanya endpoint koreksi yang sama (koreksi + pratinjau, Finance + Gudang)");
});
