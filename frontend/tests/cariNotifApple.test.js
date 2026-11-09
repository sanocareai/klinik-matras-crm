// Spotlight (⌘K) + Notifikasi gaya Apple + perbaikan breadcrumb "klik Analitik malah ke Main Hub" (10 Nov 2026).
// Fungsi murni lib/cariGlobal.js diuji langsung; kabel komponen diuji sebagai kontrak sumber (pola tes lain di repo ini).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalisasi, skorHalaman, cariHalaman, sorot, kueriDataLayak, kueriUntukServer,
  bacaRiwayat, catatRiwayat, hapusRiwayat, KUNCI_RIWAYAT, tujuanRemah, anggotaSection,
} from "../src/lib/cariGlobal.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (p) => fs.readFileSync(path.join(repo, p), "utf8").replace(/\r\n/g, "\n");
const topbar = baca("src/components/Topbar.jsx");
const palette = baca("src/components/ui/command-palette.jsx");
const layout = baca("src/components/Layout.jsx");
const drawer = baca("src/features/notifications/NotificationDrawer.jsx");
const item = baca("src/features/notifications/NotificationItem.jsx");
const halamanNotif = baca("src/pages/Notifications.jsx");
const orders = baca("src/pages/Orders.jsx");
const css = baca("src/styles/sanss-cari.css");
const main = baca("src/main.jsx");

function storeMemori() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

const SALES = [
  { to: "/dashboard", label: "Dashboard", section: "OPERASIONAL", ws: "growth" },
  { to: "/inbox", label: "Inbox", section: "OPERASIONAL", ws: "growth" },
  { to: "/customers", label: "Pelanggan", section: "DATA", ws: "growth" },
  { to: "/orders", label: "Order", section: "DATA", ws: "growth" },
  { to: "/sales-intelligence", label: "Sales Performance Intelligence", section: "ANALITIK", ws: "growth" },
  { to: "/laporan", label: "Laporan", section: "ANALITIK", ws: "growth" },
  { to: "/pengaturan-sales", label: "Pengaturan", section: "PENGATURAN CRM", ws: "growth" },
];

test("Breadcrumb: remah section 'Analitik' TIDAK lagi ke Main Hub — jadi menu halaman section itu", () => {
  const anggota = anggotaSection("Analitik", SALES);
  assert.deepEqual(anggota.map((h) => h.to), ["/sales-intelligence", "/laporan"]);
  assert.equal(tujuanRemah("Analitik", SALES, { pathname: "/laporan" }), "/sales-intelligence");
  // section satu halaman yang sedang dibuka → teks biasa (tidak menautkan ke dirinya sendiri)
  assert.equal(tujuanRemah("Pengaturan CRM", SALES, { pathname: "/pengaturan-sales" }), null);
  // nama workspace → beranda workspace (halaman pertama menunya), bukan /portal
  const delivery = [{ to: "/armada/dashboard", label: "Dashboard", section: "OPERASIONAL" }, { to: "/armada/jobs", label: "Jadwal", section: "OPERASIONAL" }];
  assert.equal(tujuanRemah("Delivery", delivery, { wsLabel: "Delivery", pathname: "/armada/jobs" }), "/armada/dashboard");
  assert.equal(tujuanRemah("Gudang", [{ to: "/warehouse/dashboard", label: "Beranda", section: "Beranda" }], { pathname: "/warehouse/inventory" }), "/warehouse/dashboard");
  assert.equal(tujuanRemah("Analitik", [], {}), null, "tanpa daftar menu: tidak ada tujuan");
});

test("Breadcrumb: Topbar memakai tujuanRemah/anggotaSection; /portal hanya fallback divisi tanpa daftar menu", () => {
  assert.ok(topbar.includes('import { tujuanRemah, anggotaSection, WORKSPACE_CARI } from "@/lib/cariGlobal.js";'));
  assert.ok(topbar.includes("anggotaSection(text, halaman).length >= 2"));
  assert.ok(topbar.includes("{ to: tujuanRemah(text, halaman, { wsLabel: WORKSPACE_CARI[wsSaatIni]?.label, pathname }) }"));
  assert.ok(topbar.includes(': { to: "/portal" })'), "fallback lama hanya bila halaman kosong");
  assert.ok(!topbar.includes('to: i === 0 && arr.length > 1 ? "/portal" : null'), "aturan lama (selalu ke Main Hub) sudah tidak ada");
  assert.ok(topbar.includes("c.menu ? (") && topbar.includes("<MenuLabel>{c.text}</MenuLabel>"), "remah section = menu pilihan");
});

