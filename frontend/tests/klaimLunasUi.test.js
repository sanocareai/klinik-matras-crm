// KLAIM LUNAS SALES — kontrak UI web (1 Okt 2026). Logika murni dites langsung; bentuk komponen dikunci lewat teks sumber (pola sama dengan
// rekonSalesFinanceUi.test.js). Penegak sebenarnya tetap server (backend/tests/integration/klaimLunas.integration.test.js).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  lunasDicegat, PESAN_LUNAS_BUTUH_PEMBAYARAN,
  kekuranganForm, bisaDiajukan, alasanNonaktif, opsiStatusBayar, cekBerkas, formDariKlaim, buktiDariKlaim, STATUS_BISA_DIEDIT, METODE_KLAIM,
} from "../src/features/klaim/klaimLunasLogic.js";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(akar, p), "utf8").split("\r\n").join("\n");

const LENGKAP = { paymentDate: "2026-10-01", amount: "1500000", method: "TRANSFER", cashAccountId: "rek-1", note: "Transfer BCA, dicek mutasi" };
const OK = [{ key: "a", status: "tersimpan" }];

test("Tombol nonaktif tanpa catatan / nominal valid / metode / rekening Transfer / bukti", () => {
  assert.equal(bisaDiajukan(LENGKAP, OK), true);
  assert.equal(bisaDiajukan({ ...LENGKAP, note: "" }, OK), false, "tanpa catatan");
  assert.equal(bisaDiajukan({ ...LENGKAP, note: "  " }, OK), false, "catatan kosong spasi");
  assert.equal(bisaDiajukan({ ...LENGKAP, amount: "" }, OK), false, "tanpa nominal");
  assert.equal(bisaDiajukan({ ...LENGKAP, amount: "0" }, OK), false);
  assert.equal(bisaDiajukan({ ...LENGKAP, amount: "-5" }, OK), false);
  assert.equal(bisaDiajukan({ ...LENGKAP, amount: "1500.5" }, OK), false, "bukan bilangan bulat");
  assert.equal(bisaDiajukan({ ...LENGKAP, method: "" }, OK), false, "tanpa metode");
  assert.equal(bisaDiajukan({ ...LENGKAP, cashAccountId: "" }, OK), false, "Transfer wajib rekening");
  assert.equal(bisaDiajukan({ ...LENGKAP, method: "CASH", cashAccountId: "" }, OK), true, "Tunai tanpa rekening dipilih tidak diblokir di UI");
  assert.equal(bisaDiajukan({ ...LENGKAP, paymentDate: "" }, OK), false, "tanpa tanggal");
  assert.equal(bisaDiajukan(LENGKAP, []), false, "tanpa bukti");
});

test("Upload belum selesai / gagal tidak dihitung sebagai bukti; hanya yang dikonfirmasi server ('tersimpan') yang sah", () => {
  assert.equal(bisaDiajukan(LENGKAP, [{ status: "mengunggah" }]), false);
  assert.equal(bisaDiajukan(LENGKAP, [{ status: "gagal" }]), false);
  assert.equal(bisaDiajukan(LENGKAP, [{ status: "tersimpan" }, { status: "mengunggah" }]), false, "masih ada unggahan berjalan");
  assert.equal(bisaDiajukan(LENGKAP, [{ status: "tersimpan" }, { status: "gagal" }]), true, "satu bukti sah cukup; yang gagal dibuang/dicoba lagi");
  assert.equal(alasanNonaktif(LENGKAP, [{ status: "mengunggah" }]), "Menunggu unggahan bukti selesai…");
  assert.equal(alasanNonaktif(LENGKAP, OK), null);
});

test("Double-click: sedang mengirim → tidak bisa diajukan lagi", () => {
  assert.equal(bisaDiajukan(LENGKAP, OK, { mengirim: true }), false);
  assert.equal(alasanNonaktif(LENGKAP, OK, { mengirim: true }), "Sedang mengirim…");
});

test("Kekurangan memberi pesan Bahasa Indonesia per field", () => {
  const k = kekuranganForm({ paymentDate: "", amount: "", method: "", note: "" }, []);
  assert.deepEqual(k.map((x) => x.field), ["paymentDate", "amount", "method", "note", "evidence"]);
  assert.ok(k.find((x) => x.field === "evidence").pesan.includes("Bukti Pembayaran"));
});

