// Pencarian global (Spotlight ⌘K) — fungsi murni tanpa React supaya bisa diuji lewat `node --test`.
// Halaman dicari di sisi browser (daftar menu yang BOLEH dilihat pengguna — sumber sama dengan sidebar);
// data (pelanggan/order/percakapan) dicari di server lewat endpoint daftar yang sudah ada, jadi hak akses
// tetap ditegakkan server. Berkas ini hanya menormalkan teks, memberi skor, dan menyimpan riwayat.

// Label workspace untuk baris hasil & kelompok. Kunci = kunci portal backend (constants/permissions.js) + "hub".
export const WORKSPACE_CARI = Object.freeze({
  hub:       { label: "Main Hub",  warna: "abu" },
  growth:    { label: "Sales CRM", warna: "biru" },
  bengkel:   { label: "Produksi",  warna: "oranye" },
  warehouse: { label: "Gudang",    warna: "hijau" },
  armada:    { label: "Delivery",  warna: "nila" },
  kendali:   { label: "All Teams", warna: "ungu" },
  finance:   { label: "Finance",   warna: "teal" },
  b2b:       { label: "B2B",       warna: "merah-muda" },
});

// Huruf kecil, tanpa diakritik, spasi dirapatkan — "Pengirìman  Barang" ≈ "pengiriman barang".
export function normalisasi(teks) {
  return String(teks ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

// Skor satu halaman untuk kueri. 0 = tidak cocok. Semua kata kueri harus ada (di label, section, atau workspace);
// label yang DIAWALI kueri paling tinggi, lalu awal kata, lalu kecocokan di mana pun, lalu hanya di section/workspace.
export function skorHalaman(h, kueri) {
  const q = normalisasi(kueri);
  if (!q) return 1;
  const label = normalisasi(h.label);
  const konteks = normalisasi(`${h.section || ""} ${h.wsLabel || ""} ${(h.kata || []).join(" ")}`);
  const kata = q.split(" ");
  if (!kata.every((k) => label.includes(k) || konteks.includes(k))) return 0;
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.split(" ").some((w) => w.startsWith(kata[0]))) return 60;
  if (label.includes(q)) return 40;
  if (kata.some((k) => label.includes(k))) return 25;
  return 10;
}

// Cari halaman: hasil diurutkan skor menurun; seri → workspace saat ini dulu, lalu urutan menu asli.
// Duplikat rute (mis. Kasus Komplain di beberapa workspace) dirapatkan: yang di workspace saat ini menang.
export function cariHalaman(daftar, kueri, { wsSaatIni = null, batas = 8 } = {}) {
  const terlihat = new Map();
  (daftar || []).forEach((h, i) => {
    const s = skorHalaman(h, kueri);
    if (!s) return;
    const kunci = h.to;
    const kandidat = { h, s: s + (h.ws === wsSaatIni ? 5 : 0), i };
    const lama = terlihat.get(kunci);
    if (!lama || kandidat.s > lama.s) terlihat.set(kunci, kandidat);
  });
  return [...terlihat.values()].sort((a, b) => b.s - a.s || a.i - b.i).slice(0, batas).map((x) => x.h);
}

// Potong teks jadi segmen [{teks, cocok}] untuk menebalkan bagian yang cocok dengan kueri (tanpa innerHTML).
export function sorot(teks, kueri) {
  const asli = String(teks ?? "");
  const kata = normalisasi(kueri).split(" ").filter((k) => k.length > 0);
  if (!kata.length || !asli) return [{ teks: asli, cocok: false }];
  const datar = normalisasi(asli);
  // normalisasi() bisa merapatkan spasi → indeks bergeser; hanya sorot bila panjangnya tetap sama.
  if (datar.length !== asli.length) return [{ teks: asli, cocok: false }];
  const tanda = new Array(asli.length).fill(false);
  for (const k of kata) {
    let dari = 0;
    for (;;) {
      const j = datar.indexOf(k, dari);
      if (j < 0) break;
      for (let x = j; x < j + k.length; x++) tanda[x] = true;
      dari = j + k.length;
    }
  }
  const hasil = [];
  for (let i = 0; i < asli.length; i++) {
    const akhir = hasil[hasil.length - 1];
    if (akhir && akhir.cocok === tanda[i]) akhir.teks += asli[i];
    else hasil.push({ teks: asli[i], cocok: tanda[i] });
  }
  return hasil;
}

// Kueri data layak dikirim ke server? Minimal 2 karakter (nomor HP minimal 3 digit) supaya tiap ketikan tidak jadi query berat.
export function kueriDataLayak(kueri) {
  const q = String(kueri ?? "").trim();
  if (q.length < 2) return false;
  if (/^[+\d\s-]+$/.test(q)) return q.replace(/\D/g, "").length >= 3;
  return true;
}

// Nomor HP: server menyimpan "62…"; orang mengetik "0812…" atau "+62 812-…". Ubah ke bentuk yang cocok dengan kolom phone.
export function kueriUntukServer(kueri) {
  const q = String(kueri ?? "").trim();
  if (/^[+\d\s-]+$/.test(q)) {
    const d = q.replace(/\D/g, "");
    return d.startsWith("0") ? "62" + d.slice(1) : d;
  }
  return q;
}

// ── Riwayat "Terakhir dibuka" (per peramban; boleh hilang kapan saja) ──────────────────────────────
export const KUNCI_RIWAYAT = "sanss.cari.riwayat.v1";
const MAKS_RIWAYAT = 6;

export function bacaRiwayat(store = globalThis.localStorage) {
  try {
    const arr = JSON.parse(store?.getItem(KUNCI_RIWAYAT) || "[]");
    return Array.isArray(arr) ? arr.filter((r) => r && typeof r.to === "string" && typeof r.label === "string").slice(0, MAKS_RIWAYAT) : [];
  } catch { return []; }
}

// Simpan entri di depan; entri dengan rute sama dibuang dulu. Hanya field ringan (tanpa data pribadi lengkap).
export function catatRiwayat(entri, store = globalThis.localStorage) {
  if (!entri?.to || !entri?.label) return bacaRiwayat(store);
  const ringkas = { jenis: entri.jenis || "halaman", to: entri.to, label: String(entri.label).slice(0, 80), sub: entri.sub ? String(entri.sub).slice(0, 80) : "", ws: entri.ws || null };
  const baru = [ringkas, ...bacaRiwayat(store).filter((r) => r.to !== ringkas.to)].slice(0, MAKS_RIWAYAT);
  try { store?.setItem(KUNCI_RIWAYAT, JSON.stringify(baru)); } catch { /* penyimpanan boleh gagal */ }
  return baru;
}

export function hapusRiwayat(store = globalThis.localStorage) {
  try { store?.removeItem(KUNCI_RIWAYAT); } catch { /* abaikan */ }
  return [];
}

// Remah pertama breadcrumb: ke mana ia membawa? Section ("Analitik", "Data") → halaman PERTAMA section itu yang boleh
// dilihat; nama workspace ("Delivery", "Gudang") → beranda workspace (halaman pertama menunya). Tidak pernah ke Main Hub
// (ikon rumah sudah untuk itu). null = tidak ada tujuan (teks biasa).
export function tujuanRemah(teks, halaman, { wsLabel = null, pathname = "" } = {}) {
  const daftar = Array.isArray(halaman) ? halaman : [];
  const t = normalisasi(teks);
  if (!t || !daftar.length) return null;
  const sama = daftar.filter((h) => normalisasi(h.section) === t);
  let tujuan = null;
  if (sama.length) tujuan = sama[0].to;
  else if (wsLabel && normalisasi(wsLabel) === t) tujuan = daftar[0].to;
  else if (["delivery", "gudang", "produksi", "finance", "sales crm", "b2b", "all teams"].includes(t)) tujuan = daftar[0].to;
  if (!tujuan) return null;
  const jalur = tujuan.split("?")[0];
  return jalur === pathname ? null : tujuan;
}

// Anggota section untuk menu remah (≥2 halaman → tampil sebagai pilihan, bukan satu tautan).
export function anggotaSection(teks, halaman) {
  const t = normalisasi(teks);
  return (Array.isArray(halaman) ? halaman : []).filter((h) => normalisasi(h.section) === t);
}
