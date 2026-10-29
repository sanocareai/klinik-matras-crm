// Klasifikasi kelengkapan Order Produksi (fungsi MURNI). Empat penyaring: Bahan belum dicatat · Bahan perlu dicek · HPP belum lengkap · Data order kurang.
import test from "node:test";
import assert from "node:assert/strict";
import {
  KELENGKAPAN_KEYS, bahanLayakDinilai, hitungKelengkapan, klasifikasiKelengkapan, lolosKelengkapan, parseKelengkapan, uraikanAlasanCatatan,
} from "../src/lib/domain/kelengkapanOrderProduksi.js";

const kunci = (f) => klasifikasiKelengkapan(f).keys;

test("unit MENUNGGU DIJEMPUT / dalam perjalanan / belum dikerjakan / dibatalkan: bahan TIDAK dianggap kurang", () => {
  for (const unitStatus of ["AWAITING_PICKUP", "IN_TRANSIT_IN"]) assert.deepEqual(kunci({ unitStatus, kerjaKey: "BELUM_DIJADWALKAN" }), [], unitStatus);
  assert.deepEqual(kunci({ unitStatus: "RECEIVED", kerjaKey: "BELUM_DIJADWALKAN" }), []);
  assert.deepEqual(kunci({ unitStatus: "RECEIVED", kerjaKey: "DIJADWALKAN" }), []);
  assert.deepEqual(kunci({ unitStatus: "RECEIVED", kerjaKey: "TERTUNDA" }), [], "tertunda: belum dinilai (tidak menebak)");
  assert.deepEqual(kunci({ unitStatus: "CANCELLED", kerjaKey: "DIBATALKAN" }), []);
  assert.equal(bahanLayakDinilai({ unitStatus: "AWAITING_PICKUP", kerjaKey: "DIKERJAKAN" }), false, "walau status kerja tercatat, unit belum di workshop");
});

test("unit sudah dikerjakan/selesai TANPA catatan pemakaian apa pun → Bahan belum dicatat (+ HPP belum bisa dihitung, bukan nol)", () => {
  for (const [unitStatus, kerjaKey] of [["IN_PRODUCTION", "DIKERJAKAN"], ["RECEIVED", "MENUNGGU_QC"], ["READY_FOR_DELIVERY", "SELESAI"], ["DELIVERED", "SELESAI"], ["RECEIVED", "DIKERJAKAN_ULANG"]]) {
    const k = klasifikasiKelengkapan({ unitStatus, kerjaKey });
    assert.deepEqual(k.keys, ["BAHAN_BELUM_DICATAT", "HPP_BELUM_LENGKAP"], `${unitStatus}/${kerjaKey}`);
    assert.ok(k.items.HPP_BELUM_LENGKAP.alasan.some((a) => a.kode === "HPP_BAHAN_BELUM_DICATAT" && /bukan nol/.test(a.teks)));
    assert.match(k.items.BAHAN_BELUM_DICATAT.alasan[1].teks, /nyatakan secara eksplisit/);
  }
});

test("PERNYATAAN eksplisit 'tanpa bahan baru' menghapus Bahan belum dicatat DAN HPP-karena-bahan; tanpa pernyataan tidak ada tebakan", () => {
  const dgn = klasifikasiKelengkapan({ unitStatus: "DELIVERED", kerjaKey: "SELESAI", pernyataan: { alasan: "Hanya servis jahitan", oleh: "Admin", at: "2026-10-29T01:00:00Z" } });
  assert.deepEqual(dgn.keys, []);
  assert.equal(dgn.pernyataan.alasan, "Hanya servis jahitan"); assert.equal(dgn.pernyataan.oleh, "Admin");
  assert.deepEqual(kunci({ unitStatus: "DELIVERED", kerjaKey: "SELESAI" }), ["BAHAN_BELUM_DICATAT", "HPP_BELUM_LENGKAP"]);
});

test("setiap SUMBER catatan membuat unit 'sudah ada catatan': Gudang (ISSUE), komponen lama, sementara, historis", () => {
  const dasar = { unitStatus: "DELIVERED", kerjaKey: "SELESAI" };
  assert.ok(!kunci({ ...dasar, pemakaian: { baru: 1 } }).includes("BAHAN_BELUM_DICATAT"));
  assert.ok(!kunci({ ...dasar, pemakaian: { lama: 1 } }).includes("BAHAN_BELUM_DICATAT"));
  assert.ok(!kunci({ ...dasar, pemakaian: { sementaraPerlu: 1 } }).includes("BAHAN_BELUM_DICATAT"));
  assert.ok(!kunci({ ...dasar, pemakaian: { sementaraSelesai: 1 } }).includes("BAHAN_BELUM_DICATAT"));
  assert.ok(!kunci({ ...dasar, catatan: { ada: 2 } }).includes("BAHAN_BELUM_DICATAT"), "catatan historis dihitung sebagai catatan ada");
});

