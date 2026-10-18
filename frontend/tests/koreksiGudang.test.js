// Koreksi Dokumen Gudang (frontend): logika murni + kontrak struktur layar (tanpa DOM). Server tetap pemutus sah/tidak.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adaPerubahan, alasanTidakBolehSetujui, barisPerubahan, bodyPerubahan, bolehBatal, bolehSetujui, formKoreksiAwal, galatForm, JALUR_TAMPIL, kalimatDampak, mengubahStok, STATUS_KOREKSI } from "../src/features/warehouse/koreksi/koreksiLogic.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(dir, "../src", rel), "utf8").replace(/\r\n/g, "\n");

const keadaan = {
  penerimaan: { id: "g1", nomor: "GR-1", status: "COMPLETED", dariPO: false, supplier: "CV Lama", sourceReference: null, deliveryNote: "SJ-1", notes: "n", receivedDate: "2026-10-10" },
  bidangMetadata: ["supplier", "sourceReference", "deliveryNote", "notes", "receivedDate"],
  baris: [{ id: "b1", bahanId: "m1", kode: "KAIN-A", nama: "Kain A", satuan: "METER", jumlahBaikTercatat: 10, jumlahBersih: 10, lokasi: "RAK-A", kondisi: "baik", catatan: null, bisaUbahStok: true },
    { id: "b2", bahanId: "m2", kode: "PAKU", nama: "Paku", satuan: "PCS", jumlahBaikTercatat: 0, jumlahBersih: 0, lokasi: "GUDANG_UTAMA", kondisi: null, catatan: null, bisaUbahStok: false }],
  koreksiTertunda: 0, bisaMengajukan: true,
};

test("formulir awal meniru keadaan server; tanpa perubahan = tidak ada isi untuk dikirim dan galat jelas", () => {
  const f = formKoreksiAwal(keadaan);
  assert.equal(f.baris[0].jumlahBaik, "10"); assert.equal(f.metadata.supplier, "CV Lama"); assert.equal(f.metadata.sourceReference, "");
  assert.deepEqual(bodyPerubahan(f, keadaan), {}); assert.equal(adaPerubahan(bodyPerubahan(f, keadaan)), false);
  assert.equal(galatForm(f, keadaan), "Belum ada yang diubah");
});

test("hanya bidang yang berbeda dikirim; kosong menjadi null; metadata vs stok dibedakan", () => {
  const f = formKoreksiAwal(keadaan);
  f.metadata.supplier = "CV Benar"; f.metadata.notes = ""; f.alasan = "Salah ketik supplier";
  let p = bodyPerubahan(f, keadaan); assert.deepEqual(p, { metadata: { supplier: "CV Benar", notes: null } }); assert.equal(mengubahStok(p), false); assert.equal(galatForm(f, keadaan), "");
  f.baris[0].jumlahBaik = "7"; f.baris[0].lokasi = "RAK-B"; f.baris[0].kondisi = "lecet";
  p = bodyPerubahan(f, keadaan); assert.deepEqual(p.baris, [{ barisId: "b1", jumlahBaik: 7, lokasi: "RAK-B", kondisi: "lecet" }]); assert.equal(mengubahStok(p), true);
  f.baris[0].bahanId = "m9"; assert.equal(bodyPerubahan(f, keadaan).baris[0].bahanId, "m9");
});

test("baris yang stoknya tidak boleh dikoreksi tidak pernah mengirim jumlah/bahan/lokasi (hanya kondisi/catatan)", () => {
  const f = formKoreksiAwal(keadaan); f.baris[1].jumlahBaik = "5"; f.baris[1].lokasi = "X"; f.baris[1].bahanId = "mz"; f.baris[1].kondisi = "ok"; f.alasan = "Perbaiki kondisi baris";
  assert.deepEqual(bodyPerubahan(f, keadaan).baris, [{ barisId: "b2", kondisi: "ok" }]);
});