test("Cari halaman: normalisasi aksen/spasi, skor awal-label di atas, semua kata wajib ada", () => {
  assert.equal(normalisasi("  Pengirìman   Barang "), "pengiriman barang");
  const daftar = [
    { to: "/a", label: "Laporan Biaya", section: "DATA", ws: "growth", wsLabel: "Sales CRM" },
    { to: "/b", label: "Laporan", section: "ANALITIK", ws: "growth", wsLabel: "Sales CRM" },
    { to: "/c", label: "Stok bahan", section: "Stok", ws: "warehouse", wsLabel: "Gudang" },
    { to: "/d", label: "Biaya Produksi", section: "LAPORAN", ws: "bengkel", wsLabel: "Produksi" },
  ];
  assert.equal(skorHalaman(daftar[1], "laporan"), 100);
  assert.ok(skorHalaman(daftar[0], "lap") > skorHalaman(daftar[3], "lap"), "awal label > hanya section");
  assert.equal(skorHalaman(daftar[2], "stok produksi"), 0, "semua kata harus cocok");
  assert.deepEqual(cariHalaman(daftar, "gudang").map((h) => h.to), ["/c"], "nama workspace ikut dicari");
  assert.deepEqual(cariHalaman(daftar, "laporan").map((h) => h.to).slice(0, 2), ["/b", "/a"]);
  // rute kembar lintas workspace dirapatkan; workspace saat ini menang
  const kembar = [{ to: "/komplain", label: "Kasus Komplain", ws: "warehouse" }, { to: "/komplain", label: "Kasus Komplain", ws: "growth" }];
  const h = cariHalaman(kembar, "komplain", { wsSaatIni: "growth" });
  assert.equal(h.length, 1); assert.equal(h[0].ws, "growth");
});

test("Sorot: segmen cocok ditebalkan tanpa HTML mentah; teks yang berubah panjang saat dinormalkan tidak disorot", () => {
  assert.deepEqual(sorot("Budi Santoso", "san"), [{ teks: "Budi ", cocok: false }, { teks: "San", cocok: true }, { teks: "toso", cocok: false }]);
  assert.deepEqual(sorot("Laporan", ""), [{ teks: "Laporan", cocok: false }]);
  assert.deepEqual(sorot("A  B", "b"), [{ teks: "A  B", cocok: false }]);
  assert.ok(!palette.includes("dangerouslySetInnerHTML"), "tanpa innerHTML");
});

test("Kueri data: min 2 huruf / 3 digit; nomor HP 08… → 62… sesuai kolom phone", () => {
  assert.equal(kueriDataLayak("a"), false);
  assert.equal(kueriDataLayak("bu"), true);
  assert.equal(kueriDataLayak("08"), false);
  assert.equal(kueriDataLayak("081"), true);
  assert.equal(kueriUntukServer("0812-3456 789"), "628123456789");
  assert.equal(kueriUntukServer("+62 812 3456"), "628123456");
  assert.equal(kueriUntukServer("ORD-2026"), "ORD-2026");
});

test("Riwayat: maksimal 6, rute sama tidak dobel, penyimpanan rusak/gagal tidak melempar", () => {
  const st = storeMemori();
  for (let i = 0; i < 8; i++) catatRiwayat({ to: `/p${i}`, label: `P${i}` }, st);
  catatRiwayat({ to: "/p3", label: "P3" }, st);
  const r = bacaRiwayat(st);
  assert.equal(r.length, 6); assert.equal(r[0].to, "/p3");
  assert.equal(new Set(r.map((x) => x.to)).size, 6);
  st.setItem(KUNCI_RIWAYAT, "{rusak");
  assert.deepEqual(bacaRiwayat(st), []);
  assert.deepEqual(hapusRiwayat(st), []);
  const gagal = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } };
  assert.deepEqual(bacaRiwayat(gagal), []);
  assert.doesNotThrow(() => catatRiwayat({ to: "/x", label: "X" }, gagal));
  // palette hanya menyimpan nama + jenis untuk data (tanpa nomor HP / isi chat)
  assert.ok(palette.includes('const subRiwayat = r.jenis === "halaman" ? r.sub : ({ pelanggan: "Pelanggan", order: "Order", chat: "Chat WhatsApp" }[r.jenis] || "");'));
});

