// Klaim Lunas Sales — logika murni aplikasi mobile (1 Okt 2026). Cermin aturan web & server; penegak sebenarnya tetap server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  kekuranganForm, bisaDiajukan, alasanNonaktif, opsiStatusBayar, cekBerkas, formDariKlaim, buktiDariKlaim, bodyDariForm,
  simpanDrafLokal, bacaDrafLokal, hapusDrafLokal, STATUS_BUKTI, METODE_KLAIM, JENIS_BAYAR, nominalOtomatis, jenisAwal, jenisDariNominal, dampakNominal, STATUS_BISA_DIEDIT, lunasDicegat, PESAN_LUNAS_BUTUH_PEMBAYARAN,
} from "../src/lib/klaimLunas.js";

const LENGKAP = { paymentDate: "2026-10-01", amount: "1500000", method: "TRANSFER", cashAccountId: "rek-1", note: "Transfer BCA, dicek mutasi" };
const OK = [{ key: "a", status: STATUS_BUKTI.TERSIMPAN }];
const toko = () => { const m = new Map(); return { getString: (k) => m.get(k), set: (k, v) => m.set(k, v), delete: (k) => m.delete(k), m }; };
const baca = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8").split("\r\n").join("\n");

test("Tombol nonaktif tanpa catatan / nominal valid / metode / rekening Transfer / bukti", () => {
  assert.equal(bisaDiajukan(LENGKAP, OK), true);
  assert.equal(bisaDiajukan({ ...LENGKAP, note: "" }, OK), false);
  assert.equal(bisaDiajukan({ ...LENGKAP, note: "   " }, OK), false);
  assert.equal(bisaDiajukan({ ...LENGKAP, amount: "" }, OK), false);
  assert.equal(bisaDiajukan({ ...LENGKAP, amount: "0" }, OK), false);
  assert.equal(bisaDiajukan({ ...LENGKAP, amount: "12.5" }, OK), false);
  assert.equal(bisaDiajukan({ ...LENGKAP, method: "" }, OK), false);
  assert.equal(bisaDiajukan({ ...LENGKAP, cashAccountId: "" }, OK), false, "Transfer wajib rekening");
  assert.equal(bisaDiajukan({ ...LENGKAP, paymentDate: "" }, OK), false);
  assert.equal(bisaDiajukan(LENGKAP, []), false, "tanpa bukti");
});

test("Bukti antre (offline) / mengunggah / gagal TIDAK dihitung bukti; pengajuan hanya saat semua terunggah dan online", () => {
  assert.equal(bisaDiajukan(LENGKAP, [{ status: STATUS_BUKTI.ANTRE }]), false);
  assert.equal(bisaDiajukan(LENGKAP, [{ status: STATUS_BUKTI.MENGUNGGAH }]), false);
  assert.equal(bisaDiajukan(LENGKAP, [{ status: STATUS_BUKTI.GAGAL }]), false);
  assert.equal(bisaDiajukan(LENGKAP, [...OK, { status: STATUS_BUKTI.ANTRE }]), false, "masih ada bukti yang belum terunggah");
  assert.equal(bisaDiajukan(LENGKAP, [...OK, { status: STATUS_BUKTI.MENGUNGGAH }]), false);
  assert.equal(bisaDiajukan(LENGKAP, [...OK, { status: STATUS_BUKTI.GAGAL }]), true, "bukti gagal dibuang/diulang; satu sah cukup");
  assert.equal(bisaDiajukan(LENGKAP, OK, { online: false }), false, "offline tidak boleh mengajukan");
  assert.match(alasanNonaktif(LENGKAP, OK, { online: false }), /Tidak ada koneksi/);
  assert.match(alasanNonaktif(LENGKAP, [...OK, { status: STATUS_BUKTI.ANTRE }]), /belum terunggah/);
  assert.equal(alasanNonaktif(LENGKAP, OK), null);
});

test("Ketuk ganda: sedang mengirim → tidak bisa diajukan lagi", () => {
  assert.equal(bisaDiajukan(LENGKAP, OK, { mengirim: true }), false);
});

test("Kekurangan memberi pesan per field, menyebut 'Bukti Pembayaran'", () => {
  const k = kekuranganForm({ paymentDate: "", amount: "", method: "", note: "" }, []);
  assert.deepEqual(k.map((x) => x.field), ["paymentDate", "amount", "method", "note", "evidence"]);
  assert.ok(k.at(-1).pesan.includes("Bukti Pembayaran"));
});

