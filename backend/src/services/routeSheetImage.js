// ─── Gambar "sheet" rute — pengganti Google Sheets manual (6 September 2026) ─
//
// Laporan owner: contoh flow kerja SAAT INI adalah Natasha screenshot
// Google Sheets manual (kolom: tanggal, tipe, order, customer, HP, ukuran
// kasur, estimasi jam, urutan, driver, alamat) lalu kirim sebagai GAMBAR ke
// grup driver, DIIKUTI pesan teks ringkas (hari/kendaraan/driver/link Maps/
// catatan per-customer). Owner minta detail lengkap TAPI khawatir teks jadi
// kepanjangan — jawabannya: gambar tabel untuk detail per-stop, teks tetap
// ringkas untuk header+link+catatan (persis pola manual yang sudah ada).
//
// PILIHAN TEKNIS: SVG string + `sharp` (SUDAH jadi dependency, dipakai
// services/kolaseGambar.js untuk kolase foto promo) untuk rasterize ke PNG —
// BUKAN node-canvas/@napi-rs/canvas (dependency baru) ATAU Puppeteer/headless
// Chromium (jauh lebih berat, butuh ratusan MB + system deps tambahan di
// image Docker). `sharp` sudah bisa terima SVG sebagai input & render ke PNG
// langsung (librsvg terbundel di binary prebuilt-nya) — zero dependency baru,
// sesuai filosofi "hemat biaya, mudah dimaintain 1 orang" (CLAUDE.md §2).
//
// Text wrapping SVG dilakukan manual (estimasi lebar karakter, bukan
// pengukuran font sungguhan — SVG <text> tidak auto-wrap). Cukup akurat
// untuk tabel info, TIDAK diklaim presisi typografi.

import sharp from "sharp";
import { parseOrderNotesForInvoice, produkLineLabel } from "./invoice.js";

const KOLOM = [
  { key: "no", label: "No", width: 36, align: "center" },
  // No. Resi (8 September 2026, permintaan owner: "gambar tidak ada nomer
  // resi, tambahkan nomer resi setelah no., atau sebelum Tipe") — order
  // number-nya sendiri SUDAH ada di data baris (dipakai formatRouteWaMessage
  // teks pendamping gambar ini), cuma belum pernah ditampilkan di KOLOM
  // tabel gambar. Lebar 130 cukup untuk format "RES-30082026-205" (paling
  // panjang di antara 3 prefix RES/SWS/NEW) satu baris tanpa wrap.
  { key: "resi", label: "No. Resi", width: 130, align: "center" },
  { key: "tipe", label: "Tipe", width: 96, align: "center" },
  { key: "customer", label: "Customer", width: 190 },
  { key: "phone", label: "No. HP", width: 130 },
  { key: "produk", label: "Produk & Ukuran", width: 190 },
  { key: "alamat", label: "Alamat", width: 320 },
  { key: "estimasi", label: "Estimasi Jam", width: 150 },
];
const LEBAR = KOLOM.reduce((s, k) => s + k.width, 0);
const TINGGI_HEADER = 40;
const PAD_X = 8;
const PAD_Y_ATAS = 22;
const TINGGI_BARIS_MIN = 34;
const TINGGI_BARIS_ISI = 15; // per baris teks di dalam sel (setelah wrap)
const FONT_SIZE = 12;
const LEBAR_KARAKTER = FONT_SIZE * 0.56; // estimasi kasar, cukup utk tabel info

function escapeXml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]
  ));
}