test("catatan HISTORIS yang belum diposting dibedakan dari pengeluaran stok resmi: tidak 'belum dicatat', tetapi HPP tertahan", () => {
  const k = klasifikasiKelengkapan({ unitStatus: "DELIVERED", kerjaKey: "SELESAI", catatan: { ada: 3, siapPosting: 2, perluDicek: 0 } });
  assert.deepEqual(k.keys, ["HPP_BELUM_LENGKAP"]);
  const a = k.items.HPP_BELUM_LENGKAP.alasan; assert.equal(a.length, 1); assert.equal(a[0].kode, "HPP_CATATAN_TERTAHAN"); assert.match(a[0].teks, /belum jadi pengeluaran stok resmi/);
});

test("HPP TIDAK lengkap hanya karena catatan yang sudah diinput bernilai: kelengkapan catatan ikut dinilai", () => {
  // semua pergerakan yang ada DINILAI (tidak ada kekurangan harga) → HPP lengkap menurut data yang ada
  assert.deepEqual(kunci({ unitStatus: "DELIVERED", kerjaKey: "SELESAI", pemakaian: { baru: 2 }, hpp: { gerak: 2, hargaBelumDiketahui: 0, perluPenerapan: 0, gagal: 0 } }), []);
  // ... tetapi catatan tertahan di sisi lain membuat HPP belum lengkap walau ISSUE-nya bernilai
  const k = klasifikasiKelengkapan({ unitStatus: "DELIVERED", kerjaKey: "SELESAI", pemakaian: { baru: 2 }, hpp: { gerak: 2 }, catatan: { ada: 1, siapPosting: 1 } });
  assert.deepEqual(k.keys, ["HPP_BELUM_LENGKAP"]);
});

test("HPP belum lengkap: harga belum diketahui, belum dibekukan padahal harga ada, gagal pembekuan, sementara — alasan konkret + jumlah", () => {
  const k = klasifikasiKelengkapan({ unitStatus: "DELIVERED", kerjaKey: "SELESAI", pemakaian: { baru: 6, sementaraPerlu: 1 }, hpp: { gerak: 6, hargaBelumDiketahui: 3, perluPenerapan: 2, gagal: 1 } });
  const kode = k.items.HPP_BELUM_LENGKAP.alasan.map((a) => a.kode);
  assert.deepEqual(kode, ["HPP_HARGA_BELUM_DIKETAHUI", "HPP_BELUM_DITERAPKAN", "HPP_GAGAL_PEMBEKUAN", "HPP_SEMENTARA"]);
  assert.equal(k.items.HPP_BELUM_LENGKAP.alasan[0].jumlah, 3);
  assert.match(k.items.HPP_BELUM_LENGKAP.alasan[0].teks, /harga berlaku bahan belum diisi/);
});

test("Bahan perlu dicek: hanya alasan yang benar-benar ada; satuan, katalog, sementara, dan penanda lain dibedakan", () => {
  assert.ok(!kunci({ unitStatus: "RECEIVED", kerjaKey: "DIJADWALKAN" }).includes("BAHAN_PERLU_DICEK"), "tanpa alasan → tidak ada");
  const k = klasifikasiKelengkapan({
    unitStatus: "DELIVERED", kerjaKey: "SELESAI", pemakaian: { sementaraPerlu: 3 }, sementara: { perluBelumTerpetakan: 2, perluTerpetakan: 1 },
    catatan: { ada: 9, perluDicek: 6, alasan: { katalog: 2, satuan: 1, lain: [{ kode: "SALDO_TIDAK_CUKUP", teks: "Saldo tidak mencukupi.", jumlah: 2 }] } },
  });
  const kode = k.items.BAHAN_PERLU_DICEK.alasan.map((a) => a.kode);
  assert.deepEqual(kode, ["SEMENTARA_BELUM_TERPETAKAN", "SEMENTARA_BELUM_DIREKONSILIASI", "CATATAN_BELUM_TERPETAKAN", "CATATAN_SATUAN_BERMASALAH", "CATATAN_SALDO_TIDAK_CUKUP", "CATATAN_PERLU_DICEK_LAIN"]);
  assert.match(k.items.BAHAN_PERLU_DICEK.alasan[0].teks, /belum terpetakan ke katalog Gudang/);
  assert.equal(k.items.BAHAN_PERLU_DICEK.alasan.at(-1).jumlah, 1, "sisa 'Perlu dicek' yang tak terurai tetap terlihat (6 − 5 = 1)");
});