test("Spotlight: data lewat endpoint daftar yang sudah ada, limit kecil, chat nameOnly, respons basi dibuang, hanya untuk akses Sales CRM", () => {
  assert.ok(palette.includes("api.getCustomers({ search: s, page: 1, limit: batas })"));
  assert.ok(palette.includes("api.getOrders({ search: s, limit: batas })"));
  assert.ok(palette.includes("api.getConversations({ search: s, nameOnly: true, limit: batas })"), "chat tanpa full-scan isi pesan");
  assert.ok(palette.includes('const batas = lingkup === "semua" ? 4 : 12;'));
  assert.ok(palette.includes("if (seq.current === nomor)"), "respons basi dibuang");
  assert.ok(palette.includes("}, 250);"), "debounce");
  assert.ok(palette.includes('const bolehData = boleh.has("growth");'));
  assert.ok(palette.includes("api.getMyPortals()"), "hak lihat dari server (/auth/me)");
  assert.ok(palette.includes("new Set([wsSaatIni, \"hub\"].filter(Boolean))"), "gagal muat portal → hanya workspace saat ini");
  assert.ok(palette.includes("`/customers?id=${c.id}`") && palette.includes("`/inbox?conv=${x.id}`") && palette.includes("`/orders?id=${x.id}&cari=${encodeURIComponent(x.orderNumber || \"\")}`"));
  assert.ok(palette.includes('(e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")'));
  assert.ok(palette.includes('e.key === "Tab"') && palette.includes('role="combobox"') && palette.includes("aria-activedescendant"));
  assert.ok(palette.includes("<DaftarOverlay />"), "tumpukan overlay tetap terdaftar");
});

test("Layout: halaman lintas workspace disaring dengan aturan sidebar; driver tanpa daftar", () => {
  assert.ok(layout.includes("const halamanSemua = React.useMemo(() => {"));
  assert.ok(layout.includes("if (IS_DRIVER_APP || driverOnly) return [];"));
  assert.ok(layout.includes("tambah(k, filterMenuByPermission(DIVISIONS[k], { roles, divisiSaya }).sections);"));
  assert.ok(layout.includes("hubTerlihat(roles).forEach("));
  assert.ok(layout.includes("halamanSemua={halamanSemua}") && layout.includes('wsSaatIni={onHub ? "hub" : (divisionKey || null)}'));
});

test("Order: ?cari= mengisi kata cari sebelum fetch pertama, tab terbuka disinkronkan, ?id= menunggu daftar yang cocok", () => {
  assert.ok(orders.includes('const [cari, setCari]       = useState(() => searchParams.get("cari") || "");'));
  assert.ok(orders.includes('setData({ ...res, _cari: debounced || "" });'));
  assert.ok(orders.includes('if (c != null && (data._cari ?? "") !== c.trim()) return;'));
  assert.ok(orders.includes('prev.delete("id"); prev.delete("cari");'));
});

test("Notifikasi: drawer panel melayang + cari + segmen berhitung; baris ubin ikon per tipe; label Indonesia", () => {
  assert.ok(drawer.includes('"nt-panel fixed z-[201] flex flex-col outline-none"'));
  assert.ok(drawer.includes('placeholder="Cari notifikasi"') && drawer.includes('className="nt-segmen"') && drawer.includes("jumlahTab[t.key]"));
  assert.ok(drawer.includes("<DaftarOverlay />") && drawer.includes("<Dialog.Description"));
  assert.ok(drawer.includes("navigate(buildTargetUrl(notif))") && drawer.includes("markAsRead(notif.id)"), "perilaku klik tidak berubah");
  assert.ok(item.includes("const IKON_TIPE = {") && item.includes('data-belum={belumDibaca ? "true" : "false"}'));
  assert.ok(item.includes('aria-label={`${ws.label}: ${notif.title}. ${belumDibaca ? "Belum dibaca. " : ""}Buka.`}'));
  assert.ok(halamanNotif.includes('className="nt-segmen nt-segmen-halaman"') && halamanNotif.includes('<div className="nt-halaman">'));
  const tipe = baca("src/features/notifications/notificationTypes.js");
  assert.ok(tipe.includes('bengkel:   { label: "Produksi"') && tipe.includes('warehouse: { label: "Gudang"') && tipe.includes('system:    { label: "Sistem"'));
});

test("CSS: hanya kelas .sp-*/.nt-* (+ variabel di :root), tema gelap lewat data-theme, tanpa font/@import/url baru; dimuat setelah sanss-apple", () => {
  const tanpaKomentar = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/@import|@font-face|url\(/.test(tanpaKomentar));
  const selektor = tanpaKomentar.split("}").map((b) => b.split("{")[0].trim()).filter((x) => x && !x.startsWith("@") && !/^(from|to|\d)/.test(x));
  for (const s of selektor.join(",").split(",").map((x) => x.trim()).filter(Boolean)) {
    assert.ok(/^(:root(\[data-theme="dark"\]|:not\(\[data-theme="dark"\]\))?( |$))/.test(s) || /^\.(sp|nt)-/.test(s), `selektor di luar cakupan: ${s}`);
    assert.ok(s === ":root" || s === ':root[data-theme="dark"]' || /\.(sp|nt)-/.test(s), `selektor tanpa kelas sp/nt: ${s}`);
  }
  assert.ok(css.includes(':root[data-theme="dark"] {'));
  assert.ok(main.indexOf('import "./styles/sanss-cari.css";') > main.indexOf('import "./styles/sanss-apple.css";'));
});
