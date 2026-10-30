// Penyaring kelengkapan Order Produksi — model murni + pengawatan komponen (tanpa DOM). Server tetap penentu klasifikasi/hitungan; klien hanya menampilkan dan mengirim parameter.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DASAR_PERIODE_TEKS, KELENGKAPAN_FILTER, KELENGKAPAN_KEYS, bacaHitungKelengkapan, kunciKelengkapan, parameterDaftar, pesanGalatPernyataan, sasaranLengkapi, teksPeriode, toggleKelengkapan, validasiPeriode,
} from "../src/features/production/orderProduksiModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");

test("empat penyaring cepat berlabel pendek, urut tetap, dengan penjelasan yang memuat batasnya", () => {
  assert.deepEqual(KELENGKAPAN_FILTER.map((k) => k.label), ["Bahan belum dicatat", "Bahan perlu dicek", "HPP belum lengkap", "Data order kurang"]);
  assert.deepEqual(KELENGKAPAN_KEYS, ["BAHAN_BELUM_DICATAT", "BAHAN_PERLU_DICEK", "HPP_BELUM_LENGKAP", "DATA_ORDER_KURANG"]);
  const bantu = Object.fromEntries(KELENGKAPAN_FILTER.map((k) => [k.key, k.bantu]));
  assert.match(bantu.BAHAN_BELUM_DICATAT, /belum tiba atau belum dikerjakan tidak dihitung/);
  assert.match(bantu.HPP_BELUM_LENGKAP, /bukan nilai persediaan\/biaya Finance/);
  assert.match(bantu.DATA_ORDER_KURANG, /Target, PIC, dan rencana bahan bersifat opsional/);
});

test("parameterDaftar: kelengkapan/periode/urutan ikut dikirim (daftar = ekspor); nilai kosong dan urutan bawaan tidak", () => {
  assert.deepEqual(parameterDaftar({}), {});
  const p = parameterDaftar({ q: "RES-1", kerja: ["SELESAI"], kelengkapan: ["HPP_BELUM_LENGKAP", "DATA_ORDER_KURANG"], dari: "2026-10-01", sampai: "2026-10-28", urut: "terlama" });
  assert.deepEqual(p, { q: "RES-1", statusKerja: "SELESAI", kelengkapan: "HPP_BELUM_LENGKAP,DATA_ORDER_KURANG", dari: "2026-10-01", sampai: "2026-10-28", urut: "terlama" });
  assert.equal(parameterDaftar({ urut: "terbaru" }).urut, undefined, "urutan bawaan tidak dikirim");
  assert.equal(parameterDaftar({ kelengkapan: [] }).kelengkapan, undefined);
});

test("toggleKelengkapan: gabungan bebas urutan klik, tersusun menurut urutan tetap, tanpa duplikat", () => {
  let t = []; t = toggleKelengkapan(t, "DATA_ORDER_KURANG"); t = toggleKelengkapan(t, "BAHAN_BELUM_DICATAT");
  assert.deepEqual(t, ["BAHAN_BELUM_DICATAT", "DATA_ORDER_KURANG"]);
  assert.deepEqual(toggleKelengkapan(t, "DATA_ORDER_KURANG"), ["BAHAN_BELUM_DICATAT"]);
  assert.deepEqual(toggleKelengkapan(["BAHAN_BELUM_DICATAT"], "BAHAN_BELUM_DICATAT"), []);
});

test("sasaranLengkapi: bahan → Pemakaian aktual; HPP/data order → bagian Kelengkapan; lengkap → tidak ada tombol", () => {
  assert.equal(sasaranLengkapi(["BAHAN_BELUM_DICATAT", "HPP_BELUM_LENGKAP"]), "bahan");
  assert.equal(sasaranLengkapi(["BAHAN_PERLU_DICEK"]), "bahan");
  assert.equal(sasaranLengkapi(["HPP_BELUM_LENGKAP"]), "kelengkapan");
  assert.equal(sasaranLengkapi(["DATA_ORDER_KURANG"]), "kelengkapan");
  assert.equal(sasaranLengkapi([]), null);
  assert.equal(sasaranLengkapi(undefined), null);
  assert.deepEqual(kunciKelengkapan({ adopsi: {} }), [], "payload lama tanpa kelengkapan: jujur kosong");
});

test("bacaHitungKelengkapan: angka dari server apa adanya; kunci hilang jadi 0; tidak menurunkan dari baris", () => {
  const h = bacaHitungKelengkapan({ counts: { BAHAN_BELUM_DICATAT: 7, HPP_BELUM_LENGKAP: 9 }, unik: 10, totalUnit: 120, riwayat: { unik: 3, totalUnit: 40 } });
  assert.deepEqual(h.counts, { BAHAN_BELUM_DICATAT: 7, BAHAN_PERLU_DICEK: 0, HPP_BELUM_LENGKAP: 9, DATA_ORDER_KURANG: 0 });
  assert.equal(h.unik, 10); assert.equal(h.totalUnit, 120); assert.equal(h.riwayat.unik, 3);
  assert.deepEqual(bacaHitungKelengkapan(null).counts, { BAHAN_BELUM_DICATAT: 0, BAHAN_PERLU_DICEK: 0, HPP_BELUM_LENGKAP: 0, DATA_ORDER_KURANG: 0 });
});