test("uraikanAlasanCatatan: kelompok katalog/satuan/lain; satu catatan dihitung sekali; INFO tidak dihitung", () => {
  const f = (kode, tingkat = "BLOK", teks = kode) => ({ kode, tingkat, teks });
  const r = uraikanAlasanCatatan([
    [f("NAMA_TIDAK_DI_KATALOG")], [f("BAHAN_GANDA"), f("SATUAN_BEDA_MASTER")], [f("SATUAN_TAK_DIKENAL")], [f("ISSUE_LAMA_SATUAN_BEDA")],
    [f("SALDO_NEGATIF", "BLOK", "Saldo negatif")], [f("SALDO_NEGATIF", "BLOK", "Saldo negatif")], [f("KOMPONEN_LAMA", "INFO")], [],
  ]);
  assert.equal(r.katalog, 2, "yang punya penanda katalog + satuan dihitung sekali di katalog");
  assert.equal(r.satuan, 2);
  assert.deepEqual(r.lain, [{ kode: "SALDO_NEGATIF", teks: "Saldo negatif", jumlah: 2 }]);
});

test("Data order kurang: HANYA kelengkapan PKR yang terbukti; order biasa, target/PIC/rencana bahan opsional, dan PKR lengkap tidak dihitung", () => {
  const pkr = { nomor: "PKR-001", lengkap: false, kurang: ["merk", "ukuran", "alamat"] };
  const k = klasifikasiKelengkapan({ unitStatus: "RECEIVED", kerjaKey: "DIJADWALKAN", pkr });
  assert.deepEqual(k.keys, ["DATA_ORDER_KURANG"]);
  assert.match(k.items.DATA_ORDER_KURANG.alasan[0].teks, /PKR-001 belum lengkap: merk, ukuran, alamat/);
  assert.deepEqual(kunci({ unitStatus: "RECEIVED", kerjaKey: "DIJADWALKAN", pkr: null }), [], "order biasa: tidak dinilai");
  assert.deepEqual(kunci({ unitStatus: "RECEIVED", kerjaKey: "DIJADWALKAN", pkr: { lengkap: true, kurang: [] } }), []);
  assert.deepEqual(kunci({ unitStatus: "CANCELLED", kerjaKey: "DIBATALKAN", pkr }), []);
  // PKR kurang pada unit yang belum dikerjakan tidak menarik kategori bahan/HPP
  assert.ok(!k.keys.includes("BAHAN_BELUM_DICATAT") && !k.keys.includes("HPP_BELUM_LENGKAP"));
});

test("satu unit boleh masuk beberapa kategori; hitungan memisahkan jumlah per kategori dari total gabungan UNIK", () => {
  const a = klasifikasiKelengkapan({ unitStatus: "DELIVERED", kerjaKey: "SELESAI", pkr: { nomor: "P1", lengkap: false, kurang: ["ukuran"] } }); // bahan + HPP + data order
  const b = klasifikasiKelengkapan({ unitStatus: "DELIVERED", kerjaKey: "SELESAI", pemakaian: { baru: 1 }, hpp: { gerak: 1 } }); // lengkap
  const c = klasifikasiKelengkapan({ unitStatus: "DELIVERED", kerjaKey: "SELESAI", catatan: { ada: 1, siapPosting: 1 }, pemakaian: { baru: 1 }, hpp: { gerak: 1 } }); // HPP saja
  assert.deepEqual(a.keys, ["BAHAN_BELUM_DICATAT", "HPP_BELUM_LENGKAP", "DATA_ORDER_KURANG"]);
  const h = hitungKelengkapan([a.keys, b.keys, c.keys]);
  assert.deepEqual(h.counts, { BAHAN_BELUM_DICATAT: 1, BAHAN_PERLU_DICEK: 0, HPP_BELUM_LENGKAP: 2, DATA_ORDER_KURANG: 1 });
  assert.equal(h.unik, 2, "unit unik berkekurangan = 2 (bukan 4)");
});

test("lolosKelengkapan = gabungan (OR) dari kunci terpilih; kosong = tanpa penyaringan; parse hanya kunci dikenal", () => {
  assert.equal(lolosKelengkapan(["HPP_BELUM_LENGKAP"], []), true);
  assert.equal(lolosKelengkapan([], []), true);
  assert.equal(lolosKelengkapan([], ["HPP_BELUM_LENGKAP"]), false);
  assert.equal(lolosKelengkapan(["HPP_BELUM_LENGKAP"], ["BAHAN_BELUM_DICATAT", "HPP_BELUM_LENGKAP"]), true);
  assert.deepEqual(parseKelengkapan("hpp_belum_lengkap, ngawur ,DATA_ORDER_KURANG,hpp_belum_lengkap"), ["HPP_BELUM_LENGKAP", "DATA_ORDER_KURANG"]);
  assert.deepEqual(parseKelengkapan(undefined), []);
  assert.equal(KELENGKAPAN_KEYS.length, 4);
});
