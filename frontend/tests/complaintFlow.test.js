import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_TRANSITIONS, STATUS_LABEL } from "../src/features/complaints/complaintLabels.js";
import {
  TAHAP, TAHAP_STATUS, tahapDari, statusUntukTahap, KEADAAN, PERAN_AKSI, bisaAksi, pesanIzin, labelTransisi, aksiUtama, aksiLain, pilihanCara,
  ringkasTahap, hitungTahap, labelJumlah, ringkasanKeluhan, kasusTutup, STATUS_TUTUP,
} from "../src/features/complaints/complaintFlow.js";
import { ROLE_PERMISSIONS, PERMISSIONS as P } from "../../backend/src/constants/permissions.js";

// Redesign Komplain: 4 tahap + satu aksi utama. Backend tetap memegang status rinci, graf transisi, izin, dan gerbang konfirmasi pelanggan — tes ini mengunci bahwa tampilan TIDAK membuat jalan baru.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SEMUA = Object.keys(STATUS_LABEL);
const TERBUKA = SEMUA.filter((s) => !STATUS_TUTUP.includes(s));
const kasus = (status, extra = {}) => ({ status, description: "Kasur ambles", unit: { id: "u1" }, ...extra });

test("cermin graf transisi frontend IDENTIK dengan backend (services/complaintCase.js)", () => {
  const src = readFileSync(path.join(ROOT, "backend/src/services/complaintCase.js"), "utf8").replace(/\r\n/g, "\n");
  const blok = src.match(/const ALLOWED_TRANSITIONS = (\{[\s\S]*?\n\});/)[1];
  const backend = Function(`"use strict"; return (${blok.replace(/\/\/[^\n]*/g, "")});`)();
  assert.deepEqual(ALLOWED_TRANSITIONS, backend);
});

test("cermin izin aksi = ROLE_PERMISSIONS backend (complaint:write, job:write, inventory:write, qc:write, order:write)", () => {
  const peran = (izin) => Object.entries(ROLE_PERMISSIONS).filter(([, ps]) => ps.includes(izin)).map(([r]) => r).sort();
  assert.deepEqual([...PERAN_AKSI.UBAH_STATUS].sort(), peran(P.COMPLAINT_WRITE));
  assert.deepEqual([...PERAN_AKSI.TUGAS_KIRIM].sort(), peran(P.JOB_WRITE));
  assert.deepEqual([...PERAN_AKSI.MINTA_BAHAN].sort(), peran(P.INVENTORY_WRITE));
  assert.deepEqual([...PERAN_AKSI.TAUTKAN_QC].sort(), peran(P.QC_WRITE));
  assert.deepEqual([...PERAN_AKSI.KONFIRMASI].sort(), peran(P.ORDER_WRITE));
});

test("empat tahap: setiap status terbuka masuk TEPAT satu tahap; status tutup tidak punya tahap; label sesuai permintaan", () => {
  assert.deepEqual(TAHAP.map((t) => t.label), ["Terima & Periksa", "Tentukan Solusi", "Kerjakan & Kirim", "Konfirmasi Pelanggan"]);
  for (const s of TERBUKA) assert.ok([1, 2, 3, 4].includes(tahapDari(s)), s);
  for (const s of STATUS_TUTUP) assert.equal(tahapDari(s), null);
  assert.deepEqual(Object.keys(TAHAP_STATUS).sort(), [...TERBUKA].sort(), "tidak ada status terbuka yang terlewat atau berlebih");
  assert.deepEqual(statusUntukTahap(1), ["BARU", "VERIFIKASI", "INVESTIGASI"]); assert.deepEqual(statusUntukTahap(2), ["ACTION_REQUIRED"]);
  assert.ok(statusUntukTahap(3).includes("MENUNGGU_MATERIAL") && statusUntukTahap(4).includes("MENUNGGU_CUSTOMER"));
  for (const s of SEMUA) assert.ok(KEADAAN[s], `kalimat keadaan ${s}`);
});