test("validasi dini: jumlah negatif/bukan angka/lebih dari 4 desimal, lokasi kosong, tanggal salah, alasan pendek/panjang", () => {
  const dasar = () => { const f = formKoreksiAwal(keadaan); f.alasan = "Alasan yang cukup"; return f; };
  let f = dasar(); f.baris[0].jumlahBaik = "-1"; assert.match(galatForm(f, keadaan), /0 atau lebih/);
  f = dasar(); f.baris[0].jumlahBaik = "abc"; assert.match(galatForm(f, keadaan), /0 atau lebih/);
  f = dasar(); f.baris[0].jumlahBaik = "1.23456"; assert.match(galatForm(f, keadaan), /4 desimal/);
  f = dasar(); f.baris[0].lokasi = "   "; f.baris[0].jumlahBaik = "9"; assert.match(galatForm(f, keadaan), /Lokasi/);
  f = dasar(); f.metadata.receivedDate = ""; assert.match(galatForm(f, keadaan), /Tanggal dokumen/);
  f = dasar(); f.metadata.supplier = "B"; f.alasan = "abc"; assert.match(galatForm(f, keadaan), /minimal 5/);
  f = dasar(); f.metadata.supplier = "B"; f.alasan = "x".repeat(501); assert.match(galatForm(f, keadaan), /maksimal 500/);
  f = dasar(); f.metadata.supplier = "B"; assert.equal(galatForm(f, keadaan), "");
});

test("penerimaan dari PO: hanya bidang catatan yang ditawarkan (server menetapkan bidangMetadata); supplier tidak ikut walau diubah", () => {
  const po = { ...keadaan, penerimaan: { ...keadaan.penerimaan, dariPO: true }, bidangMetadata: ["notes"], baris: keadaan.baris.map((b) => ({ ...b, bisaUbahStok: false })) };
  const f = formKoreksiAwal(po); f.metadata.supplier = "Lain"; f.metadata.notes = "catatan baru"; f.alasan = "Perbaiki catatan";
  assert.deepEqual(bodyPerubahan(f, po), { metadata: { notes: "catatan baru" } });
});

test("persetujuan: pemohon tidak bisa menyetujui sendiri; hanya yang menunggu; pembatalan hanya pemohon", () => {
  const k = { status: "PENDING_APPROVAL", pemohon: { id: "u1" } };
  assert.equal(bolehSetujui(k, "u1"), false); assert.equal(bolehSetujui(k, "u2"), true); assert.equal(bolehSetujui({ ...k, status: "POSTED" }, "u2"), false); assert.equal(bolehSetujui(k, null), false);
  assert.equal(bolehBatal(k, "u1"), true); assert.equal(bolehBatal(k, "u2"), false); assert.match(alasanTidakBolehSetujui(k, "u1"), /tidak boleh menyetujui koreksinya sendiri/); assert.equal(alasanTidakBolehSetujui(k, "u2"), "");
});

test("kalimat dampak & baris sebelum–sesudah: diblokir tampil alasan; stok minta persetujuan; data langsung", () => {
  assert.match(kalimatDampak({ boleh: false, penghalang: [{ pesan: "Bahan sudah dipakai" }] }), /^Diblokir: Bahan sudah dipakai/);
  assert.match(kalimatDampak({ boleh: true, dampak: { butuhPersetujuan: true, pergerakanBaru: 2 } }), /menunggu persetujuan orang lain.*2 pergerakan/);
  assert.match(kalimatDampak({ boleh: true, dampak: { butuhPersetujuan: false } }), /langsung dicatat.*tidak berubah/);
  const b = barisPerubahan({ metadata: { sebelum: { supplier: "A" }, sesudah: { supplier: "B" } }, baris: [{ kode: "KAIN-A", sebelum: { jumlahBaik: 10, bahan: "KAIN-A", lokasi: "R1" }, sesudah: { jumlahBaik: 7, bahan: "KAIN-B", lokasi: "R1" } }] });
  assert.deepEqual(b.map((x) => [x.bidang, x.sebelum, x.sesudah]), [["Supplier/pengirim", "A", "B"], ["Jumlah baik", "10", "7"], ["Bahan", "KAIN-A", "KAIN-B"]]);
});

test("label jalur & status lengkap dan memakai varian lencana yang sah", () => {
  const sah = new Set(["neutral", "accent", "red", "orange", "green"]);
  for (const j of ["EDIT_DRAF", "KOREKSI_UI", "ALUR_RESMI", "DIBLOKIR", "FINAL"]) { assert.ok(JALUR_TAMPIL[j].label, j); assert.ok(sah.has(JALUR_TAMPIL[j].warna), j); }
  for (const s of ["PENDING_APPROVAL", "POSTED", "REJECTED", "CANCELLED"]) assert.ok(sah.has(STATUS_KOREKSI[s].warna), s);
});

