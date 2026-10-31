// Fase 2 halaman Pelanggan (31 Okt 2026): kolom tabel, toolbar, pemisahan pilih-vs-buka, keadaan kosong/galat, CSS terpagari.
// Tes statis atas sumber + fungsi murni (columns.js); tampilan & interaksi terukur di browser terpisah.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  KOLOM_TAMBAHAN, bersihkanKolom, muatKolom, simpanKolom, toggleKolom, kolomTampil, lebarMinTabel, STORAGE_KEY,
} from "../src/features/customers/columns.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const halaman = baca("src/pages/Customers.jsx");
const tabel = baca("src/features/customers/components/CustomersTable.jsx");
const filter = baca("src/features/customers/components/CustomerFilters.jsx");
const bulk = baca("src/features/customers/components/BulkActionBar.jsx");
const kartu = baca("src/features/customers/components/CustomerCardList.jsx");
const css = baca("src/styles/sanss-crm-pelanggan.css");
const cssTanpaKomentar = css.replace(/\/\*[\s\S]*?\*\//g, "");

const storagePalsu = () => { const d = new Map(); return { getItem: (k) => (d.has(k) ? d.get(k) : null), setItem: (k, v) => d.set(k, v) }; };

test("Kolom awal = pilih, Pelanggan, Pipeline, Sales, Kota, Order, Nilai Order, Aksi; kolom lain ada di menu Kolom", () => {
  assert.deepEqual(kolomTampil([]), ["pilih", "pelanggan", "pipeline", "sales", "kota", "order", "nilai", "aksi"]);
  assert.deepEqual(KOLOM_TAMBAHAN.map((k) => k.key), ["idOrder", "statusOrder", "keluhan", "kesehatan", "tags", "tipe", "sumber"]);
  // tidak ada informasi tabel lama yang hilang: tujuh kolom lama semua dapat dinyalakan kembali
  const semua = kolomTampil(KOLOM_TAMBAHAN.map((k) => k.key));
  for (const k of ["idOrder", "statusOrder", "keluhan", "kesehatan", "tags", "tipe", "sumber"]) assert.ok(semua.includes(k), k);
  assert.equal(semua[semua.length - 1], "aksi");
});

test("Kolom tambahan: toggle berurutan tetap, kunci asing dibuang, preferensi disimpan & dipulihkan, rusak → standar", () => {
  assert.deepEqual(toggleKolom([], "sumber"), ["sumber"]);
  assert.deepEqual(toggleKolom(["sumber"], "tags"), ["tags", "sumber"]);
  assert.deepEqual(toggleKolom(["tags", "sumber"], "tags"), ["sumber"]);
  assert.deepEqual(toggleKolom(["sumber"], "tidak-ada"), ["sumber"]);
  assert.deepEqual(bersihkanKolom(["tags", "tags", "x", 5, "sumber"]), ["tags", "sumber"]);
  const st = storagePalsu();
  assert.deepEqual(muatKolom(st), []);
  simpanKolom(["sumber", "tags", "zzz"], st);
  assert.deepEqual(muatKolom(st), ["tags", "sumber"]);
  st.setItem(STORAGE_KEY, "{bukan json");
  assert.deepEqual(muatKolom(st), []);
  assert.deepEqual(muatKolom({ getItem() { throw new Error("diblokir"); } }), [], "localStorage terblokir tidak menjatuhkan halaman");
});

test("Lebar: enam kolom inti muat di konten 1280px (972px) tanpa gulir horizontal; kolom tambahan boleh menggulir di dalam kartu tabel", () => {
  assert.ok(lebarMinTabel(kolomTampil([])) <= 972, String(lebarMinTabel(kolomTampil([]))));
  assert.ok(lebarMinTabel(kolomTampil(KOLOM_TAMBAHAN.map((k) => k.key))) > 972);
  assert.ok(tabel.includes("<Table fixed style={{ minWidth: lebarMinTabel(kolom) }}>"));
});

test("Halaman memakai ruang penuh setelah sidebar (PageContainer fluid) dengan padding 24px; header: judul+jumlah kiri, aksi kanan", () => {
  assert.ok(halaman.includes('<PageContainer fluid className="crm-pel">'));
  assert.ok(css.includes("max-width: none; padding-inline: 24px;"));
  assert.ok(halaman.includes('subtitle={loading ?') && halaman.includes('pelanggan`}'));
  const a = halaman.indexOf("Export Excel"), b = halaman.indexOf("Kontak (.vcf)"), c = halaman.indexOf("Pelanggan Baru");
  assert.ok(a > 0 && a < b && b < c, "urutan aksi: Export, Kontak, lalu Pelanggan Baru (utama)");
  assert.ok(halaman.includes('className="crm-pel-utama"') && halaman.match(/crm-pel-sekunder/g).length === 2);
});

test("Fungsi dipertahankan: filter, pencarian debounce, sorting, pagination, ekspor Excel/VCF, seleksi massal, tujuan klik", () => {
  for (const k of ["const DEBOUNCE_MS = 350", "function toggleSort(key)", "async function handleExport()", "async function handleExportVCard()", "async function handleBulkAssign(salesId)",
    "api.bulkReassignCustomers(activeFilters, salesId)", "<Pagination", "getCustomerCities", "selectAllMatching", "setDrawerCustomerId"]) assert.ok(halaman.includes(k), k);
  // ekspor Excel: 25 kolom, urutan lama tidak berubah (ekspor TIDAK ikut tampilan kolom)
  const ekspor = halaman.slice(halaman.indexOf("const data = rows.map"), halaman.indexOf("exportToExcel(data"));
  const kunci = [...ekspor.matchAll(/^\s+(?:"([^"]+)"|([A-Za-z]+)):/gm)].map((m) => m[1] || m[2]);
  assert.deepEqual(kunci, ["Nama Pelanggan", "ID Order", "No HP", "Instagram", "Email", "Pipeline", "Status Order", "Status Pembayaran", "Keluhan Terbaru", "Merk Kasur", "Ukuran Kasur", "Berat Badan (kg)", "Layanan", "Status Kesehatan", "Kategori Keluhan", "Tags", "Tipe Pelanggan", "Kota", "Sumber Lead", "Detail Iklan", "Jumlah Order", "Total Nilai Order", "Pernah Komplain", "Sales Person"]);
  for (const f of ["onSort", "SORT_KEY"]) assert.ok(tabel.includes(f));
  assert.ok(tabel.includes('{ pelanggan: "name", kota: "city", order: "orderCount", nilai: "orderValue", sales: "assignedSales", sumber: "leadSource" }'), "kolom yang bisa di-sort sama dengan sebelumnya");
});

test("Memilih baris terpisah dari membuka profil: checkbox tidak memicu klik baris; baris → chat/profil; tombol Profil → drawer", () => {
  assert.ok(tabel.includes('<TD key={k} onClick={(e) => e.stopPropagation()} className="crm-pel-td-pilih">'), "sel checkbox menghentikan klik baris");
  assert.ok(tabel.includes("onClick={() => bukaChat(c)}") && tabel.includes("navigate(`/inbox?conv=${c.conversationId}`)") && tabel.includes("else onOpen(c.id)"), "klik baris: chat bila ada percakapan, kalau tidak profil");
  assert.ok(tabel.includes("onClick={() => onOpen(c.id)}") && tabel.includes('aria-label={`Profil ${displayName}`}'), "tombol Profil eksplisit");
  assert.ok(tabel.includes("selected={terpilih}"), "baris terpilih ditandai");
  assert.ok(tabel.includes("aria-label={`Pilih ${displayName}`}") && tabel.includes('aria-label="Pilih semua pelanggan di halaman ini"'));
});

test("Toolbar: tab tipe + filter cepat satu baris, pencarian + filter lanjutan + Kolom satu blok; tanpa filter baru", () => {
  assert.ok(filter.includes("crm-pel-bar1") && filter.includes("crm-pel-bar2"));
  for (const k of ['ariaLabel="Filter stage"', 'ariaLabel="Filter sumber lead"', 'ariaLabel="Filter kota"', 'ariaLabel="Filter sales person"', 'key: "vip"', 'key: "no-order"', 'key: "inactive"', 'key: "sakit"']) assert.ok(filter.includes(k), k);
  assert.equal((filter.match(/<FilterDropdown/g) || []).length, 4, "tepat empat filter lanjutan seperti sebelumnya");
  assert.ok(filter.includes('onClear={() => onSearch("")}'), "tombol bersihkan pencarian benar-benar membersihkan");
  assert.ok(baca("src/features/customers/components/KolomMenu.jsx").includes("e.preventDefault(); onToggle(key);"), "menu Kolom tidak menutup tiap klik");
});

test("Seleksi massal: pilih sales memakai FilterDropdown; konfirmasi 'semua yang cocok' dan assign tetap", () => {
  assert.ok(bulk.includes("<FilterDropdown") && !/<select[\s>]/.test(bulk.replace(/\/\/.*$/gm, "")));
  assert.ok(bulk.includes("Pindahkan SEMUA ${totalMatching} pelanggan yang cocok filter ini ke sales terpilih?") && bulk.includes("onAssign(salesId)"));
});

test("Keadaan: skeleton selebar kolom aktif; kosong informatif (EmptyState) + Reset filter; galat dengan Coba lagi tanpa klaim 'Belum ada pelanggan'", () => {
  assert.ok(tabel.includes("<TableSkeletonRows rows={8} cols={jumlahKolom} />"));
  assert.ok(tabel.includes("<EmptyState") && tabel.includes("Reset filter") && kartu.includes("<EmptyState") && kartu.includes("Reset filter"));
  assert.ok(halaman.includes('role="alert"') && halaman.includes("Coba lagi") && halaman.includes("onClick={load}"));
  assert.ok(tabel.includes("gagal ? \"Daftar belum dapat ditampilkan\"") && kartu.includes("gagal ? \"Daftar belum dapat ditampilkan\""));
  assert.ok(halaman.includes("function resetSemua() { resetAllFilters(); setTypeTab(\"all\"); }"), "reset di keadaan kosong ikut mengembalikan tab tipe");
});

test("CSS: semua aturan di bawah .crm-skin .crm-pel; tanpa font/@import/url(); status memakai warna eksplisit", () => {
  const sel = cssTanpaKomentar.split("}").map((b) => b.split("{")[0].trim()).filter(Boolean).join(",").split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("@"));
  for (const s of sel) assert.ok(s.includes(".crm-skin .crm-pel"), `selektor di luar halaman: ${s}`);
  assert.ok(!/font-family|@font-face|@import|url\(/.test(cssTanpaKomentar));
  assert.ok(baca("src/main.jsx").includes('import "./styles/sanss-crm-pelanggan.css";'));
});

// Kontras teks status (mode terang: warna solid; mode gelap: latar rgba di atas panel #17182F) ≥ 4,5:1.
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => { const t = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2]; };
const rasio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
test("Kontras status pipeline ≥ 4,5:1 di mode terang dan gelap", () => {
  const baris = [...css.matchAll(/(:root\[data-theme="dark"\] )?[^\n]*crm-pel-stage\[data-stage="(\w+)"\]\s*\{\s*background:\s*([^;]+);\s*color:\s*([^;]+);/g)];
  assert.equal(baris.length, 10, "lima tahap × dua tema");
  for (const [, gelap, tahap, bg, fg] of baris) {
    let latar;
    if (bg.startsWith("#")) latar = hex(bg);
    else { const [r, g, b, a] = bg.match(/[\d.]+/g).map(Number); const panel = hex("#17182F"); latar = [r, g, b].map((v, i) => v * a + panel[i] * (1 - a)); }
    const r = rasio(hex(fg.trim()), latar);
    assert.ok(r >= 4.5, `${gelap ? "gelap" : "terang"} ${tahap}: ${r.toFixed(2)}`);
  }
});
