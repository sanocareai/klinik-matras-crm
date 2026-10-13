// NOTA KREDIT / KERINGANAN ORDER — logika murni layar + pemasangan (matriks aksi refund, api, drawer Piutang, halaman).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  JENIS_NOTA, SUMBER_NOTA, KALIMAT_MANDIRI, KALIMAT_TERTAUT, KALIMAT_KONFIRMASI, TANPA_JURNAL,
  kesiapanNotaKredit, paramPratinjau, bodySimpanNota, barisDampak, keteranganJurnal, hariIniWIB, labelStatusBayar, pesanGalatNota,
} from "../src/features/finance/notaKreditLogic.js";
import { aksiRefund, ALASAN_ADMIN } from "../src/features/finance/matriksAksi.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(dir, p), "utf8");
const cari = (d, key) => d.find((x) => x.key === key);

const kandidat = [
  { id: "r1", nomor: "RFD-1", nominal: 200000, potongan: 200000, layak: true },
  { id: "r2", nomor: "RFD-2", nominal: 100000, potongan: 0, layak: false, alasanTidakLayak: "Refund ini mengembalikan kelebihan bayar" },
];
const pratinjau = { revisi: "abc", sebelum: { tagihanBersih: 4300000, pembayaranBersih: 4100000, sisa: 200000, status: "DP", paidAt: null }, sesudah: { tagihanBersih: 4100000, pembayaranBersih: 4100000, sisa: 0, status: "LUNAS", paidAt: "2026-10-09T00:00:00.000Z" }, jurnal: null };

test("daftar jenis & sumber sesuai keputusan Owner; kalimat tertaut menyatakan TIDAK ada jurnal baru", () => {
  assert.deepEqual(SUMBER_NOTA.map(([k]) => k), ["MANDIRI", "TERTAUT_REFUND"]);
  assert.deepEqual(JENIS_NOTA.map(([k]) => k), ["POTONGAN_HARGA", "KERINGANAN"]);
  assert.match(KALIMAT_TERTAUT, /TIDAK membuat jurnal baru/i);
  assert.match(KALIMAT_MANDIRI, /Retur & Potongan/);
  assert.match(KALIMAT_KONFIRMASI.TERTAUT_REFUND, /tidak membuat jurnal baru/);
  assert.equal(TANPA_JURNAL, "Tanpa jurnal—sudah dicatat oleh refund");
});

test("kesiapan: nominal, alasan ≥5, refund layak, batas potongan, pratinjau server & konfirmasi wajib", () => {
  const dasar = { sumber: "TERTAUT_REFUND", amount: 200000, alasan: "triplek tidak jadi", refundId: "r1", konfirmasi: true };
  const konteks = { kandidat, pratinjau };
  assert.equal(kesiapanNotaKredit(dasar, konteks).siap, true);
  assert.match(kesiapanNotaKredit({ ...dasar, refundId: "" }, konteks).pesan, /Pilih refund/);
  assert.match(kesiapanNotaKredit({ ...dasar, refundId: "r2" }, konteks).pesan, /tidak bisa ditautkan/);
  assert.match(kesiapanNotaKredit({ ...dasar, amount: 250000 }, konteks).pesan, /melebihi bagian refund/);
  assert.match(kesiapanNotaKredit({ ...dasar, amount: 0 }, konteks).pesan, /nominal/);
  assert.match(kesiapanNotaKredit({ ...dasar, alasan: " abc " }, konteks).pesan, /minimal 5/);
  assert.match(kesiapanNotaKredit(dasar, { kandidat, pratinjau: null }).pesan, /belum dihitung/);
  assert.match(kesiapanNotaKredit(dasar, { kandidat, pratinjau, memuatPratinjau: true }).pesan, /Menghitung/);
  assert.equal(kesiapanNotaKredit(dasar, { kandidat, pratinjau, galatPratinjau: "melebihi sisa piutang" }).pesan, "melebihi sisa piutang");
  assert.match(kesiapanNotaKredit({ ...dasar, konfirmasi: false }, konteks).pesan, /konfirmasi/i);
  const mandiri = { sumber: "MANDIRI", amount: 50000, alasan: "keringanan Owner", konfirmasi: true };
  assert.equal(kesiapanNotaKredit(mandiri, { kandidat: [], pratinjau }).siap, true);
});

test("query pratinjau & body simpan: hanya kolom yang perlu; refundId hanya untuk tertaut; token revisi dari pratinjau", () => {
  assert.equal(paramPratinjau({ sumber: "MANDIRI", amount: "" }), null);
  assert.equal(paramPratinjau({ sumber: "TERTAUT_REFUND", amount: 1000, refundId: "" }), null);
  assert.deepEqual(paramPratinjau({ sumber: "MANDIRI", jenis: "KERINGANAN", amount: "50000", date: "2026-10-13" }), { amount: 50000, kind: "KERINGANAN", date: "2026-10-13" });
  assert.deepEqual(paramPratinjau({ sumber: "TERTAUT_REFUND", amount: 200000, refundId: "r1" }), { amount: 200000, kind: "POTONGAN_HARGA", refundId: "r1" });
  const b = bodySimpanNota({ sumber: "TERTAUT_REFUND", jenis: "POTONGAN_HARGA", amount: "200000", alasan: "  triplek  ", refundId: "r1", date: "2026-10-13" }, "rev123");
  assert.deepEqual(b, { amount: 200000, kind: "POTONGAN_HARGA", reason: "triplek", refundId: "r1", date: "2026-10-13", revisi: "rev123" });
  assert.equal("refundId" in bodySimpanNota({ sumber: "MANDIRI", amount: 1, alasan: "xxxxx" }, "r"), false);
  assert.equal(hariIniWIB(new Date("2026-10-12T20:00:00Z")), "2026-10-13", "jam 03:00 WIB sudah hari berikutnya");
});

