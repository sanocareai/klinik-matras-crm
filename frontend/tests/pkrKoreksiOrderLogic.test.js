// KOREKSI ORDER PKR (layar): logika murni + pemasangan statis. Aturan sebenarnya ditegakkan server (tes integrasi pkrKoreksiOrder); di sini dikunci bahwa layar
// jujur: hanya perubahan yang dikirim, field terkunci membawa alasan + tindakan, kelebihan bayar menjadi peringatan, dan menu/dialog terpasang.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  JENIS_KOREKSI, SECTION_KOREKSI, statusField, formAwalKoreksi, bodyKoreksiOrder, adaPerubahanOrder, galatKoreksiOrder, alasanValid,
  perluKonfirmasiAdministratif, ringkasDampak, bacaGalatPratinjau,
} from "../src/features/finance/pkrKoreksiOrderLogic.js";

const baca = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const IDENTITAS = {
  legacy: true, customer: { nama: "Bpk. Indra", telepon: null }, alamat: { teks: "Jl. Mawar 5, Bekasi", kota: "Bekasi", lokasiUrl: "", patokan: "" },
  catatan: { keluhan: "", order: "", produksi: "", delivery: "" }, penerima: { berbeda: false },
};
const KEM_LAMA = {
  legacy: true, terpadu: false, revisi: 0,
  progres: { tahapProduksi: "SELESAI", tahapDelivery: "TERJADWAL", unitAktif: 3, unitTerkunci: [] },
  matriks: [
    { kode: "customer", mode: "LANGSUNG", boleh: true, alasan: null, tindakan: null },
    { kode: "alamat", mode: "LANGSUNG", boleh: true, alasan: "Job pengiriman terjadwal akan diperbarui (job yang sama, bukan job baru).", tindakan: null },
    { kode: "spesifikasi", mode: "ADMINISTRATIF", boleh: true, alasan: "Produksi selesai — hanya perbaikan data administratif.", tindakan: null },
    { kode: "jumlah", mode: "TERKUNCI", boleh: false, alasan: "Unit sudah berjalan/selesai.", tindakan: { kode: "TAMBAHAN", label: "Tambah Pesanan Customer", petunjuk: "x" } },
    { kode: "nilai", mode: "KOREKSI_NILAI", boleh: true, alasan: "Nilai diubah lewat dokumen koreksi", tindakan: null },
  ],
  spesifikasi: { merk: "Kasur Sorong 3in1 custom", ukuran: "100 x 200", perluDikirim: true },
  unit: [{ kode: "U1" }, { kode: "U2" }, { kode: "U3" }],
  item: [],
  keuangan: { total: 7_200_000, terbayar: 2_500_000, sisa: 4_700_000, baris: [{ no: 1, nama: "Kasur Sorong 3in1 custom", jumlah: 3, harga: 2_400_000, bisaKoreksiHarga: true, lama: true }] },
};

test("jenis dan section: dua jenis dibedakan tegas; 7 section sesuai urutan form Order CRM", () => {
  assert.deepEqual(Object.keys(JENIS_KOREKSI), ["PERBAIKAN", "TAMBAHAN"]);
  assert.match(JENIS_KOREKSI.PERBAIKAN.label, /salah input/);
  assert.match(JENIS_KOREKSI.TAMBAHAN.label, /permintaan customer/);
  assert.deepEqual(SECTION_KOREKSI.map((s) => s.kode), ["customer", "alamat", "catatan", "item", "kirim", "nilai", "dampak"]);
});

test("matriks: field terkunci membawa ALASAN dan TINDAKAN; mode administratif/nilai terbaca", () => {
  const j = statusField(KEM_LAMA, "jumlah");
  assert.equal(j.terkunci, true);
  assert.equal(j.boleh, false);
  assert.match(j.alasan, /berjalan\/selesai/);
  assert.equal(j.tindakan.kode, "TAMBAHAN");
  assert.equal(statusField(KEM_LAMA, "spesifikasi").mode, "ADMINISTRATIF");
  assert.equal(statusField(KEM_LAMA, "spesifikasi").terkunci, false);
  assert.equal(statusField(KEM_LAMA, "nilai").mode, "KOREKSI_NILAI");
  assert.equal(statusField(KEM_LAMA, "tidak-ada").boleh, true, "kelompok tak dikenal tidak diblokir diam-diam di layar");
});

