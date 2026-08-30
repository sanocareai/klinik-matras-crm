// Perbaiki pesan stiker WhatsApp yang telanjur tersimpan sebagai mediaType
// "image" (jadi nampang di tab "Foto" galeri media, bukan tab "Stiker").
//
// LATAR BELAKANG: lihat catatan panjang di src/utils/parseHistoryMessage.js
// (fungsi shared, dipanggil oleh handleGroupMessage & handleInboundMessage
// di routes/webhooks.js). Deteksi sticker SEBELUMNYA cuma baca
// `_data.Info.MediaType` — field itu KHUSUS GOWS, dan sistem ini jalan di
// NOWEB (lihat CLAUDE.md §13). Akibatnya rawMediaType SELALU null untuk
// lalu lintas nyata, dan stiker (mimetype image/webp — tidak bisa dibedakan
// dari foto asli lewat mimetype saja) lolos sebagai mediaType "image" via
// mimeToMediaType(). Bug PENULISAN sudah diperbaiki (rawMsg.stickerMessage
// dari raw Baileys/GOWS message SEKARANG ikut dicek, jalan di dua engine);
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