test("SATU aksi utama per status terbuka: tujuan selalu transisi SAH dari backend; SELESAI hanya lewat konfirmasi pelanggan", () => {
  for (const s of TERBUKA) for (const resolution of [null, "Ganti lapisan"]) {
    const a = aksiUtama(kasus(s, { resolution })); assert.ok(a, `aksi utama ${s}`); assert.ok(a.label.length > 5); assert.ok(a.bantuan || a.jenis === "status");
    if (a.jenis === "status") assert.ok(ALLOWED_TRANSITIONS[s].includes(a.ke), `${s} → ${a.ke} harus transisi sah`);
    assert.notEqual(a.ke, "SELESAI");
    if (a.jenis === "konfirmasi") assert.equal(s, "KONFIRMASI_CUSTOMER", "konfirmasi hanya dari Konfirmasi Customer");
  }
  assert.equal(aksiUtama(kasus("KONFIRMASI_CUSTOMER")).jenis, "konfirmasi");
  for (const s of TERBUKA.filter((x) => x !== "KONFIRMASI_CUSTOMER")) assert.notEqual(aksiUtama(kasus(s)).jenis, "konfirmasi");
  for (const s of STATUS_TUTUP) { assert.equal(aksiUtama(kasus(s)), null); assert.deepEqual(aksiLain(kasus(s)), []); assert.ok(kasusTutup(kasus(s))); }
});

test("alur normal dari BARU sampai selesai hanya memakai aksi utama dan setiap langkah sah", () => {
  const urutan = ["BARU", "VERIFIKASI", "INVESTIGASI", "ACTION_REQUIRED"]; let s = "BARU"; const jejak = [s];
  for (let i = 0; i < 3; i++) { const a = aksiUtama(kasus(s)); assert.equal(a.jenis, "status"); s = a.ke; jejak.push(s); }
  assert.deepEqual(jejak, urutan);
  const cara = pilihanCara(kasus("ACTION_REQUIRED")).map((c) => c.kunci); assert.deepEqual(cara, ["ambil", "ganti", "bahan", "jadwal"]);
  const lanjut = ["DIJADWALKAN", "DALAM_PENANGANAN", "QC", "SIAP_DIKIRIM", "DIKIRIM_ULANG", "KONFIRMASI_CUSTOMER"]; s = "DIJADWALKAN";
  for (const harap of lanjut.slice(1)) { const a = aksiUtama(kasus(s)); if (a.jenis === "tugasKirim") { assert.equal(a.jobType, "DELIVERY"); s = "DIKIRIM_ULANG"; } else s = a.ke; assert.equal(s, harap); }
});

test("Tindakan lainnya: semua transisi sah (tanpa duplikat dengan aksi utama), lintas divisi bergantung konteks, batalkan terakhir dan bertanda bahaya", () => {
  for (const s of TERBUKA) {
    const lain = aksiLain(kasus(s)); const utama = aksiUtama(kasus(s));
    for (const a of lain.filter((x) => x.jenis === "status" || x.jenis === "batal")) assert.ok(ALLOWED_TRANSITIONS[s].includes(a.ke), `${s} → ${a.ke}`);
    assert.ok(!lain.some((a) => a.jenis === "status" && utama?.jenis === "status" && a.ke === utama.ke), `${s}: aksi utama tidak diulang di Tindakan lainnya`);
    const batal = lain.filter((a) => a.jenis === "batal"); assert.equal(batal.length, 1); assert.equal(batal[0].bahaya, true); assert.equal(lain.at(-1).jenis, "batal");
    assert.ok(lain.some((a) => a.jenis === "mintaBahan") && lain.some((a) => a.jenis === "tindakLanjut"));
    assert.ok(!lain.some((a) => a.ke === "SELESAI"));
  }
  assert.ok(aksiLain(kasus("ACTION_REQUIRED")).every((a) => !["DIJADWALKAN", "SIAP_DIKIRIM"].includes(a.ke)), "cara menangani ada di aksi utama, bukan di daftar lain");
  assert.ok(aksiLain(kasus("QC")).some((a) => a.label === "QC belum lolos — kerjakan lagi"));
  assert.ok(aksiLain(kasus("KONFIRMASI_CUSTOMER")).some((a) => a.label === "Pelanggan belum puas — kerjakan lagi"));
  assert.ok(!aksiLain(kasus("QC", { unit: null })).some((a) => a.jenis === "tautkanQc"), "tautkan QC hanya bila kasus punya unit");
});

