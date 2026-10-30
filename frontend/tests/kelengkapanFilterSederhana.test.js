// Penyederhanaan filter Kelengkapan Order Produksi: satu pintasan "Perlu dilengkapi · N", satu dropdown "Jenis masalah" (+ panel gabungan), reset hanya bila aktif, jenis masalah di URL,
// baris menampilkan SATU alasan utama + "+N masalah". HANYA penyajian: klasifikasi, hitungan, dan hubungan OR tetap dari server (parameter daftar/hitungan/Excel tidak berubah).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KELENGKAPAN_FILTER, KELENGKAPAN_KEYS, MASALAH_GABUNGAN, MASALAH_SEMUA, labelKelengkapan, masalahDariUrl, masalahKeUrl, nilaiJenisMasalah, parameterDaftar, pilihanDariJenisMasalah, ringkasBaris, sasaranLengkapi, toggleKelengkapan,
} from "../src/features/production/orderProduksiModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const baris = (items) => ({ unitCode: "RES-1-U1", adopsi: { kelengkapan: { keys: Object.keys(items), items: Object.fromEntries(Object.entries(items).map(([k, kode]) => [k, { key: k, label: k, alasan: (Array.isArray(kode) ? kode : [kode]).map((c) => ({ kode: c, teks: c })) }])) } } });

test("istilah filter: 'Biaya bahan' (bukan HPP) untuk filter; kunci server tidak berubah; HPP operasional dijelaskan lewat info", () => {
  assert.deepEqual(KELENGKAPAN_FILTER.map((k) => k.label), ["Belum ada catatan bahan", "Bahan perlu diperiksa", "Biaya bahan belum lengkap", "Data order kurang"]);
  assert.deepEqual(KELENGKAPAN_KEYS, ["BAHAN_BELUM_DICATAT", "BAHAN_PERLU_DICEK", "HPP_BELUM_LENGKAP", "DATA_ORDER_KURANG"], "kunci klasifikasi tidak berubah");
  assert.equal(labelKelengkapan("HPP_BELUM_LENGKAP"), "Biaya bahan belum lengkap"); assert.equal(labelKelengkapan("TIDAK_ADA", "cadangan"), "cadangan");
  assert.match(KELENGKAPAN_FILTER.find((k) => k.key === "HPP_BELUM_LENGKAP").bantu, /Biaya bahan = HPP operasional.*bukan nilai persediaan\/biaya Finance/);
  const f = src("features", "production", "KelengkapanFilter.jsx");
  assert.ok(/Biaya bahan = HPP operasional \(harga berlaku Gudang pada waktu pemakaian\), bukan nilai persediaan dan bukan biaya Finance/.test(f), "penjelasan HPP operasional di info");
});

test("dropdown 'Jenis masalah': pilihan <-> daftar kunci; Semua masalah = keempat jenis (OR); gabungan dari panel", () => {
  assert.equal(nilaiJenisMasalah([]), ""); assert.equal(nilaiJenisMasalah(undefined), "");
  assert.equal(nilaiJenisMasalah(["HPP_BELUM_LENGKAP"]), "HPP_BELUM_LENGKAP");
  assert.equal(nilaiJenisMasalah([...KELENGKAPAN_KEYS]), MASALAH_SEMUA);
  assert.equal(nilaiJenisMasalah(["BAHAN_PERLU_DICEK", "DATA_ORDER_KURANG"]), MASALAH_GABUNGAN);
  assert.deepEqual(pilihanDariJenisMasalah(MASALAH_SEMUA), KELENGKAPAN_KEYS); assert.deepEqual(pilihanDariJenisMasalah(""), []); assert.deepEqual(pilihanDariJenisMasalah(MASALAH_GABUNGAN), [], "GABUNGAN bukan pilihan yang bisa dipilih ulang");
  for (const k of KELENGKAPAN_KEYS) assert.deepEqual(pilihanDariJenisMasalah(k), [k]);
  // gabungan dari panel memakai toggle lama (urutan tetap, tanpa duplikat) — hubungan OR tidak berubah
  let t = []; t = toggleKelengkapan(t, "DATA_ORDER_KURANG"); t = toggleKelengkapan(t, "BAHAN_BELUM_DICATAT"); assert.deepEqual(t, ["BAHAN_BELUM_DICATAT", "DATA_ORDER_KURANG"]);
});

