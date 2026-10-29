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

// ───────── aturan 1: status resmi unit/order menjadi dasar walau status kerja tertinggal ─────────
import { dasarPenilaianBahan, hitungDataOrder, DATA_ORDER } from "../src/lib/domain/kelengkapanOrderProduksi.js";

test("STATUS RESMI unit Siap Kirim/Terkirim menjadi dasar penilaian bahan walau status kerja tertinggal (Belum dijadwalkan / Tertunda / Dijadwalkan)", () => {
  for (const kerjaKey of ["BELUM_DIJADWALKAN", "DIJADWALKAN", "TERTUNDA", undefined]) {
    for (const unitStatus of ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"]) {
      const k = klasifikasiKelengkapan({ unitStatus, kerjaKey });
      assert.ok(k.keys.includes("BAHAN_BELUM_DICATAT"), `${unitStatus}/${kerjaKey} tidak boleh lolos`);
      assert.equal(k.dasarBahan, "STATUS_RESMI_UNIT");
    }
  }
});

test("STATUS RESMI ORDER (Siap Kirim/Dikirim/Terkirim) menutup unit yang statusnya tertinggal — kasus nyata: unit RECEIVED pada order DELIVERED", () => {
  for (const orderStatus of ["READY", "SHIPPING", "DELIVERED"]) {
    const k = klasifikasiKelengkapan({ unitStatus: "RECEIVED", kerjaKey: "BELUM_DIJADWALKAN", orderStatus });
    assert.deepEqual(k.keys, ["BAHAN_BELUM_DICATAT", "HPP_BELUM_LENGKAP"], orderStatus);
    assert.equal(k.dasarBahan, "STATUS_RESMI_ORDER");
    assert.match(k.items.BAHAN_BELUM_DICATAT.alasan[0].teks, /Status order sudah Siap Kirim atau sesudahnya \(status kerja unit tertinggal\)/);
  }
  // order belum selesai + belum dikerjakan: tetap tidak dinilai; status SEWA tidak dijadikan dasar (belum ada aturan)
  for (const orderStatus of ["PENDING", "PICKUP", "PROCESSING", "SEWA_DIKIRIM", "SEWA_DIAMBIL"]) assert.deepEqual(kunci({ unitStatus: "RECEIVED", kerjaKey: "BELUM_DIJADWALKAN", orderStatus }), [], orderStatus);
});

test("status resmi TIDAK menarik unit yang secara fisik belum tiba atau dibatalkan; dasar bahan 'STATUS_KERJA' hanya bila status resmi belum ada", () => {
  assert.deepEqual(kunci({ unitStatus: "AWAITING_PICKUP", kerjaKey: "SELESAI", orderStatus: "DELIVERED" }), []);
  assert.deepEqual(kunci({ unitStatus: "IN_TRANSIT_IN", kerjaKey: "SELESAI", orderStatus: "READY" }), []);
  assert.deepEqual(kunci({ unitStatus: "CANCELLED", kerjaKey: "DIBATALKAN", orderStatus: "DELIVERED" }), []);
  assert.equal(dasarPenilaianBahan({ unitStatus: "IN_PRODUCTION", kerjaKey: "DIKERJAKAN", orderStatus: "PROCESSING" }).dasar, "STATUS_KERJA");
  assert.deepEqual(dasarPenilaianBahan({ unitStatus: "RECEIVED", kerjaKey: "TERTUNDA", orderStatus: "PROCESSING" }), { dinilai: false, dasar: null });
});