test("MENUNGGU_CUSTOMER: bila solusi sudah ada → minta konfirmasi; bila belum → lanjut periksa", () => {
  assert.equal(aksiUtama(kasus("MENUNGGU_CUSTOMER", { resolution: "Ganti kain" })).ke, "KONFIRMASI_CUSTOMER");
  assert.equal(aksiUtama(kasus("MENUNGGU_CUSTOMER", { resolution: null })).ke, "INVESTIGASI");
});

test("izin: aksi mana yang bisa dilakukan peran mana; petunjuk memakai bahasa divisi", () => {
  const sales = { roles: ["SALES"] }; const dispatcher = { roles: ["DISPATCHER"] }; const wh = { roles: ["WAREHOUSE"] }; const qc = { roles: ["QC_LEAD"] }; const driver = { roles: ["DRIVER"] };
  assert.ok(bisaAksi(sales, "UBAH_STATUS") && bisaAksi(sales, "KONFIRMASI") && !bisaAksi(sales, "TUGAS_KIRIM") && !bisaAksi(sales, "MINTA_BAHAN") && !bisaAksi(sales, "TAUTKAN_QC"));
  assert.ok(bisaAksi(dispatcher, "TUGAS_KIRIM") && !bisaAksi(dispatcher, "MINTA_BAHAN")); assert.ok(bisaAksi(wh, "MINTA_BAHAN") && !bisaAksi(wh, "KONFIRMASI")); assert.ok(bisaAksi(qc, "TAUTKAN_QC") && !bisaAksi(qc, "KONFIRMASI"));
  assert.ok(!bisaAksi(driver, "UBAH_STATUS") && !bisaAksi(null, "UBAH_STATUS"));
  assert.match(pesanIzin("TUGAS_KIRIM"), /Delivery/);
  assert.equal(labelTransisi("BARU", "VERIFIKASI"), "Mulai periksa keluhan");
});

test("tampilan kartu: ringkasTahap, hitungTahap dari ringkasan server, label jumlah jujur, ringkasan keluhan terpotong rapi", () => {
  assert.deepEqual(ringkasTahap(kasus("INVESTIGASI")), { tutup: false, no: 1, label: "Terima & Periksa", pendek: "Periksa", dari: 4, keadaan: "Sedang mencari penyebab masalah", tertahan: false });
  assert.equal(ringkasTahap(kasus("MENUNGGU_MATERIAL")).tertahan, true); assert.equal(ringkasTahap(kasus("MENUNGGU_MATERIAL")).no, 3);
  assert.equal(ringkasTahap(kasus("SELESAI")).tutup, true);
  assert.deepEqual(hitungTahap({ BARU: 2, VERIFIKASI: 1, ACTION_REQUIRED: 4, QC: 1, DIJADWALKAN: 2, KONFIRMASI_CUSTOMER: 3, SELESAI: 9, DIBATALKAN: 2 }), { 1: 3, 2: 4, 3: 3, 4: 3 });
  assert.equal(labelJumlah({ tampil: 30, total: 142 }), "Menampilkan 30 dari 142 kasus"); assert.equal(labelJumlah({ tampil: 7, total: 7 }), "Menampilkan semua 7 kasus"); assert.equal(labelJumlah({ tampil: 0, total: 0 }), "Tidak ada kasus");
  assert.equal(ringkasanKeluhan({ description: "a".repeat(200) }, 20).length, 20); assert.equal(ringkasanKeluhan({ description: "  halo\n\n dunia " }), "halo dunia");
});