test("body PERBAIKAN: hanya yang BERUBAH dikirim (merk, ukuran, harga, alamat); tanpa perubahan = kosong", () => {
  const awal = formAwalKoreksi(KEM_LAMA, IDENTITAS);
  const f = structuredClone(awal);
  assert.equal(adaPerubahanOrder(bodyKoreksiOrder("PERBAIKAN", f, awal, KEM_LAMA, null)), false);
  f.spek.merk = "Kasur Sorong Premium";
  f.nilai[1] = "2000000";
  f.pembeli.alamat = "Jl. Kenanga 7, Depok";
  f.konfirmasiAdministratif = true;
  const b = bodyKoreksiOrder("PERBAIKAN", f, awal, KEM_LAMA, null);
  assert.equal(b.jenis, "PERBAIKAN");
  assert.deepEqual(b.spesifikasi, { merk: "Kasur Sorong Premium" });
  assert.deepEqual(b.nilai, [{ no: 1, harga: 2_000_000 }]);
  assert.equal(b.pemenuhan.alamat, "Jl. Kenanga 7, Depok");
  assert.equal(b.konfirmasiAdministratif, true);
  assert.equal(b.jumlah, undefined, "jumlah tidak berubah tidak dikirim");
  assert.equal(adaPerubahanOrder(b), true);
  assert.equal(perluKonfirmasiAdministratif(KEM_LAMA, b), true, "Produksi selesai + perubahan spesifikasi = konfirmasi administratif wajib");
  assert.equal(perluKonfirmasiAdministratif({ ...KEM_LAMA, progres: { ...KEM_LAMA.progres, tahapProduksi: "BELUM_MULAI" } }, b), false);
});

test("body TAMBAHAN: hanya item tambahan; jumlah puluhan untuk satu jenis barang diteruskan; galat ringan", () => {
  const katalog = {
    kategori: [{ kode: "KASUR_BARU", nama: "Kasur Baru", bentuk: "KASUR", jenisKerja: "BARU", produk: [], bundel: false }],
    pemenuhan: [{ kode: "PRODUKSI_BARU", label: "Produksi baru", unit: true }],
    bentuk: { KASUR: { label: "Kasur", produk: { label: "Produk", wajib: true }, dimensi: [{ key: "panjang", label: "Panjang", wajib: true }, { key: "lebar", label: "Lebar", wajib: true }, { key: "tebal", label: "Tebal", wajib: true }], spesifikasi: { label: "Catatan", keras: false } } },
  };
  const f = { tambahan: [{ pemenuhan: "PRODUKSI_BARU", kategori: "KASUR_BARU", produkNama: "Kasur Sano", jumlah: "48", harga: "1500000", panjang: "200", lebar: "100", tebal: "20", perluDikirim: "ya", spesifikasi: "", kunci: "k" }] };
  const b = bodyKoreksiOrder("TAMBAHAN", f, null, KEM_LAMA, katalog);
  assert.equal(b.jenis, "TAMBAHAN");
  assert.equal(b.tambahan.length, 1);
  assert.equal(Number(b.tambahan[0].jumlah), 48);
  assert.equal(adaPerubahanOrder(b), true);
  assert.equal(adaPerubahanOrder({ jenis: "TAMBAHAN", tambahan: [] }), false);
  assert.match(galatKoreksiOrder("TAMBAHAN", { tambahan: [] }, KEM_LAMA, katalog), /minimal satu item/);
});

test("galat ringan: harga kosong/negatif ditolak; jumlah legacy 1–200; alasan minimal 5 karakter", () => {
  const awal = formAwalKoreksi(KEM_LAMA, IDENTITAS);
  const f = structuredClone(awal);
  f.nilai[1] = "";
  assert.match(galatKoreksiOrder("PERBAIKAN", f, KEM_LAMA, null), /harga wajib/);
  f.nilai[1] = "-5";
  assert.match(galatKoreksiOrder("PERBAIKAN", f, KEM_LAMA, null), /0 atau lebih/);
  f.nilai[1] = "2400000"; f.jumlah = "201";
  assert.match(galatKoreksiOrder("PERBAIKAN", f, KEM_LAMA, null), /1–200/);
  f.jumlah = "3";
  assert.equal(galatKoreksiOrder("PERBAIKAN", f, KEM_LAMA, null), null);
  assert.equal(alasanValid("ok"), false);
  assert.equal(alasanValid("Alamat tertukar"), true);
});

