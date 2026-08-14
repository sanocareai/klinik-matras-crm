// Menggabungkan beberapa gambar promo jadi SATU gambar berbentuk kolase.
//
// KENAPA DIGABUNG SENDIRI, bukan pakai fitur album WhatsApp. WhatsApp
// memang punya tampilan album (beberapa foto dalam satu kisi), tapi API
// yang kita pakai TIDAK bisa mengirimnya: WAHA yang terpasang di server
// ini bertier CORE (diperiksa 14 Agt 2026 — /api/sendAlbum, /api/sendImages,
// /api/sendMediaGroup semuanya menjawab 404). Album adalah fitur WAHA PLUS
// berbayar.
//
// Jadi satu-satunya cara memunculkan tampilan "kisi" tanpa mengganti tier
// adalah menyusun kisinya sendiri jadi satu berkas gambar, lalu mengirim
// gambar itu sebagai satu pesan biasa. Efek sampingnya JUJUR: penerima
// tidak bisa menekan satu foto untuk melihatnya penuh, dan tiap gambar
// jadi lebih kecil — untuk desain promo yang penuh tulisan, ini bisa
// membuat teksnya susah dibaca di layar HP. Karena itu fitur ini dibuat
// sebagai PILIHAN per kampanye, bukan perilaku wajib.

import sharp from "sharp";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, "../../uploads");

// Lebar akhir kolase. 1080 px = lebar yang lazim dipakai konten sosial dan
// cukup tajam di HP, tanpa membuat berkasnya besar (WhatsApp mengompres
// ulang gambar besar, jadi menaikkan angka ini tidak menambah ketajaman).
const LEBAR_KOLASE = 1080;
const JARAK = 8; // sela antar gambar, meniru kisi album WhatsApp
const LATAR = { r: 255, g: 255, b: 255, alpha: 1 };

/** Nama berkas kolase dibuat dari id kampanye supaya bisa ditimpa & dicari lagi. */
export function jalurKolase(campaignId) {
  return `/uploads/kolase-${campaignId}.jpg`;
}

/**
 * Susun kolase dari daftar path gambar (mis. "/uploads/xxx.jpg").
 *
 * Tata letak mengikuti kebiasaan album WhatsApp:
 *   2 gambar  -> 2 kolom, 1 baris
 *   3-4       -> 2 kolom, 2 baris
 *   5+        -> 3 kolom, sisanya turun ke baris berikutnya
 *
 * @returns {Promise<string|null>} path publik kolase, atau null kalau
 *   gambarnya kurang dari 2 (tidak ada yang perlu digabung).
 */
export async function buatKolase(imagePaths, campaignId) {
  const daftar = (imagePaths || []).filter(Boolean);
  if (daftar.length < 2) return null;

  const kolom = daftar.length === 2 ? 2 : daftar.length <= 4 ? 2 : 3;
  const baris = Math.ceil(daftar.length / kolom);

  // Tiap sel berbentuk persegi. Dipakai "cover" (bukan "contain") supaya
  // tidak ada bidang kosong di dalam sel — bagian tepi gambar boleh
  // terpotong, itu perilaku yang sama dengan album WhatsApp asli.
  const sisiSel = Math.floor((LEBAR_KOLASE - JARAK * (kolom - 1)) / kolom);
  const tinggiTotal = baris * sisiSel + JARAK * (baris - 1);

  const lapisan = [];
  for (let i = 0; i < daftar.length; i++) {
    const berkas = path.join(UPLOADS_DIR, path.basename(daftar[i]));
    if (!fs.existsSync(berkas)) continue;

    const sel = await sharp(berkas)
      .resize(sisiSel, sisiSel, { fit: "cover", position: "centre" })
      .toBuffer();

    lapisan.push({
      input: sel,
      left: (i % kolom) * (sisiSel + JARAK),
      top: Math.floor(i / kolom) * (sisiSel + JARAK),
    });
  }

  if (lapisan.length < 2) return null; // berkas hilang di disk — jangan paksa

  const tujuan = path.join(UPLOADS_DIR, `kolase-${campaignId}.jpg`);
  await sharp({
    create: {
      width: LEBAR_KOLASE,
      height: tinggiTotal,
      channels: 4,
      background: LATAR,
    },
  })
    .composite(lapisan)
    .jpeg({ quality: 88 })
    .toFile(tujuan);

  return jalurKolase(campaignId);
}

/** Hapus kolase lama supaya tidak ada berkas basi yang ikut terkirim. */
export function hapusKolase(campaignId) {
  const berkas = path.join(UPLOADS_DIR, `kolase-${campaignId}.jpg`);
  fs.unlink(berkas, () => {});
}
