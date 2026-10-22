// Bahan + Ringkasan Ruang Kerja Unit — model murni + pengawatan. Server tetap penentu stok/izin; di sini dijaga aturan layar yang rawan salah:
// dua sumber (bahan baru dari Gudang vs komponen lama dari unit ini) TIDAK dicampur; rencana opsional & tidak otomatis memposting; saldo kurang/tidak diketahui; koreksi berjejak.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HASIL_KOMPONEN, JUDUL_AKTUAL, JUDUL_RENCANA, SUMBER, asalKomponen, batasKoreksi, bolehKonfirmasiAktual, isianAwalDariRencana, jalurKoreksi, keadaanSaldo, peringatanBahan, ringkasBahan, ringkasDokumentasi, tambahAktual,
} from "../src/features/production/bahan/bahanModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const kat = (o = {}) => ({ materialId: "m1", kode: "KAIN-1", nama: "Kain Knit Abu", satuan: "METER", kelompok: { kode: "KAIN", label: "Kain" }, tersedia: 18, saldo: 18, saldoDiketahui: true, ...o });

test("istilah wajib: judul aktual & rencana persis; dua sumber berlabel tegas", () => {
  assert.equal(JUDUL_AKTUAL, "Pemakaian aktual (mengurangi stok saat dikonfirmasi)"); assert.equal(JUDUL_RENCANA, "Rencana (opsional, belum mengurangi stok)");
  assert.equal(SUMBER.BARU.label, "Bahan baru dari Gudang"); assert.equal(SUMBER.LAMA.label, "Komponen lama dari unit ini");
  assert.match(SUMBER.LAMA.dampak, /tidak membuat Material Issue, penerimaan Gudang, pergerakan stok, reservasi, atau biaya bahan baru/); assert.equal(asalKomponen("RES-094-U1"), "Dari kasur pelanggan — RES-094-U1");
});

test("saldo: cukup / kurang (memblokir) / tidak diketahui (peringatan, server yang memutuskan) — tidak pernah tampil sebagai nol", () => {
  assert.equal(keadaanSaldo(kat(), "5").status, "cukup"); assert.equal(keadaanSaldo(kat(), "18").status, "cukup");
  const k = keadaanSaldo(kat({ tersedia: 1.5, saldo: 1.5 }), "5"); assert.equal(k.status, "kurang"); assert.equal(k.blok, true); assert.match(k.teks, /kurang 3,5/);
  const t = keadaanSaldo(kat({ saldoDiketahui: false, tersedia: null, saldo: null }), "1"); assert.equal(t.status, "tidak_diketahui"); assert.equal(t.blok, false); assert.match(t.teks, /Stok belum diketahui/);
  assert.doesNotMatch(t.teks, /\b0\b/);
});

test("isian awal dari rencana: sisa (rencana − sudah dipakai), tanpa duplikat, TIDAK memposting; bahan terpakai penuh dilewati", () => {
  const rencana = [{ materialId: "m1", nama: "A", kode: "A", satuan: "M", qty: 5, tersedia: 9, saldoDiketahui: true }, { materialId: "m2", nama: "B", kode: "B", satuan: "M", qty: 2, tersedia: 3, saldoDiketahui: true }, { materialId: "m3", nama: "C", kode: "C", satuan: "M", qty: 1 }];
  const { baris, dilewati } = isianAwalDariRencana(rencana, [{ materialId: "m1", dipakai: 2 }, { materialId: "m2", dipakai: 2 }], [{ materialId: "m3" }]);
  assert.deepEqual(baris.map((b) => [b.materialId, b.qty]), [["m1", "3"]]); assert.equal(baris[0].dariRencana.rencana, 5); assert.equal(baris[0].dariRencana.sudahDipakai, 2);
  assert.deepEqual(dilewati.map((d) => d.materialId), ["m2"]);
  assert.equal(isianAwalDariRencana([], []).baris.length, 0);
});

test("konfirmasi: butuh jumlah > 0 untuk SETIAP baris, tidak ada saldo kurang; baris yang sudah tercatat tidak dihitung lagi; saldo tidak diketahui boleh dicoba", () => {
  const a = { ...tambahAktual([], kat())[0], qty: "2" };
  assert.equal(bolehKonfirmasiAktual([a]).ok, true); assert.equal(bolehKonfirmasiAktual([{ ...a, qty: "" }]).ok, false); assert.equal(bolehKonfirmasiAktual([{ ...a, qty: "0" }]).ok, false);
  assert.equal(bolehKonfirmasiAktual([{ ...a, qty: "99" }]).ok, false);
  assert.equal(bolehKonfirmasiAktual([{ ...a, qty: "99" }], { m1: { fase: "ok" } }).ok, false, "semua sudah tercatat: tidak ada yang perlu dikirim");
  assert.equal(bolehKonfirmasiAktual([{ ...a, saldoDiketahui: false, tersedia: null }]).ok, true);
  assert.equal(tambahAktual([a], kat()).length, 1, "tanpa duplikat");
});