// Pecah teks jadi baris yang muat di `width` (px), estimasi kasar per
// karakter — greedy word-wrap standar. Baris kosong ("") tetap 1 baris
// kosong (bukan dihilangkan) supaya tinggi sel konsisten kalau dipanggil
// berulang dengan input campuran ada/tidaknya teks.
function wrapText(text, width) {
  const maxChars = Math.max(4, Math.floor(width / LEBAR_KARAKTER));
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// TIPE — DIBALIK 8 September 2026 (laporan owner, screenshot gambar ini:
// "dibagian tipe pengiriman warna hijau, pengambilan warna biru untuk
// pembeda"). SEBELUMNYA sengaja kuning terisi untuk KEDUANYA (meniru
// kebiasaan visual Sheets manual Natasha) — owner sekarang eksplisit minta
// dibedakan warnanya. Dipilih BIRU=Pengambilan/HIJAU=Pengiriman supaya
// SATU bahasa visual dengan yang sudah ada di tempat lain: emoji
// 🔵/🟢 di formatRouteWaMessage (armada.js, teks broadcast yang menyertai
// gambar ini), dan konvensi accent=PICKUP/green=DELIVERY yang sudah
// dipakai jobTypeCardStyle()/ConfirmedTimeBadge di app (frontend). Hex
// diambil dari token tema TERANG (`--accent`/`--green` + versi 10%-nya di
// atas putih, tokens.css) — gambar ini statis/tidak theme-aware, dihitung
// manual (bukan rgba() di fill, biar konsisten solid seperti sebelumnya).
const WARNA_TIPE = {
  PICKUP: { bg: "#e7eefb", teks: "#1457d9" }, // biru — samakan dgn --accent terang
  DELIVERY: { bg: "#e9f3ec", teks: "#248a3d" }, // hijau — samakan dgn --green terang
};

export async function buildRouteSheetImage(route) {
  const jobs = route.jobs || [];
  if (jobs.length === 0) return null;

  const baris = jobs.map((j, idx) => {
    const order = j.order || j.units?.[0]?.unit?.order;
    const customer = order?.customer?.name || "Tanpa nama";
    const phone = order?.customer?.phone || "-";
    const tipe = j.type === "PICKUP" ? "PENGAMBILAN" : "PENGIRIMAN";
    const alamat = j.addressText?.trim() || "(alamat belum diisi)";
    const estimasi = j.timeWindow?.trim() || "-";
    // produk/ukuran — pola SAMA persis dgn stopLines di formatRouteWaMessage
    // (armada.js): produkLineLabel (Lini+Jenis, tanpa duplikasi kata) +
    // ukuranKasur dari parseOrderNotesForInvoice, KHUSUS productLine KASUR.
    let produk = "-";
    if (order) {
      const bagian = [produkLineLabel(order)];
      if (order.productLine === "KASUR") {
        const { ukuranKasur } = parseOrderNotesForInvoice(order.notes);
        if (ukuranKasur) bagian.push(ukuranKasur);
      }
      produk = bagian.join(" · ");
    }

    const resi = order?.orderNumber || "-";

    return { no: String(idx + 1), resi, tipe, tipeRaw: j.type, customer, phone, produk, alamat, estimasi };
  });

  // Hitung tinggi tiap baris dari kolom PALING BANYAK wrap (biasanya Alamat
  // atau Produk) — semua sel dalam 1 baris tabel harus tinggi yang sama.
  const wrapped = baris.map((b) =>
    KOLOM.reduce((acc, k) => {
      acc[k.key] = wrapText(b[k.key], k.width - PAD_X * 2);
      return acc;
    }, {})
  );
  const tinggiBaris = wrapped.map((w) =>
    Math.max(TINGGI_BARIS_MIN, Math.max(...Object.values(w).map((lines) => lines.length)) * TINGGI_BARIS_ISI + 14)
  );
  const tinggiTotal = TINGGI_HEADER + tinggiBaris.reduce((s, h) => s + h, 0);

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${LEBAR}" height="${tinggiTotal}" font-family="Arial, sans-serif">`);
  parts.push(`<rect x="0" y="0" width="${LEBAR}" height="${tinggiTotal}" fill="#ffffff"/>`);

  // Header
  let x = 0;
  parts.push(`<rect x="0" y="0" width="${LEBAR}" height="${TINGGI_HEADER}" fill="#1e2139"/>`);
  for (const k of KOLOM) {
    const tx = k.align === "center" ? x + k.width / 2 : x + PAD_X;
    const anchor = k.align === "center" ? "middle" : "start";
    parts.push(`<text x="${tx}" y="${TINGGI_HEADER / 2 + 4}" font-size="12.5" font-weight="700" fill="#ffffff" text-anchor="${anchor}">${escapeXml(k.label)}</text>`);
    x += k.width;
  }

  // Baris
  let y = TINGGI_HEADER;
  wrapped.forEach((w, i) => {
    const h = tinggiBaris[i];
    const bgBaris = i % 2 === 0 ? "#ffffff" : "#f8fafc";
    parts.push(`<rect x="0" y="${y}" width="${LEBAR}" height="${h}" fill="${bgBaris}"/>`);

    let cx = 0;
    for (const k of KOLOM) {
      if (k.key === "tipe") {
        // Chip biru/hijau per tipe (lihat catatan WARNA_TIPE di atas)
        const warna = WARNA_TIPE[baris[i].tipeRaw] || WARNA_TIPE.DELIVERY;
        parts.push(`<rect x="${cx + 4}" y="${y + h / 2 - 11}" width="${k.width - 8}" height="22" rx="4" fill="${warna.bg}"/>`);
        parts.push(`<text x="${cx + k.width / 2}" y="${y + h / 2 + 4}" font-size="10.5" font-weight="700" fill="${warna.teks}" text-anchor="middle">${escapeXml(w.tipe[0])}</text>`);
      } else {
        const lines = w[k.key];
        const anchor = k.align === "center" ? "middle" : "start";
        const tx = k.align === "center" ? cx + k.width / 2 : cx + PAD_X;
        const totalTinggiTeks = lines.length * TINGGI_BARIS_ISI;
        const yMulai = y + h / 2 - totalTinggiTeks / 2 + TINGGI_BARIS_ISI - 4;
        lines.forEach((line, li) => {
          parts.push(`<text x="${tx}" y="${yMulai + li * TINGGI_BARIS_ISI}" font-size="${FONT_SIZE}" fill="#1f2937" text-anchor="${anchor}">${escapeXml(line)}</text>`);
        });
      }
      cx += k.width;
    }
    y += h;
  });

  // Garis vertikal antar kolom (tipis, biar terasa "tabel" bukan cuma teks bersisian)
  let vx = 0;
  for (const k of KOLOM) {
    vx += k.width;
    if (vx < LEBAR) parts.push(`<line x1="${vx}" y1="0" x2="${vx}" y2="${tinggiTotal}" stroke="#e5e7eb" stroke-width="1"/>`);
  }

  parts.push(`</svg>`);
  const svg = parts.join("");

  return sharp(Buffer.from(svg)).png().toBuffer();
}
