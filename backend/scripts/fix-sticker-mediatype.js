// Perbaiki pesan stiker WhatsApp yang telanjur tersimpan sebagai mediaType
// "image" (jadi nampang di tab "Foto" galeri media, bukan tab "Stiker").
//
// LATAR BELAKANG: lihat catatan panjang di src/utils/parseHistoryMessage.js
// (fungsi shared, dipanggil oleh handleGroupMessage & handleInboundMessage
// di routes/webhooks.js). Deteksi sticker SEBELUMNYA cuma baca
// `_data.Info.MediaType`, dan klaim komentar lama bahwa field itu "SELALU
// ada + eksplisit bilang sticker" untuk payload GOWS (engine aktif sistem
// ini — DIKONFIRMASI langsung via API produksi, lihat CLAUDE.md §13,
// dikoreksi 30 Agustus 2026 setelah percobaan pertama salah menyalahkan
// ini ke "sistem jalan di NOWEB") TERNYATA TIDAK TERBUKTI di produksi:
// 108 stiker nyata lolos sebagai mediaType "image" via mimeToMediaType()
// (stiker & foto asli sama-sama mimetype image/... jadi tidak bisa
// dibedakan lewat mimetype saja). Akar masalah persisnya tidak bisa
// dipastikan lagi (payload webhook lama tidak tersimpan) — bug PENULISAN
// sudah diperbaiki dengan sinyal yang tidak bergantung pada field
// kenyamanan WAHA yang mana pun: `rawMsg.stickerMessage`, nama field WIRE
// PROTOCOL WhatsApp sendiri (dipakai go-whatsmeow/GOWS maupun Baileys/
// NOWEB sama-sama — keduanya cuma implementasi client protokol yang sama);
// script ini membereskan baris yang sudah terlanjur tersimpan salah.
//
// SINYAL BACKFILL: ekstensi file ".webp" — SATU-SATUNYA cara WhatsApp
// mengirim gambar dalam format itu adalah stiker (foto asli dari kamera/
// galeri HP selalu jpeg, kadang heic dari iPhone — TIDAK PERNAH webp).
// Ekstensi ditentukan resolveMediaExt() dari MIME asli/magic-bytes file
// yang SUDAH terunduh (lihat utils/mediaExt.js), bukan tebakan — jadi
// ".webp" di sini pasti mencerminkan isi file sungguhan, bukan salah baca
// nama. Dibatasi HANYA mediaType="image" (dokumen .webp yang dikirim
// sengaja sebagai lampiran biasa mediaType-nya "document", tidak tersentuh).
//
// PEMAKAIAN (dry-run dulu, JANGAN langsung --apply):
//   docker compose exec backend node scripts/fix-sticker-mediatype.js
//   docker compose exec backend node scripts/fix-sticker-mediatype.js --apply
//
// AMAN DIJALANKAN BERKALI-KALI (idempoten) — WHERE mediaType="image" berarti
// baris yang sudah dibetulkan run sebelumnya otomatis tidak lagi cocok.
// Cuma mengubah kolom Message.mediaType, TIDAK menyentuh file/mediaUrl.

import { prisma } from "../src/db.js";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`\n=== fix-sticker-mediatype.js — mode: ${APPLY ? "APPLY (mengubah data)" : "DRY-RUN (tidak mengubah apa pun)"} ===\n`);

  const where = { mediaType: "image", mediaUrl: { endsWith: ".webp" } };
  const jumlah = await prisma.message.count({ where });
  console.log(`Pesan mediaType="image" berekstensi .webp (= stiker salah label): ${jumlah}`);

  if (jumlah === 0) {
    console.log("\nTidak ada yang perlu diperbaiki.\n");
    await prisma.$disconnect();
    return;
  }

  if (!APPLY) {
    const contoh = await prisma.message.findMany({
      where, take: 5,
      select: { id: true, mediaUrl: true, conversationId: true, createdAt: true },
    });
    console.log("\nContoh 5 baris pertama yang akan diubah jadi mediaType=\"sticker\":");
    contoh.forEach((r) => console.log(`  ${r.id}  ${r.mediaUrl}  (conv ${r.conversationId}, ${r.createdAt.toISOString().slice(0, 10)})`));
    console.log("\n(DRY-RUN — tidak ada yang diubah. Jalankan ulang dengan --apply untuk menerapkan.)\n");
    await prisma.$disconnect();
    return;
  }

  const hasil = await prisma.message.updateMany({ where, data: { mediaType: "sticker" } });
  console.log(`\n=== SELESAI ===`);
  console.log(`Baris diupdate: ${hasil.count}\n`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
