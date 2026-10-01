// PARITAS saringan pembayaran: versi layar (frontend/src/features/finance/saringPembayaran.js, fungsi murni yang dipakai halaman Pembayaran & Verifikasi) HARUS memberi hasil
// IDENTIK dengan versi server yang dipakai Export Excel, untuk seluruh kombinasi pencarian + chip. Gagal di sini = layar dan Excel bisa menampilkan baris berbeda.
import test from "node:test";
import assert from "node:assert/strict";
import { saringPembayaran as layar } from "../../frontend/src/features/finance/saringPembayaran.js";
import { saringPembayaran as server } from "../src/services/finance/saringPembayaran.js";

const baris = [
  { id: "1", method: "TRANSFER", amount: 150000, terverifikasi: true, cancelledAt: null, finAllocations: [], proofPhotoUrl: "/m/a.jpg", notes: "DP awal", cashAccount: { id: "r1" }, order: { orderNumber: "RES-1", customer: { name: "Susi Andriani" } }, recordedBy: { name: "Kiki" } },
  { id: "2", method: "CASH", amount: 2250000, terverifikasi: false, cancelledAt: null, finAllocations: [{ orderId: "x" }], proofPhotoUrl: null, notes: null, cashAccount: null, order: { orderNumber: "NEW-2", customer: { name: "Jevi" } }, recordedBy: { name: "Fadlan" } },
  { id: "3", method: "QRIS", amount: 99000, terverifikasi: false, cancelledAt: new Date(), finAllocations: [], proofPhotoUrl: "/m/b.jpg", notes: "salah catat", cashAccount: { id: "r2" }, order: { orderNumber: "SWS-3", customer: { name: "Wahyu" } }, recordedBy: { name: "Kiki" } },
  { id: "4", method: "TRANSFER", amount: 1000, terverifikasi: true, cancelledAt: null, finAllocations: [{ orderId: "y" }, { orderId: "z" }], proofPhotoUrl: "/m/c.jpg", notes: "", cashAccount: { id: "r1" }, order: null, recordedBy: null },
];
// bentuk server: verifikasi sebagai array (tanpa field `terverifikasi`) — hasilnya HARUS sama dengan bentuk layar
const bentukServer = baris.map(({ terverifikasi, ...p }) => ({ ...p, verifications: terverifikasi ? [{ id: "v" }] : [] }));

const kombinasi = [];
for (const q of ["", "susi", "150.000", "150000", "kiki fadlan", "tidak-ada", "dp"]) for (const metode of ["", "TRANSFER", "CASH"]) for (const verif of ["", "terverifikasi", "belum", "dibatalkan"])
  for (const alokasi of ["", "ada", "tanpa"]) for (const bukti of ["", "ada", "tanpa"]) for (const rekening of ["", "r1"]) kombinasi.push({ q, metode, verif, alokasi, bukti, rekening });

test(`Paritas layar = server pada ${kombinasi.length} kombinasi saringan`, () => {
  for (const k of kombinasi) {
    const a = layar(baris, k).map((p) => p.id);
    const b = server(bentukServer, k).map((p) => p.id);
    assert.deepEqual(b, a, JSON.stringify(k));
  }
});

test("Saringan kosong mengembalikan semua baris dalam urutan asli; nilai tak dikenal diabaikan", () => {
  assert.deepEqual(server(bentukServer, {}).map((p) => p.id), ["1", "2", "3", "4"]);
  assert.deepEqual(server(bentukServer, undefined).map((p) => p.id), ["1", "2", "3", "4"]);
  assert.deepEqual(server(null, {}), []);
});

test("Badan fungsi server = badan fungsi layar (hanya komentar kepala yang boleh berbeda)", async () => {
  const fs = await import("node:fs");
  const badan = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n").split("\n").filter((l) => !l.startsWith("//")).join("\n").trim();
  assert.equal(badan("../src/services/finance/saringPembayaran.js"), badan("../../frontend/src/features/finance/saringPembayaran.js"));
});