test("koreksi bahan baru: pengembalian baru ≤ pemakaian bersih; jalur menurut dokumen sumber (langsung / Gudang / sudah koreksi)", () => {
  assert.equal(batasKoreksi({ materialId: "m1", qty: 4 }, [{ materialId: "m1", dipakai: 2.5 }]), 2.5); assert.equal(batasKoreksi({ materialId: "m1", qty: 1 }, [{ materialId: "m1", dipakai: 9 }]), 1); assert.equal(batasKoreksi({ materialId: "x", qty: 1 }, []), 0);
  assert.equal(jalurKoreksi({ tipe: "ISSUE", dokumen: { jenis: "Catat langsung (Produksi)", nomor: "MV-1" } }).jenis, "langsung");
  const g = jalurKoreksi({ tipe: "ISSUE", dokumen: { jenis: "Material Issue Gudang", nomor: "MI-7" } }); assert.equal(g.jenis, "gudang"); assert.match(g.teks, /MI-7/);
  assert.equal(jalurKoreksi({ tipe: "RETURN", dokumen: { jenis: "Catat langsung (Produksi)", nomor: "MV-2" } }).jenis, "pengembalian"); assert.equal(jalurKoreksi({ tipe: "WASTE", dokumen: {} }).jenis, "gudang");
  assert.match(jalurKoreksi({ tipe: "ISSUE", dokumen: { jenis: "Catat langsung (Produksi)", nomor: "MV-1" } }).teks, /tidak diubah atau dihapus/);
});

test("hasil komponen: hanya 'dipakai kembali' yang dihitung pemakaian; dilepas = bukan pemakaian dan tidak masuk stok", () => {
  assert.deepEqual(HASIL_KOMPONEN.map((h) => [h.key, h.pemakaian]), [["REUSED", true], ["RETURNED_TO_CUSTOMER", false], ["KEPT_WITH_UNIT", false], ["DISCARDED", false]]);
  for (const h of HASIL_KOMPONEN.filter((x) => !x.pemakaian)) assert.match(h.bantu, /Bukan pemakaian dan tidak masuk stok perusahaan/);
});

test("Ringkasan Bahan: dua sumber TERPISAH + peringatan hanya yang perlu tindakan; kosong = satu kalimat", () => {
  const data = {
    rencanaBahan: { plan: { revision: 2, lines: [{ materialId: "m1", nama: "Kain Jacquard", qty: 60, tersedia: 20, saldoDiketahui: true }] } },
    pemakaianAktual: { baris: [{ nama: "Kain Knit", qty: 2, satuan: "METER", tanggal: "2026-10-22T04:00:00Z", pelaku: "Rina" }], total: [{ materialId: "m2", dipakai: 2 }] },
    perbandingan: [{ materialId: "m2", nama: "Kain Knit", rencana: 1, aktual: 2 }],
    komponenLama: { items: [{}], dibatalkan: [{}], total: { pemakaianKembali: { jumlahItem: 1 }, dilepasTidakDipakai: { jumlahItem: 2 }, terakhirAt: "2026-10-22T05:00:00Z" } },
  };
  const r = ringkasBahan(data);
  assert.deepEqual(r.rencana, { jumlahItem: 1, revisi: 2 }); assert.equal(r.baru.jumlahCatatan, 1); assert.equal(r.lama.pemakaianKembali, 1); assert.equal(r.lama.dilepas, 2); assert.equal(r.lama.dibatalkan, 1); assert.equal(r.kosong, false);
  assert.deepEqual(r.peringatan.map((p) => p.key), ["lebih-rencana", "stok-kurang"]);
  assert.equal(peringatanBahan({ perbandingan: [{ nama: "A", rencana: null, aktual: 5 }], rencanaBahan: { plan: null } }).length, 0, "tidak direncanakan ≠ melebihi rencana");
  assert.equal(ringkasBahan({ rencanaBahan: { plan: null }, pemakaianAktual: { baris: [], total: [] }, komponenLama: { items: [], dibatalkan: [], total: { pemakaianKembali: { jumlahItem: 0 }, dilepasTidakDipakai: { jumlahItem: 0 }, terakhirAt: null } } }).kosong, true);
});

