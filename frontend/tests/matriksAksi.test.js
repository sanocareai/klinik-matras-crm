// B3.2 — Matriks menu Aksi Finance: tindakan yang benar per status, dan alasan Indonesia bila tidak tersedia.
// Server tetap penentu izin; ini menjaga UI konsisten dengan docs/FINANCE-EDIT-KOREKSI-MATRIKS.md.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aksiDokumenBiaya, aksiTagihan, aksiPembayaranSupplier, aksiKasbon, aksiRefund, aksiTransferAtauPemasukan, aksiUangMuka,
  adalahAdminKeuangan, ALASAN_ADMIN,
} from "../src/features/finance/matriksAksi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (rel) => fs.readFileSync(path.join(__dirname, "..", "src", rel), "utf8");
const cari = (d, key) => d.find((x) => x.key === key);
const admin = { admin: true };
const bukanAdmin = { admin: false };

// Setiap item nonaktif WAJIB punya alasan berbahasa Indonesia (bukan kosong, bukan Inggris umum).
function semuaNonaktifBeralasan(d) {
  for (const x of d) if (!x.aktif) assert.ok(x.alasan && x.alasan.length > 10 && !/^(Not|Cannot|Disabled)/i.test(x.alasan), `alasan kosong/buruk: ${x.key}`);
}

test("Pengeluaran: Menunggu Persetujuan -> Edit; DIBAYAR -> Koreksi; ditolak/dibatalkan -> alasan", () => {
  let d = aksiDokumenBiaya({ status: "MENUNGGU_APPROVAL" }, admin);
  assert.equal(cari(d, "edit").label, "Edit"); assert.ok(cari(d, "edit").aktif);
  assert.ok(cari(d, "tolak").aktif); assert.ok(!cari(d, "batalkan").aktif);
  d = aksiDokumenBiaya({ status: "DIBAYAR" }, admin);
  assert.equal(cari(d, "edit").label, "Koreksi"); assert.ok(cari(d, "edit").aktif); assert.ok(cari(d, "batalkan").aktif);
  d = aksiDokumenBiaya({ status: "DITOLAK" }, admin);
  assert.ok(!cari(d, "edit").aktif); assert.match(cari(d, "edit").alasan, /ditolak/);
  d = aksiDokumenBiaya({ status: "DIBATALKAN" }, admin);
  assert.ok(!cari(d, "edit").aktif); assert.match(cari(d, "edit").alasan, /dibatalkan/);
  semuaNonaktifBeralasan(aksiDokumenBiaya({ status: "DITOLAK" }, admin));
});

test("Pembelian: memakai matriks yang sama (nama pembelian di alasan); DISETUJUI berjurnal -> Koreksi", () => {
  const d = aksiDokumenBiaya({ status: "DISETUJUI" }, { admin: true, nama: "pembelian" });
  assert.equal(cari(d, "edit").label, "Koreksi");
  assert.match(cari(aksiDokumenBiaya({ status: "DITOLAK" }, { admin: true, nama: "pembelian" }), "edit").alasan, /pembelian/);
});

test("Koreksi/Batalkan butuh Admin Keuangan: non-admin melihat item nonaktif dengan alasan izin (Edit pra-jurnal tetap aktif)", () => {
  const d = aksiDokumenBiaya({ status: "DIBAYAR" }, bukanAdmin);
  assert.ok(!cari(d, "edit").aktif); assert.equal(cari(d, "edit").alasan, ALASAN_ADMIN);
  assert.ok(!cari(d, "batalkan").aktif);
  assert.ok(cari(aksiDokumenBiaya({ status: "DRAFT" }, bukanAdmin), "edit").aktif);
  assert.ok(adalahAdminKeuangan({ roles: ["ADMIN"] })); assert.ok(!adalahAdminKeuangan({ roles: ["FINANCE"] }));
});

test("Tagihan supplier: Menunggu -> Edit; Disetujui belum dibayar -> Batalkan & Catat Ulang; Lunas -> alasan pembayaran aktif", () => {
  let d = aksiTagihan({ status: "MENUNGGU_APPROVAL", terbayar: 0 }, admin);
  assert.ok(cari(d, "edit").aktif);
  d = aksiTagihan({ status: "DISETUJUI", terbayar: 0 }, admin);
  assert.equal(cari(d, "batalkan").label, "Batalkan & Catat Ulang"); assert.ok(cari(d, "batalkan").aktif);
  assert.ok(!cari(d, "edit").aktif); assert.match(cari(d, "edit").alasan, /Batalkan & Catat Ulang/);
  d = aksiTagihan({ status: "LUNAS", terbayar: 100 }, admin);
  assert.ok(!cari(d, "batalkan").aktif); assert.match(cari(d, "batalkan").alasan, /Memiliki pembayaran aktif/);
  d = aksiTagihan({ status: "DIBAYAR_SEBAGIAN", terbayar: 50 }, admin);
  assert.match(cari(d, "batalkan").alasan, /Memiliki pembayaran aktif/);
  semuaNonaktifBeralasan(d);
  assert.match(cari(aksiTagihan({ status: "DITOLAK" }, admin), "edit").alasan, /ditolak/);
});