test("validasiPeriode: format dan urutan dari ≤ sampai; galat dibaca pengguna; kosong valid", () => {
  assert.equal(validasiPeriode("", ""), ""); assert.equal(validasiPeriode("2026-10-01", ""), ""); assert.equal(validasiPeriode("", "2026-10-28"), "");
  assert.equal(validasiPeriode("2026-10-01", "2026-10-01"), "", "satu hari valid");
  assert.match(validasiPeriode("2026-10-10", "2026-10-01"), /tidak boleh lebih besar/);
  assert.match(validasiPeriode("10-10-2026", ""), /Tanggal awal tidak valid/);
  assert.match(validasiPeriode("", "kemarin"), /Tanggal akhir tidak valid/);
  assert.equal(teksPeriode("", ""), "Semua tanggal"); assert.equal(teksPeriode("a", "b"), "a – b"); assert.equal(teksPeriode("a", ""), "sejak a"); assert.equal(teksPeriode("", "b"), "sampai b");
  assert.equal(DASAR_PERIODE_TEKS, "Tanggal order masuk (unit dibuat)");
});

test("pesanGalatPernyataan: kode server → kalimat jelas; kode tak dikenal memakai pesan server", () => {
  assert.match(pesanGalatPernyataan({ code: "ALASAN_WAJIB" }), /minimal 5 huruf/);
  assert.match(pesanGalatPernyataan({ code: "SUDAH_ADA_CATATAN_BAHAN" }), /sudah punya catatan pemakaian bahan/);
  assert.equal(pesanGalatPernyataan({ code: "X", message: "Pesan server" }), "Pesan server");
  assert.match(pesanGalatPernyataan(null), /Gagal menyimpan/);
});