test("tabel dampak: tagihan bersih, pembayaran bersih, sisa, status, paidAt — sebelum & sesudah dari server", () => {
  const b = barisDampak(pratinjau);
  assert.deepEqual(b.map((x) => x.kunci), ["tagihan", "bayar", "sisa", "status", "paidAt"]);
  assert.deepEqual([b[0].sebelum, b[0].sesudah, b[2].sebelum, b[2].sesudah], [4300000, 4100000, 200000, 0]);
  assert.deepEqual([b[3].sebelum, b[3].sesudah], ["Dibayar sebagian", "Lunas"]);
  assert.equal(b[4].sebelum, null); assert.ok(b[4].sesudah);
  assert.deepEqual(barisDampak(null), []);
  assert.equal(labelStatusBayar("BELUM_BAYAR"), "Belum dibayar");
});

test("riwayat: nota tertaut menampilkan 'Tanpa jurnal—sudah dicatat oleh refund'; nota mandiri menampilkan nomor jurnal (+ jurnal balik)", () => {
  assert.equal(keteranganJurnal({ jurnal: null }), "Tanpa jurnal—sudah dicatat oleh refund");
  assert.equal(keteranganJurnal({ jurnal: "JV-1" }), "Jurnal JV-1");
  assert.equal(keteranganJurnal({ jurnal: "JV-1", jurnalBalik: "JV-2" }), "Jurnal JV-1 · dibalik JV-2");
  assert.match(pesanGalatNota({ code: "REVISI_BERUBAH", message: "x" }), /berubah sejak layar dibuka/);
  assert.equal(pesanGalatNota({ message: "melebihi sisa" }), "melebihi sisa");
});

test("matriks aksi refund: 'Buat Nota Kredit' hanya refund DISETUJUI & Admin; nonaktif + alasan bila sudah tertaut", () => {
  const setuju = { status: "DISETUJUI" };
  assert.equal(cari(aksiRefund(setuju, { admin: true }), "notaKredit").aktif, true);
  const bukanAdmin = cari(aksiRefund(setuju, { admin: false }), "notaKredit");
  assert.equal(bukanAdmin.aktif, false); assert.equal(bukanAdmin.alasan, ALASAN_ADMIN);
  const tertaut = cari(aksiRefund({ ...setuju, notaKredit: "NK-13102026-001" }, { admin: true }), "notaKredit");
  assert.equal(tertaut.aktif, false); assert.match(tertaut.alasan, /NK-13102026-001/);
  for (const s of ["MENUNGGU_APPROVAL", "DITOLAK", "DIBATALKAN"]) assert.equal(cari(aksiRefund({ status: s }, { admin: true }), "notaKredit"), undefined, s);
});

test("pemasangan: api, dialog, riwayat, drawer Piutang, halaman Piutang & Refund", () => {
  const api = baca("../src/api.js");
  for (const fn of ["getNotaKreditOrder", "pratinjauNotaKredit", "buatNotaKredit", "pratinjauBatalNotaKredit", "batalNotaKredit"]) assert.match(api, new RegExp(fn), fn);
  assert.match(api, /\/finance\/orders\/\$\{orderId\}\/nota-kredit\/pratinjau/);
  assert.match(api, /\/finance\/nota-kredit\/\$\{id\}\/batal/);
  assert.match(api, /"Idempotency-Key": idempotencyKey \|\| mutationKey\("nota-kredit"\)/);
  const hal = baca("../src/pages/finance/FinanceReceivables.jsx");
  assert.match(hal, /BuatNotaKreditDialog/); assert.match(hal, /RiwayatNotaKredit/); assert.match(hal, /nodeNotaKredit/); assert.match(hal, /notaKredit: \(\) => setNotaUntuk/);
  assert.match(baca("../src/features/finance/PiutangDetail.jsx"), /nodeNotaKredit/);
  const dlg = baca("../src/features/finance/NotaKreditDialog.jsx");
  assert.match(dlg, /pratinjauNotaKredit/); assert.match(dlg, /api\.buatNotaKredit\(orderId, body, kunciRef\.current\.kunci\)/); assert.match(dlg, /pratinjau\.data\.revisi/);
  assert.match(dlg, /api\.batalNotaKredit/); assert.match(dlg, /pratinjauBatalNotaKredit/);
  assert.match(baca("../src/features/finance/RiwayatNotaKredit.jsx"), /keteranganJurnal/);
});