test("Chip 'Lunas' selalu tampil tetapi DICEGAT (tidak menetapkan status; diarahkan mencatat pembayaran); Admin saat MATI = perilaku lama", () => {
  const semua = ["BELUM_BAYAR", "DP", "LUNAS"];
  assert.deepEqual(opsiStatusBayar(semua, "BELUM_BAYAR", false), semua);
  assert.equal(lunasDicegat({ isAdmin: false, gateAktif: false }), true);
  assert.equal(lunasDicegat({ isAdmin: false, gateAktif: true }), true);
  assert.equal(lunasDicegat({ isAdmin: true, gateAktif: true }), true);
  assert.equal(lunasDicegat({ isAdmin: true, gateAktif: false }), false);
  assert.equal(PESAN_LUNAS_BUTUH_PEMBAYARAN.tombol, "Catat Pembayaran");
  assert.match(PESAN_LUNAS_BUTUH_PEMBAYARAN.isi, /nominal, metode, rekening tujuan, dan bukti pembayaran/);
});

test("Mobile: Lunas di form order memunculkan Alert + diarahkan ke tab Pembayaran (tanpa mengubah status); kartu order punya jalan pintas Catat Pembayaran & Kirim Dokumentasi; Rincian membuka tab awal", () => {
  const form = baca("../src/components/OrderFormModal.js");
  assert.match(form, /s === "LUNAS" && isEdit && order\?\.paymentStatus !== "LUNAS" && lunasDicegat\(\{ isAdmin: isAdminEditor, gateAktif: klaimGateAktif \}\)/);
  assert.match(form, /tab: "pembayaran", bukaKlaim: true/);
  const kartu = baca("../src/components/OrderCard.js");
  assert.match(kartu, /tab: "pembayaran", bukaKlaim: true/);
  assert.match(kartu, /tab: "dokumentasi"/);
  assert.match(kartu, /order\.paymentStatus !== "LUNAS" && \(/, "Catat Pembayaran hanya untuk order belum lunas");
  assert.match(baca("../src/lib/navigationRef.js"), /tab, bukaKlaim/);
  const rincian = baca("../src/screens/OrderTimelineScreen.js");
  assert.match(rincian, /TABS\.some\(\(t\) => t\.key === tabAwal\) \? tabAwal : "status"/);
  assert.match(rincian, /autoOpen=\{autoBukaKlaim\}/);
  assert.match(baca("../src/components/order/OrderKlaimLunas.js"), /info\.bolehDiklaim \|\| info\.klaimAktifId/);
});

test("Berkas: hanya JPG/PNG/WEBP/PDF sampai 8 MB", () => {
  assert.equal(cekBerkas({ name: "a.jpg", type: "image/jpeg", size: 1000 }), null);
  assert.equal(cekBerkas({ name: "a.pdf", type: "application/pdf", size: 1000 }), null);
  assert.match(cekBerkas({ name: "a.html", type: "text/html", size: 10 }), /tidak diizinkan/);
  assert.match(cekBerkas({ name: "a.heic", type: "image/heic", size: 10 }), /tidak diizinkan/);
  assert.match(cekBerkas({ name: "b.png", type: "image/png", size: 9 * 1024 * 1024 }), /maksimal 8 MB/);
});

test("Form & body: default tanggal/nominal; nilai kosong → null (draf parsial valid di server)", () => {
  const baru = formDariKlaim(null, { sisa: 750000, hariIni: "2026-10-01" });
  assert.deepEqual(baru, { jenis: "PELUNASAN", paymentDate: "2026-10-01", amount: "750000", method: "TRANSFER", cashAccountId: "", note: "" });
  assert.deepEqual(bodyDariForm({ paymentDate: "", amount: "", method: "TRANSFER", cashAccountId: "", note: "" }), { paymentDate: null, amount: null, method: "TRANSFER", cashAccountId: null, note: "" });
  assert.equal(bodyDariForm(LENGKAP).amount, 1500000);
  assert.deepEqual(buktiDariKlaim({ bukti: [{ id: "b", nama: "n", mime: "image/png", url: "/u" }] }).map((b) => b.status), [STATUS_BUKTI.TERSIMPAN]);
  assert.deepEqual(STATUS_BISA_DIEDIT, ["DRAFT", "EVIDENCE_REQUESTED", "REJECTED"]);
  assert.deepEqual(METODE_KLAIM.map((m) => m.label), ["Transfer", "QRIS", "Tunai", "Kartu"]);
});

test("Draf lokal offline: simpan & baca kembali per order; rusak/versi lain diabaikan; hapus membersihkan", () => {
  const s = toko();
  assert.equal(bacaDrafLokal(s, "o1"), null);
  simpanDrafLokal(s, "o1", { form: LENGKAP, foto: [{ uri: "file:///a.jpg", name: "a.jpg", type: "image/jpeg", rahasia: "x" }] });
  const d = bacaDrafLokal(s, "o1");
  assert.deepEqual(d.form, LENGKAP);
  assert.deepEqual(d.foto, [{ uri: "file:///a.jpg", name: "a.jpg", type: "image/jpeg" }], "hanya uri/name/type yang disimpan");
  assert.equal(bacaDrafLokal(s, "o2"), null, "per order");
  s.set("klaim-lunas-draf:o3", "{bukan json");
  assert.equal(bacaDrafLokal(s, "o3"), null);
  s.set("klaim-lunas-draf:o4", JSON.stringify({ v: 9, form: {} }));
  assert.equal(bacaDrafLokal(s, "o4"), null);
  hapusDrafLokal(s, "o1");
  assert.equal(bacaDrafLokal(s, "o1"), null);
  // draf lokal TIDAK menyimpan bukti yang sudah dikonfirmasi server (hanya yang belum terunggah) — diverifikasi di komponen
  assert.match(baca("../src/components/order/OrderKlaimLunas.js"), /b\.status !== STATUS_BUKTI\.TERSIMPAN && b\.file/);
});

test("Komponen: 'Ajukan Klaim Lunas', 'Bukti Pembayaran' (bukan hanya 'Bukti Transfer'), tombol terkunci, terpasang di tab Pembayaran; LUNAS disaring di form order", () => {
  const k = baca("../src/components/order/OrderKlaimLunas.js");
  assert.match(k, /Ajukan Klaim Lunas/);
  assert.match(k, /Bukti Pembayaran/);
  assert.doesNotMatch(k, /Bukti Transfer/);
  assert.doesNotMatch(k, /Tandai Lunas/);
  assert.match(k, /disabled=\{!aktifTombol\}/);
  assert.match(k, /bisaDiajukan\(form, bukti, \{ mengirim, online, sisa: info\?\.sisa \?\? null \}\)/);
  assert.match(k, /testID=\{`jenis-\$\{j\.value\}`\}/);
  assert.match(k, /Ajukan Pembayaran DP/);
  assert.match(k, /testID="dampak-nominal"/);
  assert.match(k, /api\.unggahBuktiKlaimLunas/);
  assert.match(k, /api\.ajukanKlaimLunas\(id, kunciAjukan\.current\)/);
  assert.match(baca("../src/screens/OrderTimelineScreen.js"), /<OrderKlaimLunas order=\{order\}/);
  assert.match(baca("../src/components/OrderFormModal.js"), /opsiStatusBayar\(PAYMENT_STATUSES/);
  assert.match(baca("../src/api.js"), /unggahBuktiKlaimLunas: \(id, file\) => uploadFile\(`\/klaim-lunas\/\$\{id\}\/bukti`, file, \{\}, "berkas"\)/);
});

test("Sakelar rollout mobile: MATI → status bayar lama & form catat pembayaran lama & panel klaim tersembunyi; gagal baca = MATI", () => {
  const semua = ["BELUM_BAYAR", "DP", "LUNAS"];
  assert.deepEqual(opsiStatusBayar(semua, "BELUM_BAYAR", false, false), semua);
  assert.deepEqual(opsiStatusBayar(semua, "BELUM_BAYAR", false, true), semua);
  assert.match(baca("../src/lib/klaimGate.js"), /api\.getKlaimLunasStatus\(\)\.then\(\(r\) => !!r\?\.aktif\)\.catch\(\(\) => false\)/);
  assert.match(baca("../src/components/order/OrderKlaimLunas.js"), /if \(gateAktif !== true \|\| !info\) return null;/);
  assert.match(baca("../src/screens/OrderTimelineScreen.js"), /bolehCatatLangsung = roles\.includes\("ADMIN"\) \|\| !klaimGateAktif/);
  assert.match(baca("../src/components/OrderFormModal.js"), /opsiStatusBayar\(PAYMENT_STATUSES, order\?\.paymentStatus, isAdminEditor, klaimGateAktif\)/);
});

test("Mobile: bukti pembayaran WAJIB untuk non-Admin — tombol Simpan nonaktif & Alert tanpa foto", () => {
  const r = baca("../src/screens/OrderTimelineScreen.js");
  assert.match(r, /const fotoWajib = !roles\.includes\("ADMIN"\)/);
  assert.match(r, /if \(fotoWajib && !draft\.photo\) \{ Alert\.alert\("Bukti pembayaran wajib"/);
  assert.match(r, /Foto bukti bayar \(WAJIB\)/);
  assert.match(r, /disabled=\{busy \|\| \(fotoWajib && !draft\.photo\)\}/);
});

test("Jenis pembayaran DP / Pelunasan: nominal otomatis, jenis dari nominal, dampak jujur, batas sisa", () => {
  assert.equal(nominalOtomatis("PELUNASAN", { sisa: 2090000 }), "2090000");
  assert.equal(nominalOtomatis("DP", { sisa: 2090000, dpTarget: 1000000, dibayar: 0 }), "1000000");
  assert.equal(nominalOtomatis("DP", { sisa: 2090000, dpTarget: 1000000, dibayar: 400000 }), "600000");
  assert.equal(nominalOtomatis("DP", { sisa: 300000, dpTarget: 1000000, dibayar: 0 }), "300000", "DP tidak boleh melebihi sisa");
  assert.equal(nominalOtomatis("DP", { sisa: 2090000, dpTarget: null }), "", "DP belum disepakati → kosong, Sales mengisi sendiri");
  assert.equal(nominalOtomatis("DP", { sisa: 2090000, dpTarget: 1000000, dibayar: 1000000 }), "", "DP sudah terpenuhi");
  assert.equal(jenisAwal({ dpTarget: 1000000, dibayar: 0, sisa: 2090000 }), "DP");
  assert.equal(jenisAwal({ dpTarget: null, dibayar: 0, sisa: 2090000 }), "PELUNASAN", "tanpa DP disepakati = perilaku lama");
  assert.equal(jenisAwal({ dpTarget: 1000000, dibayar: 1000000, sisa: 1090000 }), "PELUNASAN");
  const baru = formDariKlaim(null, { sisa: 2090000, dpTarget: 1000000, dibayar: 0, hariIni: "2026-10-01" });
  assert.equal(baru.jenis, "DP"); assert.equal(baru.amount, "1000000");
  assert.equal(formDariKlaim({ amount: 500000 }, { sisa: 2090000 }).jenis, "DP");
  assert.equal(formDariKlaim({ amount: 2090000 }, { sisa: 2090000 }).jenis, "PELUNASAN");
  assert.equal(jenisDariNominal("500000", { sisa: 2090000 }), "DP");
  assert.equal(jenisDariNominal("2090000", { sisa: 2090000 }), "PELUNASAN");
  assert.deepEqual(JENIS_BAYAR.map((j) => j.label), ["DP", "Pelunasan"]);
  assert.match(dampakNominal("500000", { sisa: 2090000 }).teks, /tercatat sebagai DP.*Rp1\.590\.000/);
  assert.match(dampakNominal("2090000", { sisa: 2090000 }).teks, /berstatus Lunas/);
  assert.equal(dampakNominal("2100000", { sisa: 2090000 }).tingkat, "galat");
  assert.equal(dampakNominal("", { sisa: 2090000 }), null);
  // nominal melebihi sisa tidak bisa diajukan (server juga menolak NOMINAL_MELEBIHI_SISA)
  assert.ok(kekuranganForm({ ...LENGKAP, amount: "2100000" }, OK, { sisa: 2090000 }).some((k) => k.field === "amount"));
  assert.equal(kekuranganForm({ ...LENGKAP, amount: "500000" }, OK, { sisa: 2090000 }).length, 0, "DP (nominal < sisa) boleh diajukan");
  assert.equal(bisaDiajukan({ ...LENGKAP, amount: "500000" }, OK, { sisa: 2090000 }), true);
  assert.equal(bisaDiajukan({ ...LENGKAP, amount: "2100000" }, OK, { sisa: 2090000 }), false);
  assert.equal(kekuranganForm({ ...LENGKAP, amount: "2100000" }, OK).length, 0, "tanpa info sisa, tidak ada batas di sisi klien");
  assert.ok(!("jenis" in bodyDariForm({ ...LENGKAP, jenis: "DP" })), "jenis hanya bantuan UI, tidak dikirim ke server");
});