test("dampak: Finance/Produksi/Delivery terpisah; kelebihan bayar dari pratinjau ditolak menjadi peringatan + arahan refund", () => {
  const pra = {
    valid: true,
    bagian: [
      { jenis: "PEMBELI", perubahan: [{ label: "Alamat", sebelum: "A", sesudah: "B" }], dampak: { jobDisinkron: 1, jobBaru: 0, customerBaru: false }, peringatan: ["Job terjadwal diperbarui"] },
      { jenis: "spesifikasi", mode: "ADMINISTRATIF", perubahan: { merk: { sebelum: "Lama", sesudah: "Baru" } } },
      { jenis: "NILAI", keuangan: { totalSebelum: 7_200_000, totalSesudah: 6_000_000, selisih: -1_200_000, terbayar: 2_500_000, sisaSesudah: 3_500_000, jurnal: "Jurnal penjualan dibalik lalu diposting ulang" } },
    ],
  };
  const r = ringkasDampak(pra, KEM_LAMA);
  assert.equal(r.customer.length, 1);
  assert.equal(r.delivery.length, 1);
  assert.match(r.delivery[0], /job yang SAMA|job pengiriman/);
  assert.ok(r.produksi.some((t) => /merk: Lama → Baru/.test(t)));
  assert.equal(r.finance[0].selisih, -1_200_000);
  assert.ok(r.peringatan.some((t) => /administratif/i.test(t)));
  assert.ok(r.tidakDibuat.includes("Payment baru") && r.tidakDibuat.includes("Pendapatan CRM"));
  const gagal = bacaGalatPratinjau({ valid: false, galat: { pesan: "Total di bawah pembayaran", kode: "TOTAL_DI_BAWAH_PEMBAYARAN", kelebihanBayar: 2_000_000, petunjuk: "Gunakan Koreksi Pembayaran / Refund resmi" } });
  assert.equal(gagal.kelebihanBayar, 2_000_000);
  assert.match(gagal.petunjuk, /Refund/);
  assert.equal(bacaGalatPratinjau({ valid: true }), null);
});

test("pemasangan: menu Aksi + drawer + dialog + API terpasang (Koreksi Order, Tambah Pesanan, Lengkapi Data Customer, Batalkan, Riwayat)", () => {
  const hal = baca("../src/pages/finance/FinancePenjualanKaryawan.jsx");
  for (const label of ['label: "Koreksi Order"', 'label: "Tambah Pesanan Customer"', '"Lengkapi Data Customer"', 'label: "Batalkan penjualan"', 'label: "Riwayat Perubahan"']) {
    assert.ok(hal.includes(label), `menu Aksi memuat ${label}`);
  }
  for (const tid of ["aksi-koreksi-order", "aksi-tambah-pesanan", "aksi-edit-customer", "aksi-batalkan", "aksi-riwayat"]) assert.ok(hal.includes(`data-testid="${tid}"`), `drawer memuat ${tid}`);
  assert.ok(hal.includes("ModalKoreksiOrderPkr"));
  assert.ok(hal.includes("hidden: !ac.lengkapi || p.sinkron?.order?.spesifikasi?.lengkap === true"), '"Lengkapi spesifikasi" hanya untuk data awal yang kosong');
  const dlg = baca("../src/features/finance/KoreksiOrderPkr.jsx");
  for (const tid of ["seksi-koreksi-", "no={7}", "koreksi-lihat-dampak", "koreksi-terapkan", "koreksi-batal", "dampak-finance", "dampak-produksi", "dampak-delivery", "kunci-spesifikasi", "konfirmasi-administratif"]) {
    assert.ok(dlg.includes(tid), `dialog memuat ${tid}`);
  }
  assert.ok(dlg.includes("<Seksi no={"), "section bernomor");
  const api = baca("../src/api.js");
  for (const fn of ["getKemampuanKoreksiOrder", "pratinjauKoreksiOrderPkr", "koreksiOrderPkr"]) assert.ok(api.includes(`${fn}:`));
  assert.ok(api.includes("/koreksi-order/pratinjau"));
});
