// Pengeluaran & Biaya — logika penyajian murni (tanpa React). Tidak mengubah rumus/status; tampilan diperiksa di browser terpisah.
import test from "node:test";
import assert from "node:assert/strict";
import {
  STATUS_TAB, teksMode, nadaStatus, statusBukti, sumberDana, kalimatBatas, kpiPengeluaran, jumlahFilterAktif,
} from "../src/features/finance/pengeluaranTampilan.js";

test("status proses: semua status lama tetap, dibatalkan tidak dipetakan ke ditolak", () => {
  assert.deepEqual(STATUS_TAB.map((s) => s.key), ["", "MENUNGGU_APPROVAL", "DISETUJUI", "DIBAYAR", "DITOLAK"]);
  assert.equal(nadaStatus("DIBATALKAN"), "neutral");
  assert.notEqual(nadaStatus("DIBATALKAN"), nadaStatus("DITOLAK"));
  assert.equal(nadaStatus("DITOLAK"), "red");
  assert.equal(nadaStatus("STATUS_BARU"), "neutral");
  assert.equal(teksMode("REIMBURSEMENT"), "Reimbursement");
  assert.equal(teksMode(undefined), "—");
});

test("status bukti terpisah dari status proses", () => {
  assert.equal(statusBukti({ status: "DIBAYAR", receiptUrl: "x", receiptVerifiedAt: "2026-10-01" }).kode, "terverifikasi");
  assert.equal(statusBukti({ status: "DIBAYAR", receiptUrl: "x" }).kode, "tersedia");
  assert.equal(statusBukti({ status: "DIBAYAR", notaWajib: true }).kode, "wajib");
  assert.equal(statusBukti({ status: "DIBAYAR" }).kode, "tanpa");
  assert.equal(statusBukti({ status: "DIBAYAR", receiptVerifiedAt: "2026-10-01" }).kode, "tanpa");
});

test("sumber dana: bank dikenali dari bankName rekening aktif; tanpa rekening = Belum dibayar / —", () => {
  const peta = new Map([["a1", { kind: "BANK", bankName: "BCA" }]]);
  const s = sumberDana({ status: "DIBAYAR", mode: "LANGSUNG", cashAccount: { id: "a1", name: "PT Sano", kind: "BANK" } }, peta);
  assert.equal(s.ada, true); assert.equal(s.jenis, "BCA"); assert.equal(s.nama, "PT Sano");
  const tak = sumberDana({ status: "DIBAYAR", cashAccount: { id: "zz", name: "Lama", kind: "BANK" } }, peta);
  assert.equal(tak.jenis, "BANK_LAIN");
  assert.equal(sumberDana({ status: "DISETUJUI", mode: "REIMBURSEMENT" }, peta).teks, "Belum dibayar");
  assert.equal(sumberDana({ status: "DIBAYAR", mode: "LANGSUNG" }, peta).teks, "—");
  assert.equal(sumberDana({ status: "DITOLAK", mode: "REIMBURSEMENT" }, peta).teks, "—");
});

test("kalimat batas: hanya mengaku terpotong bila total server lebih besar dari yang termuat", () => {
  assert.equal(kalimatBatas({ termuat: 300, total: 332, terpotong: true }).teks, "Menampilkan 300 dari 332 pengeluaran");
  assert.equal(kalimatBatas({ termuat: 300, total: 332, terpotong: true }).terpotong, true);
  const pas = kalimatBatas({ termuat: 120, total: 120, terpotong: false });
  assert.equal(pas.teks, "Menampilkan 120 pengeluaran"); assert.equal(pas.terpotong, false); assert.equal(pas.catatan, undefined);
  assert.equal(kalimatBatas({ termuat: 5, total: 3, terpotong: true }).terpotong, false);
});

test("KPI: nilai & populasi mengikuti agregat server (sama dengan halaman lama)", () => {
  const data = { total: 1, ringkasan: { totalAktif: 62000000, jumlahAktif: 321, total: 70000000, jumlahSemua: 332, tidakDihitung: { jumlah: 11 }, perStatus: { MENUNGGU_APPROVAL: { jumlah: 38 }, DISETUJUI: { jumlah: 31 } } } };
  const semua = kpiPengeluaran({ data, status: "", expenses: [] });
  assert.equal(semua.nilai, 62000000); assert.equal(semua.jumlah, 321); assert.equal(semua.labelTotal, "Total pengeluaran");
  assert.equal(semua.tidakDihitung.jumlah, 11); assert.equal(semua.menunggu, 38); assert.equal(semua.disetujui, 31);
  const saring = kpiPengeluaran({ data, status: "DITOLAK", expenses: [] });
  assert.equal(saring.nilai, 70000000); assert.equal(saring.jumlah, 332); assert.equal(saring.labelTotal, "Total di filter ini"); assert.equal(saring.tidakDihitung, null);
  const cadangan = kpiPengeluaran({ data: null, status: "", expenses: [{ status: "MENUNGGU_APPROVAL" }, { status: "DISETUJUI" }, { status: "DISETUJUI" }] });
  assert.equal(cadangan.menunggu, 1); assert.equal(cadangan.disetujui, 2); assert.equal(cadangan.jumlah, 3);
});

test("jumlah filter aktif menghitung hanya yang terisi (pencarian dipangkas)", () => {
  assert.equal(jumlahFilterAktif({}), 0);
  assert.equal(jumlahFilterAktif({ fKategori: "k", fBukti: "wajib", q: "  " }), 2);
  assert.equal(jumlahFilterAktif({ fKategori: "k", fDivisi: "d", fMode: "m", fRekening: "r", fBukti: "b", q: "x" }), 6);
});