test("parameter server TIDAK berubah: 'Semua masalah' dan gabungan dikirim sebagai daftar kunci (OR di server); daftar, hitungan, dan Excel memakai sumber yang sama", () => {
  assert.equal(parameterDaftar({ kelengkapan: pilihanDariJenisMasalah(MASALAH_SEMUA) }).kelengkapan, "BAHAN_BELUM_DICATAT,BAHAN_PERLU_DICEK,HPP_BELUM_LENGKAP,DATA_ORDER_KURANG");
  assert.equal(parameterDaftar({ kelengkapan: ["BAHAN_PERLU_DICEK", "HPP_BELUM_LENGKAP"] }).kelengkapan, "BAHAN_PERLU_DICEK,HPP_BELUM_LENGKAP");
  assert.equal("kelengkapan" in parameterDaftar({ kelengkapan: [] }), false, "tanpa pilihan: tanpa parameter");
  const p = src("pages", "bengkel", "ProductionWorkOrders.jsx");
  assert.ok(p.includes("parameterDaftar({ q: qDebounced || undefined, kerja: kerja ? [kerja] : [], kelengkapan, urut, ...rentang })"), "paramDaftar masih memuat kelengkapan + periode");
  assert.ok(p.includes("...paramDaftar, page: String(page)") && p.includes("api.eksporOrderProduksiXlsx({ displayStatus: displayParam, ...paramDaftar"), "pagination dan Excel memakai paramDaftar yang sama");
  assert.ok(/const paramHitung = useMemo\(\(\) => \(\{ displayStatus: displayParam, q: qDebounced \|\| undefined, statusKerja: kerja \|\| undefined, \.\.\.rentang \}\)/.test(p), "hitungan: lingkup + pencarian + status + periode, TANPA pilihan jenis masalah");
});

test("URL ?masalah=: tulis -> baca sama (tahan refresh); kunci lain dipertahankan; tidak dikenal diabaikan; tanpa pilihan membuang parameter", () => {
  for (const t of [["BAHAN_BELUM_DICATAT"], ["BAHAN_PERLU_DICEK", "HPP_BELUM_LENGKAP"], ["BAHAN_BELUM_DICATAT", "DATA_ORDER_KURANG"], [...KELENGKAPAN_KEYS]]) {
    const u = masalahKeUrl(new URLSearchParams("tab=aktif&preset=last_7_days"), t);
    assert.deepEqual(masalahDariUrl(u), t); assert.equal(u.get("tab"), "aktif"); assert.equal(u.get("preset"), "last_7_days", "periode dipertahankan");
  }
  assert.equal(masalahKeUrl(new URLSearchParams(), [...KELENGKAPAN_KEYS]).get("masalah"), "semua");
  assert.equal(masalahKeUrl(new URLSearchParams(), ["DATA_ORDER_KURANG", "BAHAN_PERLU_DICEK"]).get("masalah"), "periksa,order", "urutan tetap, kunci pendek");
  assert.deepEqual(masalahDariUrl(new URLSearchParams("masalah=ngawur,biaya")), ["HPP_BELUM_LENGKAP"]); assert.deepEqual(masalahDariUrl(new URLSearchParams("masalah=")), []); assert.deepEqual(masalahDariUrl(new URLSearchParams("")), []);
  const hapus = masalahKeUrl(new URLSearchParams("masalah=semua&tab=aktif&q=RES-1"), []);
  assert.equal(hapus.has("masalah"), false); assert.equal(hapus.get("tab"), "aktif"); assert.equal(hapus.get("q"), "RES-1");
});

test("ringkasBaris: SATU alasan utama menurut urutan yang bisa ditindaklanjuti; bahan belum dicatat tidak menumpuk 'Biaya bahan' berpenyebab sama", () => {
  const a = ringkasBaris(baris({ BAHAN_BELUM_DICATAT: ["BAHAN_TIDAK_ADA_CATATAN", "PERNYATAAN_BELUM_ADA"], HPP_BELUM_LENGKAP: "HPP_BAHAN_BELUM_DICATAT" }));
  assert.equal(a.utama, "BAHAN_BELUM_DICATAT"); assert.deepEqual(a.terlipat, ["HPP_BELUM_LENGKAP"]); assert.deepEqual(a.terlihat, []); assert.deepEqual(a.lain, []); assert.equal(a.sasaran, "bahan");
  assert.deepEqual(a.semua, ["BAHAN_BELUM_DICATAT", "HPP_BELUM_LENGKAP"], "klasifikasi server utuh (bisa dilihat di info), hanya tampilan baris yang ringkas");
  const b = ringkasBaris(baris({ DATA_ORDER_KURANG: "X", BAHAN_PERLU_DICEK: "CATATAN_BELUM_TERPETAKAN" }));
  assert.equal(b.utama, "BAHAN_PERLU_DICEK"); assert.deepEqual(b.lain, ["DATA_ORDER_KURANG"]); assert.equal(b.sasaran, "bahan");
  const c = ringkasBaris(baris({ HPP_BELUM_LENGKAP: "HPP_HARGA_BELUM_DIKETAHUI", DATA_ORDER_KURANG: "X" }));
  assert.equal(c.utama, "HPP_BELUM_LENGKAP"); assert.deepEqual(c.lain, ["DATA_ORDER_KURANG"]); assert.equal(c.sasaran, "kelengkapan", "masalah harga/data order -> bagian Kelengkapan di drawer");
  const d = ringkasBaris(baris({ DATA_ORDER_KURANG: "X" })); assert.equal(d.utama, "DATA_ORDER_KURANG"); assert.equal(d.lain.length, 0); assert.equal(d.sasaran, "kelengkapan");
  const e = ringkasBaris({ adopsi: { kelengkapan: { keys: [], items: {} } } }); assert.equal(e.utama, null); assert.equal(e.sasaran, null); assert.deepEqual(ringkasBaris({}).semua, []);
  assert.equal(sasaranLengkapi(a.semua), a.sasaran, "tombol Lengkapi sama dengan perilaku lama (bagian bahan bila ada masalah bahan)");
});

test("masalah HARGA yang berdiri sendiri TIDAK disembunyikan: tetap tampil sebagai label kedua, juga saat bahan belum dicatat / perlu diperiksa", () => {
  const a = ringkasBaris(baris({ BAHAN_PERLU_DICEK: "CATATAN_BELUM_TERPETAKAN", HPP_BELUM_LENGKAP: ["HPP_HARGA_BELUM_DIKETAHUI", "HPP_CATATAN_TERTAHAN"] }));
  assert.equal(a.utama, "BAHAN_PERLU_DICEK"); assert.deepEqual(a.terlihat, ["HPP_BELUM_LENGKAP"]); assert.deepEqual(a.terlipat, []);
  // campuran: 'bahan belum dicatat' + harga yang berdiri sendiri (alasan lain selain HPP_BAHAN_BELUM_DICATAT) -> tidak dilipat
  const b = ringkasBaris(baris({ BAHAN_BELUM_DICATAT: "BAHAN_TIDAK_ADA_CATATAN", HPP_BELUM_LENGKAP: ["HPP_BAHAN_BELUM_DICATAT", "HPP_GAGAL_PEMBEKUAN"] }));
  assert.deepEqual(b.terlipat, []); assert.deepEqual(b.terlihat, ["HPP_BELUM_LENGKAP"]);
  // HPP tanpa alasan terurai (payload lama) tidak pernah dilipat
  const c = ringkasBaris({ adopsi: { kelengkapan: { keys: ["BAHAN_BELUM_DICATAT", "HPP_BELUM_LENGKAP"], items: {} } } }); assert.deepEqual(c.terlipat, []); assert.deepEqual(c.terlihat, ["HPP_BELUM_LENGKAP"]);
});

test("PENGAWATAN filter: deretan chip diganti pintasan + dropdown; reset hanya bila ada pilihan; panel gabungan ringkas; angka dari server", () => {
  const f = src("features", "production", "KelengkapanFilter.jsx");
  assert.ok(!/KELENGKAPAN_FILTER\.map\(\(k\) => \{\s*const n = hitung/.test(f) && !f.includes("kel-n-${k.key}`}>{memuat"), "deretan chip lama dihapus");
  assert.ok(f.includes('data-testid="kel-perlu"') && f.includes("Perlu dilengkapi") && f.includes('data-testid="kel-unik"') && f.includes("hitung.unik"), "pintasan memakai jumlah unit unik dari server");
  assert.ok(f.includes('data-testid="kel-jenis"') && f.includes('aria-label="Jenis masalah"') && f.includes("Semua masalah"), "dropdown Jenis masalah");
  assert.ok(/\{aktif && <Button[^>]*data-testid="kel-bersih"/.test(f), "tombol reset hanya muncul saat ada pilihan aktif");
  assert.ok(f.includes('data-testid="kel-panel-buka"') && f.includes('type="checkbox"') && f.includes("kel-cek-${k.key}"), "gabungan beberapa jenis di panel kotak centang");
  assert.ok(f.includes("max-sm:min-h-[44px]") && f.includes("max-sm:h-11"), "target sentuh HP");
  assert.ok(f.includes('data-testid="kel-belum-dinilai"') && /bukan lengkap, dan tidak dihitung sebagai kekurangan/.test(f), "'Belum dinilai' tetap dibedakan dari lengkap");
  assert.ok(!/api\./.test(f), "komponen tidak memanggil API sendiri");
  const p = src("pages", "bengkel", "ProductionWorkOrders.jsx");
  assert.ok(p.includes("useHubMasalah(masalahDariUrl, masalahKeUrl)") && p.includes("onPilih={setKelengkapan}") && p.includes("onToggle={(k) => setKelengkapan(toggleKelengkapan(kelengkapan, k))}"), "jenis masalah tersimpan di URL");
});

test("PENGAWATAN baris: satu alasan utama + '+N masalah' + ikon info + satu tombol Lengkapi (bagian terkait); tidak menulis", () => {
  const b = src("features", "production", "KelengkapanBaris.jsx");
  assert.ok(b.includes("ringkasBaris(row)") && b.includes('data-testid="kelengkapan-lain"') && b.includes("+{r.lain.length} masalah"), "+N masalah");
  assert.ok((b.match(/data-testid="lengkapi-baris"/g) || []).length === 1 && b.includes("data-sasaran={r.sasaran}") && b.includes("onLengkapi?.(row, r.sasaran)"), "satu tombol Lengkapi membuka bagian terkait");
  assert.ok(b.includes("InfoToggleButton") && b.includes("kel.items[k]?.alasan") && b.includes('data-testid="kelengkapan-terlipat"'), "semua alasan (termasuk yang dilipat) tersedia di info");
  assert.ok(!/api\.|fetch\(/.test(b), "baris tidak menulis/memanggil API");
});

test("useHubMasalah: penulisan URL beruntun dalam satu tick saling menumpuk (Hapus filter: periode + jenis masalah tidak saling menimpa)", () => {
  const h = src("hooks", "useHubParam.js");
  assert.ok(h.includes("export function useHubMasalah") && h.includes("basisSearch(location)") && h.includes("catatTertunda(location"), "hook baru memakai basis tertunda");
  assert.ok((h.match(/basisSearch\(location\)/g) || []).length === 2, "useHubRange dan useHubMasalah sama-sama memakai basis tertunda");
  assert.ok(/Promise\.resolve\(\)\.then\(\(\) => \{ tertunda\.dari = null/.test(h), "catatan tertunda dibuang di microtask berikutnya (tidak bocor antar interaksi)");
});

// ── biaya bahan sebagai AKIBAT masalah bahan: dibaca dari KODE + JUMLAH alasan server (bukan dari teks label) ──
const barisJ = (items) => ({ unitCode: "RES-9-U1", adopsi: { kelengkapan: { keys: Object.keys(items), items: Object.fromEntries(Object.entries(items).map(([k, al]) => [k, { key: k, label: "TEKS-TIDAK-DIPAKAI", alasan: al.map(([kode, jumlah]) => ({ kode, teks: "teks bebas tidak dibaca", ...(jumlah === undefined ? {} : { jumlah }) })) }])) } } });

test("biaya bahan hanya akibat 'bahan perlu diperiksa': tidak jadi label kedua, tetap ada di info (alasan dari kode+jumlah)", () => {
  const a = ringkasBaris(barisJ({ BAHAN_PERLU_DICEK: [["CATATAN_BELUM_TERPETAKAN", 2], ["CATATAN_PERLU_DICEK_LAIN", 1]], HPP_BELUM_LENGKAP: [["HPP_CATATAN_TERTAHAN", 3]] }));
  assert.equal(a.utama, "BAHAN_PERLU_DICEK"); assert.deepEqual(a.terlipat, ["HPP_BELUM_LENGKAP"]); assert.deepEqual(a.terlihat, []); assert.deepEqual(a.lain, []);
  assert.deepEqual(a.lipatDari, { HPP_BELUM_LENGKAP: ["BAHAN_PERLU_DICEK"] }); assert.deepEqual(a.semua, ["BAHAN_PERLU_DICEK", "HPP_BELUM_LENGKAP"], "klasifikasi server utuh");
  const s = ringkasBaris(barisJ({ BAHAN_PERLU_DICEK: [["SEMENTARA_BELUM_TERPETAKAN", 1], ["SEMENTARA_BELUM_DIREKONSILIASI", 1]], HPP_BELUM_LENGKAP: [["HPP_SEMENTARA", 2]] }));
  assert.deepEqual(s.terlipat, ["HPP_BELUM_LENGKAP"]);
  const k = ringkasBaris(barisJ({ BAHAN_BELUM_DICATAT: [["BAHAN_TIDAK_ADA_CATATAN"]], HPP_BELUM_LENGKAP: [["HPP_BAHAN_BELUM_DICATAT"]] }));
  assert.deepEqual(k.lipatDari, { HPP_BELUM_LENGKAP: ["BAHAN_BELUM_DICATAT"] });
});

test("biaya bahan MANDIRI tetap tampil sebagai label kedua: harga belum diketahui / belum diterapkan / gagal, kelebihan jumlah tertahan, atau jumlah tak diketahui", () => {
  for (const [nama, hpp] of [
    ["harga belum diketahui", [["HPP_CATATAN_TERTAHAN", 1], ["HPP_HARGA_BELUM_DIKETAHUI", 2]]],
    ["belum diterapkan", [["HPP_BELUM_DITERAPKAN", 1]]],
    ["gagal pembekuan", [["HPP_GAGAL_PEMBEKUAN", 1]]],
    ["tertahan lebih banyak daripada catatan perlu dicek (sisanya Siap Posting)", [["HPP_CATATAN_TERTAHAN", 5]]],
    ["jumlah tidak ada di payload", [["HPP_CATATAN_TERTAHAN"]]],
    ["kode tak dikenal", [["HPP_KODE_BARU", 1]]],
  ]) {
    const r = ringkasBaris(barisJ({ BAHAN_PERLU_DICEK: [["CATATAN_BELUM_TERPETAKAN", 3]], HPP_BELUM_LENGKAP: hpp }));
    assert.deepEqual(r.terlihat, ["HPP_BELUM_LENGKAP"], nama); assert.deepEqual(r.terlipat, [], nama);
  }
  // 'tertahan' tanpa kategori bahan perlu diperiksa (sepenuhnya Siap Posting) = masalah posting yang berdiri sendiri
  const siap = ringkasBaris(barisJ({ HPP_BELUM_LENGKAP: [["HPP_CATATAN_TERTAHAN", 2]] })); assert.deepEqual(siap.terlipat, []); assert.equal(siap.utama, "HPP_BELUM_LENGKAP");
});

test("keputusan tidak bergantung pada teks label: label/teks diganti apa pun, hasil sama", () => {
  const dasar = barisJ({ BAHAN_PERLU_DICEK: [["CATATAN_BELUM_TERPETAKAN", 1]], HPP_BELUM_LENGKAP: [["HPP_CATATAN_TERTAHAN", 1]] });
  const ubah = JSON.parse(JSON.stringify(dasar)); for (const it of Object.values(ubah.adopsi.kelengkapan.items)) { it.label = "xxx"; for (const a of it.alasan) a.teks = "yyy"; }
  assert.deepEqual(ringkasBaris(ubah), ringkasBaris(dasar));
});

test("'Semua unit' hanya menghapus jenis masalah (periode, pencarian, tab dipertahankan); 'Hapus semua filter' mereset semuanya", () => {
  const url = masalahKeUrl(new URLSearchParams("masalah=catatan,periksa&preset=last_7_days&q=RES-9&tab=aktif&dari=2026-10-01&sampai=2026-10-15"), pilihanDariJenisMasalah(""));
  assert.equal(url.has("masalah"), false); for (const [k, v] of [["preset", "last_7_days"], ["q", "RES-9"], ["tab", "aktif"], ["dari", "2026-10-01"], ["sampai", "2026-10-15"]]) assert.equal(url.get(k), v, k);
  const f = src("features", "production", "KelengkapanFilter.jsx"); const p = src("pages", "bengkel", "ProductionWorkOrders.jsx");
  assert.ok(f.includes('<option value="">Semua unit</option>') && f.includes("onPilih(pilihanDariJenisMasalah(e.target.value))"), "dropdown 'Semua unit' -> pilihan kosong, bukan reset lain");
  assert.ok(f.includes("onBersih={onBersih}") === false && p.includes("onBersih={() => setKelengkapan([])}"), "'Hapus pilihan' hanya jenis masalah");
  assert.ok(p.includes("setCari(\"\"); setKerja(\"\"); setKelengkapan([]); setPeriode(periodeSemuaWaktu())") && p.includes(">Hapus semua filter</Button>"), "'Hapus semua filter' mereset pencarian, status, jenis masalah, dan periode");
});