test("pengawatan daftar: hitungan dari server, filter+periode+urutan dikirim ke daftar DAN ekspor (satu paramDaftar), hitungan dimuat ulang setelah reload, buka drawer tidak menulis", () => {
  const p = src("pages", "bengkel", "ProductionWorkOrders.jsx");
  assert.ok(p.includes("api.getKelengkapanHitung(paramHitung)"), "hitungan dari server");
  assert.ok(/kelengkapan, urut, [.][.][.]rentang/.test(p) && p.includes("parameterDaftar({"), "paramDaftar memuat kelengkapan, urut, periode");
  assert.ok(p.includes("api.eksporOrderProduksiXlsx({ displayStatus: displayParam, ...paramDaftar"), "ekspor memakai paramDaftar yang sama");
  assert.ok(p.includes("setVersiHitung((v) => v + 1)"), "hitungan diperbarui setelah data dilengkapi");
  assert.ok(!/paramHitung = useMemo\(\(\) => \(\{[^}]*kelengkapan/.test(p), "hitungan TIDAK dibatasi oleh pilihan kelengkapan sendiri");
  assert.ok(p.includes("useHubRange(periodeDariUrl, periodeKeUrl)") && p.includes("paramPeriode(periode)"), "periode dari pemilih standar (URL), dikirim lewat paramPeriode");
  assert.ok(p.includes('<KelengkapanBaris row={u} onLengkapi={bukaLengkapi}'), "label per baris + Lengkapi");
  assert.ok(p.includes("const bukaLengkapi = (u, sasaran) => { setFokusPanel("), "Lengkapi hanya membuka drawer");
  assert.ok(!/api\.(nyatakanTanpaBahan|cabutTanpaBahan)/.test(p), "daftar tidak menulis");
  assert.ok(p.includes("setKelengkapan([]); setPeriode(periodeSemuaWaktu())"), "Hapus filter ikut membersihkan kelengkapan dan periode");
});

test("pengawatan filter: server menghitung; dasar tanggal dinyatakan; akses ke riwayat; ikon info; aria-pressed; target ≥44px di HP", () => {
  const f = src("features", "production", "KelengkapanFilter.jsx");
  assert.ok(f.includes("aria-pressed={on}") && f.includes("InfoToggleButton"), "toggle tersedia + ikon info");
  assert.ok(f.includes("DASAR_PERIODE_TEKS") && f.includes('data-testid="dasar-periode"'), "dasar tanggal periode dinyatakan");
  assert.ok(f.includes('data-testid="periode-picker"') && f.includes("<DateRangePicker value={periode} onChange={onPeriode} showCompare={false} />") && f.includes('data-testid="urutan-daftar"'), "pemilih periode standar + urutan");
  assert.ok(f.includes("URUTAN_DAFTAR.map") && /Paling lama belum ditangani/.test(src("features", "production", "orderProduksiModel.js")), "urutan paling lama belum ditangani");
  assert.ok(f.includes('data-testid="kel-lihat-riwayat"') && f.includes("hitung.riwayat.unik"), "akses ke unit Terkirim berkekurangan");
  assert.ok(f.includes("max-sm:min-h-[44px]"), "target sentuh HP");
  assert.ok(!/api\./.test(f), "komponen filter tidak memanggil API sendiri");
});

test("pengawatan baris: label pendek + ikon info + SATU tombol Lengkapi; tidak menulis", () => {
  const b = src("features", "production", "KelengkapanBaris.jsx");
  assert.ok(b.includes('data-testid="lengkapi-baris"') && (b.match(/data-testid="lengkapi-baris"/g) || []).length === 1, "satu tombol Lengkapi");
  assert.ok(b.includes("InfoToggleButton") && b.includes("kel.items[k]?.alasan"), "alasan konkret di ikon info");
  assert.ok(b.includes("e.stopPropagation()"), "klik tidak ikut membuka baris dua kali");
  assert.ok(!/api\./.test(b), "tidak memanggil API");
});

test("pengawatan drawer: Kelengkapan memakai klasifikasi server; pernyataan eksplisit (alasan + konfirmasi + kunci idempoten); izin; HPP terpisah dari biaya Finance", () => {
  const k = src("features", "production", "KelengkapanBagian.jsx"); const panel = src("features", "production", "OrderProduksiPanel.jsx");
  assert.ok(k.includes("data?.adopsi?.kelengkapan") && !/kerjaKey|klasifikasiKelengkapan|bahanLayakDinilai/.test(k), "klien tidak menurunkan klasifikasi sendiri");
  assert.ok(k.includes("izin.pernyataanTanpaBahan") && k.includes('data-testid="pernyataan-tanpa-izin"'), "izin dipakai; akun tanpa izin diberi penjelasan");
  assert.ok(k.includes('data-testid="pernyataan-konfirmasi"') && k.includes("alasan.trim().length < 5"), "konfirmasi + alasan minimal");
  assert.ok(k.includes("kunciRef.current") && k.includes("sigRef.current !== sig"), "kunci idempoten per isian (klik ganda aman)");
  assert.ok(/Bukan nilai persediaan dan bukan biaya\/jurnal Finance/.test(k) && k.includes("HPP operasional"), "HPP operasional dibedakan dari Finance");
  assert.ok(k.includes("KELENGKAPAN_BUKAN"), "opsional tidak dihitung kekurangan");
  assert.ok(k.includes('to="/warehouse/inventory"'), "arah perbaikan HPP ke Stok & Lokasi (Harga Berlaku)");
  assert.ok(panel.includes("<KelengkapanBagian data={data} aktif={aktif} onDone={sesudahUbah} />") && panel.includes('fokus !== "kelengkapan"'), "terpasang di drawer + fokus kelengkapan");
  assert.ok(panel.includes('data-testid="lompat-kelengkapan"'), "bilah lompat ke Kelengkapan");
});

test("Belum dinilai: hitungan dataOrder dibaca dari server; filter menampilkan jumlahnya; drawer tidak menyebut 'Lengkap' bila data order belum dinilai", () => {
  const h = bacaHitungKelengkapan({ counts: {}, unik: 0, dataOrder: { lengkap: 2, kurang: 1, belumDinilai: 60 } });
  assert.deepEqual(h.dataOrder, { lengkap: 2, kurang: 1, belumDinilai: 60 });
  assert.deepEqual(bacaHitungKelengkapan(null).dataOrder, { lengkap: 0, kurang: 0, belumDinilai: 0 });
  const f = src("features", "production", "KelengkapanFilter.jsx"); const k = src("features", "production", "KelengkapanBagian.jsx");
  assert.ok(f.includes('data-testid="kel-belum-dinilai"') && /bukan lengkap, dan tidak dihitung sebagai kekurangan/.test(f), "jumlah belum dinilai terlihat di filter");
  assert.ok(k.includes('kel.dataOrder?.status === "BELUM_DINILAI"') && k.includes('data-testid="data-order-belum-dinilai"'), "drawer: belum dinilai");
  assert.ok(!/Lengkap menurut aturan saat ini/.test(k), "ringkasan dari server (kel.ringkas), tidak di-hardcode 'Lengkap'");
  assert.match(KELENGKAPAN_FILTER.find((x) => x.key === "DATA_ORDER_KURANG").bantu, /Belum dinilai/);
});

test("pernyataan bertentangan dengan catatan bahan: peringatan jelas (bukan hijau), tombol cabut tetap tersedia; klasifikasi dari server", () => {
  const k = src("features", "production", "KelengkapanBagian.jsx");
  assert.ok(k.includes("bertentangan={!!kel.pernyataanBertentangan}") && k.includes('data-testid="pernyataan-bertentangan"'), "pernyataan bertentangan ditandai");
  assert.ok(/bg-orangebg/.test(k) && /bertentangan dengan catatan bahan/.test(k), "bukan hijau 'dinyatakan' saat bertentangan");
  assert.ok(!/adaCatatan|pemakaian\.baru|catatanBahan/.test(k), "klien tidak menurunkan pertentangan sendiri");
});