test("Kasbon: Edit Data untuk non-uang; nominal dijelaskan lewat Batalkan & Catat Ulang; pelunasan aktif -> alasan", () => {
  let d = aksiKasbon({ status: "AKTIF", repayments: [] }, admin);
  assert.equal(cari(d, "edit").label, "Edit Data"); assert.ok(cari(d, "edit").aktif); assert.match(cari(d, "edit").hint, /Nominal tidak bisa diubah/);
  assert.equal(cari(d, "batalkan").label, "Batalkan & Catat Ulang"); assert.match(cari(d, "batalkan").hint, /mengubah nominal/);
  d = aksiKasbon({ status: "AKTIF", repayments: [{ cancelledAt: null }] }, admin);
  assert.ok(!cari(d, "batalkan").aktif); assert.match(cari(d, "batalkan").alasan, /pelunasan aktif/);
  assert.match(cari(d, "batalkan").alasan, /Batalkan & Catat Ulang/);
  d = aksiKasbon({ status: "DIBATALKAN", repayments: [] }, admin);
  assert.ok(!cari(d, "edit").aktif); semuaNonaktifBeralasan(d);
});

test("Refund: Menunggu -> Edit; Disetujui -> alasan + Batalkan & Ajukan Ulang; ditolak -> alasan", () => {
  let d = aksiRefund({ status: "MENUNGGU_APPROVAL" }, admin);
  assert.ok(cari(d, "edit").aktif);
  d = aksiRefund({ status: "DISETUJUI" }, admin);
  assert.ok(!cari(d, "edit").aktif); assert.match(cari(d, "edit").alasan, /Batalkan & Ajukan Ulang/);
  assert.equal(cari(d, "batalkan").label, "Batalkan & Ajukan Ulang"); assert.ok(cari(d, "batalkan").aktif);
  semuaNonaktifBeralasan(aksiRefund({ status: "DITOLAK" }, admin));
});

test("Pembayaran supplier: koreksi langsung tidak tersedia (alasan) + Batalkan & Catat Ulang", () => {
  let d = aksiPembayaranSupplier({ cancelledAt: null }, admin);
  assert.ok(!cari(d, "koreksi").aktif); assert.match(cari(d, "koreksi").alasan, /Koreksi langsung tidak tersedia/);
  assert.ok(cari(d, "batalkan").aktif);
  d = aksiPembayaranSupplier({ cancelledAt: "2026-09-25" }, admin);
  assert.ok(!cari(d, "batalkan").aktif); semuaNonaktifBeralasan(d);
});

test("Transfer & Pemasukan Lain: Koreksi + Riwayat + Batalkan; sudah dibatalkan -> alasan", () => {
  let d = aksiTransferAtauPemasukan({ cancelledAt: null }, admin);
  assert.ok(cari(d, "koreksi").aktif); assert.ok(cari(d, "batal").aktif); assert.ok(cari(d, "versi").aktif);
  d = aksiTransferAtauPemasukan({ cancelledAt: "x" }, { admin: true, nama: "pemasukan" });
  assert.match(cari(d, "koreksi").alasan, /Pemasukan sudah dibatalkan/); semuaNonaktifBeralasan(d);
});

test("Uang Muka: edit keterangan; nominal/rekening nonaktif dengan alasan; batal diblokir bila ada pertanggungjawaban aktif", () => {
  let d = aksiUangMuka({ status: "AKTIF", saldo: 100, settlements: [] }, admin);
  assert.ok(cari(d, "edit").aktif); assert.ok(!cari(d, "nominal").aktif); assert.match(cari(d, "nominal").alasan, /Batalkan & Catat Ulang/);
  assert.ok(cari(d, "kembali").aktif); assert.ok(cari(d, "batalkan").aktif);
  d = aksiUangMuka({ status: "SEBAGIAN", saldo: 50, settlements: [{ status: "ACTIVE" }] }, admin);
  assert.ok(!cari(d, "batalkan").aktif); assert.match(cari(d, "batalkan").alasan, /pertanggungjawaban|pengembalian/);
  semuaNonaktifBeralasan(aksiUangMuka({ status: "DIBATALKAN", saldo: 0, settlements: [] }, admin));
});

test("Halaman memakai matriks bersama dan item nonaktif tampil dengan alasan (bukan hanya tooltip)", () => {
  for (const f of ["pages/finance/FinanceExpenses.jsx", "pages/finance/FinancePurchases.jsx", "pages/finance/FinanceSuppliers.jsx", "pages/finance/FinanceKasbon.jsx", "pages/finance/FinanceReceivables.jsx", "pages/finance/FinanceCash.jsx", "pages/finance/FinanceUangMuka.jsx"]) {
    assert.match(baca(f), /bentukItemMenu\(/, `${f} belum memakai bentukItemMenu`);
    assert.match(baca(f), /features\/finance\/matriksAksi\.js/, `${f} belum memakai matriksAksi`);
  }
  assert.match(baca("features/finance/RowActions.jsx"), /hint=\{it\.disabled \? it\.alasan : it\.hint\}/);
  assert.match(baca("components/ui/menu.jsx"), /data-\[disabled\]:opacity-80/);
  assert.match(baca("pages/finance/FinanceSuppliers.jsx"), /aksiPembayaran\(p/);
});

test("Button meneruskan ref (forwardRef): tanpa ini trigger menu Radix tak punya anchor dan menu Aksi tak terlihat", () => {
  const b = baca("components/ui/button.jsx");
  assert.match(b, /React\.forwardRef\(function Button/);
  assert.match(b, /ref=\{ref\}/);
});
