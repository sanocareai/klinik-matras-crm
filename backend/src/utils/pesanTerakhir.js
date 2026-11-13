// Pesan terakhir per percakapan TANPA memuat seluruh riwayat (optimasi 13 Nov 2026).
//
// Kenapa ada: Prisma 5 menerjemahkan `include: { messages: { orderBy, take: N } }`
// pada findMany (atau relasi bertingkat) menjadi SATU query
// `WHERE "conversationId" IN (...) ORDER BY "createdAt" DESC` TANPA LIMIT — semua
// pesan dari semua percakapan itu ditarik dari database, lalu dipotong jadi N per
// percakapan di memori. Terbukti lewat log query (audit 13 Nov 2026); di produksi
// list Inbox jadi ±1,4 detik karena grup WA berisi ribuan pesan.
//
// Di sini: (1) LATERAL ... LIMIT N per percakapan memakai indeks
// [conversationId, createdAt desc] yang sudah ada → cuma id pesan yang dipakai;
// (2) findMany by id dengan `select` yang SAMA seperti sebelumnya → bentuk objek
// identik dengan hasil include lama (enum, tanggal, nama field), urut terbaru
// dulu, jadi pemanggil & frontend tidak berubah.
import { Prisma } from "@prisma/client";

const UKURAN_POTONGAN = 5000;

const terbaruDulu = (a, b) => (b.createdAt - a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * Isi `messages` (N pesan terbaru, urut terbaru dulu; `[]` bila kosong) pada tiap percakapan.
 * @param {import("@prisma/client").PrismaClient} prisma  — boleh klien transaksi
 * @param {Array<{id: string}>} percakapan               — dimutasi DAN dikembalikan
 * @param {{ select?: object, jumlah?: number }} [opsi]  — `select` Prisma untuk Message (kosong = semua kolom); jumlah default 1
 */
export async function lampirkanPesanTerakhir(prisma, percakapan, { select, jumlah = 1 } = {}) {
  if (!percakapan.length) return percakapan;
  const ids = [...new Set(percakapan.map((c) => c.id))];
  // conversationId + createdAt + id dibutuhkan untuk memetakan & mengurutkan; dibuang lagi bila tidak diminta
  const tambahan = select ? ["conversationId", "createdAt", "id"].filter((k) => !select[k]) : [];
  const pesan = [];
  // Per potongan: audiens broadcast bisa ribuan percakapan; Postgres membatasi
  // jumlah parameter per query (32.767).
  for (let i = 0; i < ids.length; i += UKURAN_POTONGAN) {
    const potongan = ids.slice(i, i + UKURAN_POTONGAN);
    const baris = await prisma.$queryRaw`
      SELECT m.id
      FROM unnest(ARRAY[${Prisma.join(potongan)}]::text[]) AS c(id)
      CROSS JOIN LATERAL (
        SELECT id FROM "Message"
        WHERE "conversationId" = c.id
        ORDER BY "createdAt" DESC, id DESC
        LIMIT ${jumlah}
      ) m`;
    if (!baris.length) continue;
    pesan.push(...(await prisma.message.findMany({
      where: { id: { in: baris.map((b) => b.id) } },
      ...(select ? { select: { ...select, conversationId: true, createdAt: true, id: true } } : {}),
    })));
  }
  const perPercakapan = new Map();
  for (const m of pesan.sort(terbaruDulu)) {
    const cid = m.conversationId;
    for (const k of tambahan) delete m[k];
    if (!perPercakapan.has(cid)) perPercakapan.set(cid, []);
    perPercakapan.get(cid).push(m);
  }
  for (const c of percakapan) c.messages = perPercakapan.get(c.id) || [];
  return percakapan;
}