test("Ringkasan Dokumentasi: jumlah, kategori, terbaru, status bukti yang diwajibkan; bukan QC lulus; alasan jujur bila tak tersedia", () => {
  assert.deepEqual(ringkasDokumentasi({ tersedia: false, alasan: "Belum di alur Meja" }), { tersedia: false, alasan: "Belum di alur Meja" });
  assert.equal(ringkasDokumentasi({ tersedia: true, runId: "r" }, null).memuat, true);
  const d = ringkasDokumentasi({ tersedia: true, bolehUnggah: true }, { docs: { required: 4, satisfied: 3 }, categories: [
    { label: "Sebelum", applicable: true, count: 2, status: "LENGKAP", items: [{ createdAt: "2026-10-20T01:00:00Z", actorName: "A", source: "MANUAL" }] },
    { label: "QC", applicable: true, count: 0, status: "KURANG", missing: 1, items: [] }, { label: "Antar", applicable: false, count: 9, status: "NA", items: [] },
    { label: "Sesudah", applicable: true, count: 1, status: "LENGKAP", items: [{ createdAt: "2026-10-21T03:00:00Z", actorName: "B", source: "TABLE" }] } ] });
  assert.equal(d.jumlahFoto, 3, "kategori tidak berlaku tidak dihitung"); assert.deepEqual(d.kategoriTerisi, ["Sebelum", "Sesudah"]); assert.equal(d.terbaru.kategori, "Sesudah"); assert.deepEqual(d.wajib, { perlu: 4, terpenuhi: 3, kurang: [{ label: "QC", kurang: 1 }] });
  assert.match(d.catatan, /bukan hasil QC/); assert.equal(d.bolehUnggah, true);
});

test("pengawatan: tab Bahan = BahanTab (tindakan utama aktual, rencana terlipat, dua sumber, satu katalog); jalur stok resmi + kunci idempotensi; tanpa tombol hapus; API komponen lama", () => {
  const tab = src("features", "production", "bahan", "BahanTab.jsx"), baru = src("features", "production", "bahan", "CatatBahanBaru.jsx"), lama = src("features", "production", "bahan", "FormKomponenLama.jsx"), daftar = src("features", "production", "bahan", "KomponenLamaDaftar.jsx"), riw = src("features", "production", "bahan", "RiwayatBahanBaru.jsx");
  for (const k of ["JUDUL_AKTUAL", "JUDUL_RENCANA", "Catat pemakaian aktual", 'role="radiogroup"', "sumber-baru".replace("-baru", "") , "rencanaEdit", "aria-expanded={rencanaBuka}", "SUMBER.BARU.label", "SUMBER.LAMA.label"]) assert.ok(tab.includes(k), k);
  assert.ok(tab.includes('data-testid={`sumber-${kunci}`}') && tab.includes('kunci="baru"') && tab.includes('kunci="lama"'));
  assert.ok(!tab.includes("MaterialPlanEditor") || tab.includes("rencanaBuka &&"), "editor rencana hanya dirender saat dibuka (satu katalog pada satu waktu)");
  for (const k of ["api.addUnitMaterial", "kunciIdempoten", "kirimRef.current", "isianAwalDariRencana", "gunakan-rencana", "belum ada yang dicatat", "api.getKatalogBahanProduksi"]) assert.ok(baru.includes(k), k);
  assert.ok(!baru.includes("putRencanaBahan"), "mencatat aktual tidak menulis rencana");
  for (const k of ["api.catatKomponenLama", "api.koreksiKomponenLama", "api.unggahFotoKomponenLama", "kunciIdempoten", "asalKomponen(kodeUnit)", "materialId: f.materialId || undefined"]) assert.ok(lama.includes(k), k);
  assert.ok(!lama.includes("addUnitMaterial"), "komponen lama TIDAK lewat jalur stok");
  for (const k of ["api.batalKomponenLama", "Tidak dijumlahkan dengan bahan baru", "salah input, batalkan".replace("salah", "Salah")]) assert.ok(daftar.includes(k), k);
  assert.ok(!/hapus/i.test(daftar.replace(/^\s*\/\/.*$/gm, "").replace(/<[^>]+>/g, "").replace(/tidak dihapus/gi, "")), "tidak ada aksi hapus pada daftar komponen lama");
  for (const k of ["api.addUnitMaterial", "-Math.round(v * 10000) / 10000", "tidak diedit atau dihapus", "Koreksi atas"]) assert.ok(riw.includes(k), k);
  const api = src("api.js"); for (const k of ["getKomponenLama", "catatKomponenLama", "koreksiKomponenLama", "batalKomponenLama", "unggahFotoKomponenLama", "/komponen-lama"]) assert.ok(api.includes(k), k);
  const ring = src("features", "production", "workspace", "RingkasanUnit.jsx");
  for (const k of ["cuplikan-bahan", "cuplikan-dokumentasi", "kondisi-pelanggan", "catatan-produksi", "komplain-order", "onBagian(\"bahan\")", "onBagian(\"dokumentasi\")", "getProductionV2DocDetail", "lg:row-span-2"]) assert.ok(ring.includes(k), k);
  const ws = src("features", "production", "workspace", "UnitWorkspace.jsx"); for (const k of ["RingkasanUnit", "BahanTab", "riwayat-dua-sumber"]) assert.ok(ws.includes(k), k);
});