// ───────── aturan 2: "Belum dinilai" ≠ lengkap ─────────
test("data order tanpa aturan wajib = BELUM DINILAI (bukan lengkap, bukan kurang); PKR lengkap = LENGKAP; PKR kurang = KURANG; dibatalkan = tidak berlaku", () => {
  const biasa = klasifikasiKelengkapan({ unitStatus: "RECEIVED", kerjaKey: "DIJADWALKAN", pkr: null });
  assert.equal(biasa.dataOrder.status, "BELUM_DINILAI"); assert.match(biasa.dataOrder.teks, /belum punya aturan kelengkapan wajib/); assert.match(biasa.dataOrder.teks, /Bukan berarti lengkap/);
  assert.deepEqual(biasa.keys, [], "tidak dihitung sebagai kekurangan");
  assert.equal(biasa.ringkas, "Tidak ada kekurangan terdeteksi · Data order belum dinilai", "ringkasan TIDAK menyebut 'Lengkap'");
  assert.equal(klasifikasiKelengkapan({ unitStatus: "RECEIVED", kerjaKey: "DIJADWALKAN", pkr: { lengkap: true, kurang: [] } }).dataOrder.status, "LENGKAP");
  const kurang = klasifikasiKelengkapan({ unitStatus: "RECEIVED", kerjaKey: "DIJADWALKAN", pkr: { nomor: "P1", lengkap: false, kurang: ["ukuran"] } });
  assert.equal(kurang.dataOrder.status, "KURANG"); assert.match(kurang.dataOrder.teks, /P1 belum lengkap: ukuran/);
  assert.equal(klasifikasiKelengkapan({ unitStatus: "CANCELLED", kerjaKey: "DIBATALKAN" }).dataOrder.status, "TIDAK_BERLAKU");
  assert.equal(klasifikasiKelengkapan({ unitStatus: "DELIVERED", kerjaKey: "SELESAI", pemakaian: { baru: 1 }, hpp: { gerak: 1 }, pkr: { lengkap: true, kurang: [] } }).ringkas, "Lengkap menurut aturan saat ini", "'Lengkap' hanya bila data order benar-benar dinilai lengkap");
  assert.deepEqual(hitungDataOrder(["LENGKAP", "KURANG", "BELUM_DINILAI", "BELUM_DINILAI", "TIDAK_BERLAKU", undefined]), { lengkap: 1, kurang: 1, belumDinilai: 2 });
  assert.equal(DATA_ORDER.BELUM_DINILAI.label, "Belum dinilai");
});

// ───────── aturan 3: pernyataan tidak menyembunyikan masalah setelah catatan bahan ditambahkan ─────────
test("pernyataan 'tanpa bahan baru' + catatan bahan KEMUDIAN ada → BERTENTANGAN: Bahan perlu dicek (alasan konkret), tidak lengkap diam-diam, HPP dinilai dari catatan nyata", () => {
  const pern = { alasan: "Hanya servis jahitan", oleh: "Admin", at: "2026-10-29T01:00:00Z" };
  for (const sumber of [{ pemakaian: { baru: 1 }, hpp: { gerak: 1, hargaBelumDiketahui: 1 } }, { pemakaian: { sementaraPerlu: 1 }, sementara: { perluBelumTerpetakan: 1 } }, { pemakaian: { lama: 1 } }, { catatan: { ada: 2, siapPosting: 1 } }]) {
    const k = klasifikasiKelengkapan({ unitStatus: "DELIVERED", kerjaKey: "SELESAI", pernyataan: pern, ...sumber });
    assert.ok(k.pernyataanBertentangan); assert.ok(k.keys.includes("BAHAN_PERLU_DICEK"), JSON.stringify(sumber));
    assert.equal(k.items.BAHAN_PERLU_DICEK.alasan[0].kode, "PERNYATAAN_BERTENTANGAN"); assert.match(k.items.BAHAN_PERLU_DICEK.alasan[0].teks, /dinyatakan tanpa bahan baru oleh Admin, tetapi sekarang ada catatan pemakaian bahan/);
    assert.ok(!k.keys.includes("BAHAN_BELUM_DICATAT"));
  }
  const hpp = klasifikasiKelengkapan({ unitStatus: "DELIVERED", kerjaKey: "SELESAI", pernyataan: pern, pemakaian: { baru: 1 }, hpp: { gerak: 1, hargaBelumDiketahui: 1 } });
  assert.deepEqual(hpp.keys, ["BAHAN_PERLU_DICEK", "HPP_BELUM_LENGKAP"], "HPP tetap dinilai dari catatan yang ada");
  // pernyataan tanpa catatan = tidak bertentangan (menggantikan kekurangan); unit belum selesai pun bertentangan bila ada catatan
  assert.deepEqual(kunci({ unitStatus: "DELIVERED", kerjaKey: "SELESAI", pernyataan: pern }), []);
  assert.ok(kunci({ unitStatus: "RECEIVED", kerjaKey: "BELUM_DIJADWALKAN", pernyataan: pern, pemakaian: { baru: 1 }, hpp: { gerak: 1 } }).includes("BAHAN_PERLU_DICEK"));
  assert.equal(klasifikasiKelengkapan({ unitStatus: "CANCELLED", pernyataan: pern, pemakaian: { baru: 1 } }).pernyataanBertentangan, false);
});