test("Opsi 'Lunas' selalu tampil (target yang dikenal Sales) tetapi DICEGAT: tidak menetapkan status, pengguna diarahkan mencatat pembayaran", () => {
  const semua = ["BELUM_BAYAR", "DP", "LUNAS"];
  for (const admin of [false, true]) for (const gate of [false, true]) assert.deepEqual(opsiStatusBayar(semua, "BELUM_BAYAR", admin, gate), semua);
  assert.equal(lunasDicegat({ isAdmin: false, gateAktif: false }), true, "Sales saat MATI: dicegat");
  assert.equal(lunasDicegat({ isAdmin: false, gateAktif: true }), true, "Sales saat AKTIF: dicegat");
  assert.equal(lunasDicegat({ isAdmin: true, gateAktif: true }), true, "Admin saat AKTIF: dicegat (server menolak LUNAS langsung)");
  assert.equal(lunasDicegat({ isAdmin: true, gateAktif: false }), false, "Admin saat MATI: perilaku lama");
  assert.match(PESAN_LUNAS_BUTUH_PEMBAYARAN, /Catat pembayaran dulu/);
  assert.match(PESAN_LUNAS_BUTUH_PEMBAYARAN, /nominal, metode, rekening tujuan, dan bukti pembayaran/);
});

test("Web: memilih Lunas di daftar Order / drawer / form pelanggan memunculkan peringatan, TIDAK memanggil updateOrder, dan membuka tab Pembayaran", () => {
  const orders = baca("src/pages/Orders.jsx");
  assert.match(orders, /newPayment === "LUNAS" && lunasDicegat\(\{ isAdmin, gateAktif: klaimGateAktifHalaman \}\)/);
  assert.match(orders, /setTimelineTab\("pembayaran"\);\s*setTimelineOrder\(order\);\s*return;/);
  assert.match(orders, /tabAwal=\{timelineTab\}/);
  const drawer = baca("src/features/orders/OrderTimelineDrawer.jsx");
  assert.match(drawer, /newStatus === "LUNAS" && lunasDicegat\(/);
  assert.match(drawer, /setTab\(tabAwal \|\| "status"\)/);
  const sec = baca("src/components/customer/OrderSection.jsx");
  assert.match(sec, /v === "LUNAS" && order\.paymentStatus !== "LUNAS" && lunasDicegat\(/);
});

test("Berkas: hanya JPG/PNG/WEBP/PDF sampai 8 MB", () => {
  assert.equal(cekBerkas({ name: "a.png", type: "image/png", size: 1000 }), null);
  assert.equal(cekBerkas({ name: "a.pdf", type: "application/pdf", size: 1000 }), null);
  assert.match(cekBerkas({ name: "a.html", type: "text/html", size: 10 }), /tidak diizinkan/);
  assert.match(cekBerkas({ name: "a.exe", type: "application/octet-stream", size: 10 }), /tidak diizinkan/);
  assert.match(cekBerkas({ name: "besar.png", type: "image/png", size: 9 * 1024 * 1024 }), /maksimal 8 MB/);
});

test("Form dari klaim: default tanggal hari ini & nominal = sisa; klaim tersimpan dipakai apa adanya; bukti tersimpan dipetakan", () => {
  const baru = formDariKlaim(null, { sisa: 750000, hariIni: "2026-10-01" });
  assert.deepEqual(baru, { paymentDate: "2026-10-01", amount: "750000", method: "TRANSFER", cashAccountId: "", note: "" });
  const dari = formDariKlaim({ paymentDate: "2026-09-30", amount: 500000, method: "QRIS", cashAccountId: "r", note: "x" }, { sisa: 1 });
  assert.equal(dari.amount, "500000");
  assert.equal(dari.method, "QRIS");
  assert.deepEqual(buktiDariKlaim({ bukti: [{ id: "b1", nama: "n.png", mime: "image/png", url: "/u" }] }).map((b) => b.status), ["tersimpan"]);
  assert.deepEqual([...STATUS_BISA_DIEDIT], ["DRAFT", "EVIDENCE_REQUESTED", "REJECTED"]);
  assert.deepEqual(METODE_KLAIM.map((m) => m.label), ["Transfer", "QRIS", "Tunai", "Kartu"]);
});

// ── bentuk komponen ────────────────────────────────────────────────────────────────────────────────────────────────

const dialog = baca("src/features/klaim/KlaimLunasDialog.jsx");
const panel = baca("src/features/klaim/KlaimLunasPanel.jsx");
const finance = baca("src/features/finance/KlaimLunasSales.jsx");
const legacy = baca("src/features/finance/LunasBelumDicatat.jsx");

test("Dialog: judul & tombol 'Ajukan Klaim Lunas', istilah 'Bukti Pembayaran' (bukan hanya 'Bukti Transfer'), tombol terkunci oleh bisaDiajukan", () => {
  assert.match(dialog, /"Ajukan Klaim Lunas Resi" : "Ajukan Klaim Lunas"/);
  assert.match(dialog, /Ajukan Klaim Lunas<\/Button>|"Ajukan Klaim Lunas"/);
  assert.match(dialog, /Bukti Pembayaran/);
  assert.doesNotMatch(dialog, /Bukti Transfer/);
  assert.doesNotMatch(dialog, /Tandai Lunas/);
  assert.match(dialog, /disabled=\{!aktifTombol\}/);
  assert.match(dialog, /aktifTombol = bisaDiedit && bisaDiajukan\(form, bukti/);
  // bukti hanya 'tersimpan' setelah respons server
  assert.match(dialog, /status: "tersimpan"/);
  assert.match(dialog, /status: "gagal"/);
  assert.match(dialog, /api\.unggahBuktiKlaimLunas/);
  // mengajukan tidak mengubah status: pesan yang jelas
  assert.match(dialog, /tidak mengubah status pembayaran/);
  // draft boleh disimpan tanpa bukti (tombol Simpan Draft tidak mensyaratkan isian lengkap)
  assert.match(dialog, /Simpan Draft/);
});

test("Dialog: field wajib tersedia — tanggal, nominal, metode, rekening, catatan, bukti; draft dibuat sekali walau unggahan paralel", () => {
  for (const s of ["Tanggal pembayaran", "Nominal yang diklaim", "Metode pembayaran", "Rekening tujuan", "Catatan pembayaran"]) assert.ok(dialog.includes(s), s);
  assert.match(dialog, /membuatDraft\.current/);
  assert.match(dialog, /api\.ajukanKlaimLunas\(id\)/);
});

test("Panel: menggantikan 'Tandai Lunas' — tombol 'Ajukan Klaim Lunas', 'Bukti belum lengkap' untuk klaim lama", () => {
  assert.match(panel, /Ajukan Klaim Lunas/);
  assert.match(panel, /Bukti belum lengkap/);
  assert.match(panel, /Status pembayaran berubah menjadi Lunas setelah Finance memverifikasi/);
});

test("Web: panel terpasang di tab Pembayaran drawer order & form order Pelanggan; dropdown status bayar memakai opsiStatusBayar", () => {
  assert.match(baca("src/features/orders/OrderTimelineDrawer.jsx"), /<KlaimLunasPanel order=\{order\}/);
  assert.match(baca("src/components/customer/OrderSection.jsx"), /<KlaimLunasPanel order=\{order\}/);
  for (const f of ["src/features/orders/PaymentStatusSelect.jsx", "src/pages/Orders.jsx", "src/components/customer/OrderSection.jsx"]) {
    assert.match(baca(f), /opsiStatusBayar\(PAYMENT_STATUSES/, `${f} memfilter opsi Lunas`);
  }
});

test("Finance: Verifikasi / Minta Bukti / Tolak; alasan wajib; verifikasi membuat Payment dari klaim; klaim lama tanda 'Bukti belum lengkap'", () => {
  for (const s of ["Verifikasi", "Minta Bukti", "Tolak", "Bukti Pembayaran"]) assert.ok(finance.includes(s), s);
  assert.match(finance, /api\.mintaBuktiKlaimLunas\(/);
  assert.match(finance, /api\.tolakKlaimLunas\(/);
  assert.match(finance, /api\.verifikasiKlaimLunas\(/);
  assert.match(finance, /sah = alasan\.trim\(\)\.length >= 3/);
  assert.match(finance, /disabled=\{!sah \|\| sibuk\}/);
  assert.match(legacy, /<KlaimLunasSales /);
  assert.match(legacy, /Bukti belum lengkap/);
});

test("Finance: layar sempit memakai daftar kartu (tombol aksi terjangkau tanpa geser horizontal); tabel hanya di md ke atas", () => {
  assert.match(finance, /data-testid="klaim-kartu-mobile"/);
  assert.match(finance, /md:hidden/);
  assert.match(finance, /dh-table hidden md:block/);
});

test("Resi: kartu Resi memakai dialog klaim berbukti (mode resiGroupId), bukan modal klaim lama; tab Pembayaran tidak menawarkan catat Payment langsung ke non-Admin", () => {
  const kartu = baca("src/features/resi/PembayaranResiPelanggan.jsx");
  assert.match(kartu, /<KlaimLunasDialog/);
  assert.match(kartu, /resiGroupId=\{klaim\.groupId\}/);
  assert.match(kartu, /<ModalKlaim/, "modal klaim lama tetap dipakai HANYA saat sakelar MATI");
  assert.match(dialog, /api\.getKlaimLunasResi\(resiGroupId\)/);
  assert.match(dialog, /api\.buatDraftKlaimLunasResi\(resiGroupId/);
  assert.match(baca("src/features/orders/OrderTimelineDrawer.jsx"), /data-testid="catat-pembayaran-via-klaim"/);
  assert.match(finance, /Resi · \{k\.resiInfo/);
});

test("Sakelar rollout: MATI → panel klaim tersembunyi; NYALA → panel tampil; Lunas dicegat di keduanya; gagal baca = MATI", () => {
  const semua = ["BELUM_BAYAR", "DP", "LUNAS"];
  assert.deepEqual(opsiStatusBayar(semua, "BELUM_BAYAR", false, false), semua);
  assert.deepEqual(opsiStatusBayar(semua, "BELUM_BAYAR", true, false), semua);
  assert.deepEqual(opsiStatusBayar(semua, "BELUM_BAYAR", true, true), semua, "Lunas tetap tampil; pemilihannya dicegat (lunasDicegat)");
  assert.match(panel, /if \(gateAktif !== true \|\| !info\) return null;/);
  const hook = baca("src/features/klaim/useKlaimLunasAktif.js");
  assert.match(hook, /api\.getKlaimLunasStatus\(\)\.then\(\(r\) => !!r\?\.aktif\)\.catch\(\(\) => false\)/);
  for (const f of ["src/features/orders/PaymentStatusSelect.jsx", "src/pages/Orders.jsx", "src/components/customer/OrderSection.jsx"]) {
    assert.match(baca(f), /opsiStatusBayar\(PAYMENT_STATUSES, .*(?:gateAktif|klaimGateAktif)\)/, `${f} meneruskan sakelar`);
  }
  assert.match(baca("src/features/orders/OrderTimelineDrawer.jsx"), /klaimGateAktif && !canEditLunas/);
  assert.match(baca("src/features/resi/PembayaranResiPelanggan.jsx"), /gateAktif \? klaim && \(/);
  assert.match(baca("src/features/resi/PembayaranResiPelanggan.jsx"), /<ModalKlaim/, "modal klaim lama tetap untuk sakelar MATI");
});

test("Kartu 'Gerbang Klaim Lunas' di Finance > Pengaturan: status AKTIF/MATI, penjelasan dampak web & aplikasi, konfirmasi sebelum aktif, riwayat audit, nilai 'true'/'false'", () => {
  const set = baca("src/pages/finance/FinanceSettings.jsx");
  assert.match(set, /<KartuGerbangKlaimLunas data=\{settings\?\.klaimLunasGate\}/);
  assert.match(set, /onUbah=\{\(nilai\) => ubahSetting\(K\.KLAIM_LUNAS_GATE_AKTIF, nilai\)\}/);
  assert.match(set, /\{aktif \? "AKTIF" : "MATI"\}/);
  assert.match(set, /confirmText=\{aktif/, "konfirmasi untuk aktifkan DAN matikan");
  assert.match(set, /Aplikasi Sales versi lama akan menerima pesan penolakan|aplikasi Sales versi lama akan menerima pesan penolakan/);
  assert.match(set, /TIDAK dihapus atau diubah/, "mematikan tidak mengubah data");
  assert.match(set, /onUbah\(aktif \? "false" : "true"\)/);
  assert.match(set, /Riwayat perubahan/);
});

test("Bukti pembayaran WAJIB untuk non-Admin (web & mobile) dan dialog verifikasi Finance menampilkan semua data terisi (bukti, nominal, tanggal, metode, rekening, catatan) tanpa isi ulang", () => {
  const drawer = baca("src/features/orders/OrderTimelineDrawer.jsx");
  assert.match(drawer, /const fotoWajib = !canEditLunas/);
  assert.match(drawer, /fotoWajib && !photo\) \{ setFormErr\("Bukti pembayaran wajib dilampirkan/);
  assert.match(drawer, /disabled=\{busy \|\| uploadingPhoto \|\| \(fotoWajib && !photo\)\}/);
  assert.match(drawer, /"Foto Bukti \(wajib\)"/);
  const ver = baca("src/features/finance/KoreksiPembayaran.jsx");
  assert.match(ver, /data-testid="ringkasan-verifikasi"/);
  assert.match(ver, /<BuktiBanyak urls=\{daftarBukti\(p\)\}/);
  assert.match(ver, /data-testid="tanpa-bukti"/);
  for (const s of ["Nominal", "Tanggal diterima", "Cara bayar", "Dicatat oleh", "Catatan: "]) assert.ok(ver.includes(s), s);
  assert.match(ver, /useState\(\{ cashAccountId: p\.cashAccount\?\.id \|\| "", method: p\.method \}\)/, "rekening & cara bayar terisi dari data Sales (masih bisa dikoreksi)");
});