test("layar: setiap detail dokumen Gudang memuat kartu jalur koreksi; tidak ada tombol 'Edit' umum; Penerimaan membuka dialog koreksi dan alur resmi PO", () => {
  const kartu = {
    "features/warehouse/components/GoodsReceiptDetailDrawer.jsx": 'tipe="GOODS_RECEIPT"', "features/warehouse/dokumen/MaterialIssueDetail.jsx": 'tipe="MATERIAL_ISSUE"',
    "features/warehouse/dokumen/TransferDetail.jsx": 'tipe="STOCK_TRANSFER"', "features/warehouse/dokumen/OpnameDetail.jsx": 'tipe="STOCK_COUNT"',
    "features/warehouse/dokumen/ReturDetail.jsx": 'tipe="RETURN_RECORD"', "features/warehouse/dokumen/RusakDetail.jsx": 'tipe="DAMAGED_STOCK"', "features/warehouse/dokumen/PenyesuaianDetail.jsx": 'tipe="STOCK_ADJUSTMENT"',
  };
  for (const [f, t] of Object.entries(kartu)) { const s = baca(f); assert.match(s, /KartuJalurKoreksi/, f); assert.ok(s.includes(t), f); assert.doesNotMatch(s, />\s*Edit\s*</, `${f}: tidak boleh ada tombol Edit umum`); }
  const gr = baca("features/warehouse/components/GoodsReceiptDetailDrawer.jsx");
  assert.match(gr, /KoreksiPenerimaanModal/); assert.match(gr, /ModalKoreksiKedatangan/); assert.match(gr, /KOREKSI_PENERIMAAN: \(\) => setKoreksiGR\(true\)/); assert.match(gr, /KOREKSI_KEDATANGAN: bukaKoreksiResmi/);
  const kartuSrc = baca("features/warehouse/koreksi/KartuJalurKoreksi.jsx");
  assert.match(kartuSrc, /typeof aksi\[x\.kode\] === "function"/, "tombol hanya untuk aksi yang didukung layar dan diizinkan jalur");
  assert.match(kartuSrc, /Koreksi kesalahan input/); assert.match(kartuSrc, /catatan asal tidak diubah/i);
});

test("dialog koreksi: Idempotency-Key per percobaan, tombol simpan hanya setelah Lihat Dampak yang masih berlaku, tanpa auto-submit; tab Koreksi Dokumen memakai aksi setuju/tolak/batal", () => {
  const m = baca("features/warehouse/koreksi/KoreksiPenerimaanModal.jsx");
  assert.match(m, /api\.pratinjauKoreksiGR/); assert.match(m, /api\.ajukanKoreksiGR\(receiptId, \{ perubahan, alasan: form\.alasan\.trim\(\) \}, kunci\.current\)/);
  assert.match(m, /bodyDampak === bodyKini/, "dampak basi tidak dipakai"); assert.match(m, /disabled=\{!!galatDini \|\| !dampakBerlaku\?\.boleh \|\| memuat\}/);
  assert.match(m, /kunci\.current = kunciBaru\(\)/, "kunci baru setelah gagal"); assert.match(m, /data-testid="dampak-blokir"/); assert.match(m, /Jalan keluar: \{p\.langkah\}/);
  assert.doesNotMatch(m, /useEffect\([^]{0,400}ajukanKoreksiGR/, "tidak ada pengajuan otomatis");
  const t = baca("features/warehouse/koreksi/KoreksiDokumenTab.jsx");
  for (const a of ["setujuiKoreksiGudang", "tolakKoreksiGudang", "batalKoreksiGudang"]) assert.match(t, new RegExp(`api\\.${a}`), a);
  assert.match(t, /bolehMenyetujui\(roles\) && bolehSetujui\(k, u\.id\)/); assert.match(t, /alasanTidakBolehSetujui/);
  const hal = baca("pages/warehouse/WarehouseAdjustments.jsx"); assert.match(hal, /value="koreksi">Koreksi Dokumen/); assert.match(hal, /<KoreksiDokumenTab \/>/);
  const api = baca("api.js"); assert.match(api, /ajukanKoreksiGR: \(id, data, key = mutationKey\("koreksi-gr"\)\)/); assert.match(api, /"Idempotency-Key": key/);
});
