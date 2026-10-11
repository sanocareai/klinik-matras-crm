// Perpindahan kepemilikan percakapan: klaim otomatis (balasan pertama), ambil alih (takeover), dan transfer admin.
// Satu tempat supaya tiga jalur itu memakai aturan yang SAMA dan dapat dites tanpa HTTP. prisma diinjeksi.
//
// Audit 11 Okt 2026 menemukan (data produksi + kode):
//  • BALAPAN: dua klaim/ambil alih yang nyaris bersamaan sama-sama "berhasil" — pemegang akhir = penulis terakhir, KEDUANYA tercatat di riwayat
//    dan dua-duanya melihat "berhasil" (kejadian nyata: auto-claim Ervina & Risel pada detik yang sama; auto-claim dobel atas nama yang sama).
//    Sekarang penulisan bersyarat: hanya berhasil bila pemegangnya masih seperti yang dibaca.
//  • Transfer tanpa validasi tujuan (pernah ditransfer ke akun Driver/Helper) dan tanpa memperbarui catatan serah-terima (banner basi).
//  • Tiga tulisan terpisah tanpa transaksi → bila salah satu gagal, percakapan terlanjur pindah tapi riwayat/label tidak.
import { rolesOf } from "../middleware/authorize.js";
import { statusBelumDibalas } from "./belumDibalas.js";
import { orderTerdampak, siapkanDaftar, terapkanKeputusanKredit } from "./kreditOrderPerpindahan.js";

export const AMBANG_AMBIL_ALIH_MENIT = 60;
export const PERAN_BOLEH_MEMEGANG = ["SALES", "ADMIN"];

export class PerpindahanError extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.name = "PerpindahanError";
    this.statusCode = statusCode;
    if (code) this.code = code;
  }
}

/** Definisi SATU-satunya "boleh diambil alih" (sama dengan GET /conversations): belum ada pemegang, atau belum dibalas ≥ 60 menit. Tidak bergantung pemanggil. */
export function bolehDiambilAlih({ assignedToId, isUnanswered, unansweredMinutes }) {
  return !assignedToId || (!!isUnanswered && (unansweredMinutes ?? 0) >= AMBANG_AMBIL_ALIH_MENIT);
}

/**
 * Klaim otomatis saat SALES membalas percakapan yang belum bertuan. Mengembalikan true bila KLAIM ini yang berhasil.
 * Bersyarat di database: kalau orang lain sudah mengklaim di antara pembacaan dan penulisan, tidak ada yang ditimpa dan tidak ada event ganda.
 */
export async function klaimJikaBelumDimiliki(prisma, { conversation, user, messageCreatedAt }) {
  if (!rolesOf(user).includes("SALES")) return false;
  if (conversation.assignedToId) return false;
  if (conversation.type === "GROUP") return false;
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.conversation.updateMany({ where: { id: conversation.id, assignedToId: null }, data: { assignedToId: user.id } });
    if (count === 0) return false;
    if (conversation.customerId) {
      // Label hanya diisi bila masih kosong (aturan lama): pemilik lead dari percakapan lain tidak dirampas diam-diam.
      await tx.customer.updateMany({ where: { id: conversation.customerId, assignedSalesId: null }, data: { assignedSalesId: user.id } });
    }
    await tx.handoverEvent.create({
      data: { conversationId: conversation.id, fromUserId: null, toUserId: user.id, reason: "auto-claim", createdAt: messageCreatedAt },
    });
    return true;
  });
}

/** Ambil alih untuk `user`. Melempar PerpindahanError; mengembalikan percakapan terbaru + field turunan untuk klien. */
export async function ambilAlihPercakapan(prisma, { conversationId, user, sekarang = Date.now() }) {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { customer: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!conv) throw new PerpindahanError("Percakapan tidak ditemukan", 404);
  if (conv.type === "GROUP" || !conv.customerId) throw new PerpindahanError("Percakapan grup tidak bisa diambil alih", 400);
  if (conv.assignedToId === user.id) throw new PerpindahanError("Percakapan ini sudah jadi lead kamu", 400);

  const status = statusBelumDibalas(conv.messages[0] || null, sekarang);
  const isAdmin = rolesOf(user).includes("ADMIN");
  if (!isAdmin && !bolehDiambilAlih({ assignedToId: conv.assignedToId, ...status })) {
    throw new PerpindahanError("Percakapan ini masih ditangani sales lain, belum lewat 1 jam", 403);
  }

  const lamaId = conv.assignedToId;
  const prev = lamaId ? await prisma.user.findUnique({ where: { id: lamaId }, select: { name: true } }) : null;
  const prevName = prev?.name || null;
  const handoverNote = prevName
    ? `Percakapan diambil alih dari ${prevName} oleh ${user.name}. Cek riwayat chat di atas untuk konteks sebelumnya.`
    : `Percakapan diambil oleh ${user.name}.`;

  const hasil = await prisma.$transaction(async (tx) => {
    // Bersyarat: hanya berhasil bila pemegangnya MASIH yang tadi dibaca (lawan balapan dua orang menekan "Ambil" bersamaan).
    const { count } = await tx.conversation.updateMany({ where: { id: conv.id, assignedToId: lamaId }, data: { assignedToId: user.id, handoverNote } });
    if (count === 0) throw new PerpindahanError("Percakapan ini baru saja diambil atau dipindahkan orang lain — muat ulang lalu coba lagi", 409, "SUDAH_BERPINDAH");
    await tx.customer.update({ where: { id: conv.customerId }, data: { assignedSalesId: user.id } });
    await tx.handoverEvent.create({ data: { conversationId: conv.id, fromUserId: lamaId || null, toUserId: user.id, reason: "takeover" } });
    // Kredit closing TIDAK ikut berpindah saat ambil alih (keputusan Owner 11 Okt 2026): order pelanggan ini yang kreditnya ada pada pemegang lama
    // dikunci ke dia. Yang mengambil alih mendapat kredit untuk order BARU yang dia buat (pemilik order = pembuat), bukan order lama orang lain.
    if (lamaId) {
      const terdampak = await orderTerdampak(tx, { customerId: conv.customerId, dariUserId: lamaId });
      await terapkanKeputusanKredit(tx, { daftar: siapkanDaftar(terdampak), keputusan: [], dariUserId: lamaId, keUserId: user.id, aktorId: user.id, alasan: "" });
    }
    await tx.note.create({
      data: { customerId: conv.customerId, authorId: user.id, content: prevName ? `🔄 Lead diambil alih dari ${prevName} oleh ${user.name}` : `✅ ${user.name} mengambil lead ini` },
    });
    return tx.conversation.findUnique({
      where: { id: conv.id },
      include: { customer: true, assignedTo: { select: { id: true, name: true, avatarUrl: true } } },
    });
  });
  return { ...hasil, ...status, canTakeOver: bolehDiambilAlih({ assignedToId: hasil.assignedToId, ...status }) };
}

/** Peran user tujuan: baris user_roles bila ada, kalau tidak kolom role lama (aturan sama dengan rolesOf/loadRoles). */
async function perankanTujuan(prisma, userId) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, active: true, role: true } });
  if (!u) return null;
  const baris = await prisma.userRole.findMany({ where: { userId }, select: { role: true } });
  return { ...u, roles: baris.length > 0 ? baris.map((r) => r.role) : [u.role] };
}

/**
 * Transfer oleh admin. `dataLain` = field PATCH lain (status/unread/…) yang ikut ditulis di update yang sama.
 * assignedToId === null = melepas pemegang (perilaku lama dipertahankan, tanpa event).
 */
export async function transferPercakapan(prisma, { conversationId, assignedToId, actor, dataLain = {}, keputusanOrder = [], alasanOrder = "" }) {
  const sebelum = await prisma.conversation.findUnique({
    where: { id: conversationId }, select: { id: true, assignedToId: true, customerId: true, type: true },
  });
  if (!sebelum) throw new PerpindahanError("Percakapan tidak ditemukan", 404);

  if (assignedToId === null) {
    const c = await prisma.conversation.update({ where: { id: conversationId }, data: { ...dataLain, assignedToId: null } });
    return { ...c, assignedTo: null };
  }

  const tujuan = await perankanTujuan(prisma, assignedToId);
  if (!tujuan) throw new PerpindahanError("Tujuan transfer tidak ditemukan", 400);
  if (!tujuan.active) throw new PerpindahanError(`${tujuan.name} sudah dinonaktifkan dan tidak bisa menerima percakapan`, 400);
  if (!tujuan.roles.some((r) => PERAN_BOLEH_MEMEGANG.includes(r))) {
    throw new PerpindahanError(`${tujuan.name} bukan Sales/Admin — percakapan hanya bisa ditransfer ke Sales atau Admin`, 400);
  }
  if (sebelum.assignedToId === tujuan.id) {
    // Tidak ada perpindahan: hanya tulis field lain (jika ada), tanpa event/catatan baru.
    const c = await prisma.conversation.update({
      where: { id: conversationId }, data: dataLain,
      include: { assignedTo: { select: { id: true, name: true, avatarUrl: true } } },
    });
    return c;
  }

  const lama = sebelum.assignedToId
    ? await prisma.user.findUnique({ where: { id: sebelum.assignedToId }, select: { name: true } })
    : null;
  const handoverNote = lama?.name
    ? `Percakapan ditransfer dari ${lama.name} ke ${tujuan.name} oleh ${actor.name}.`
    : `Percakapan ditransfer ke ${tujuan.name} oleh ${actor.name}.`;

  // Keputusan kredit closing per order (lihat kreditOrderPerpindahan.js). Divalidasi SEBELUM menulis apa pun.
  const terdampak = sebelum.customerId ? await orderTerdampak(prisma, { customerId: sebelum.customerId, dariUserId: sebelum.assignedToId }) : [];
  const idTerdampak = new Set(terdampak.map((o) => o.id));
  const keputusan = Array.isArray(keputusanOrder) ? keputusanOrder : [];
  const asing = keputusan.find((k) => !k || !idTerdampak.has(String(k.orderId)));
  if (asing) throw new PerpindahanError("Keputusan kredit memuat order yang bukan atas nama pemegang sebelumnya", 400);
  const penerimaSales = tujuan.roles.includes("SALES") && tujuan.role === "SALES";
  const adaIkut = penerimaSales && keputusan.some((k) => k.ikut === true);
  const alasan = String(alasanOrder ?? "").trim().slice(0, 300);
  if (adaIkut && !alasan) throw new PerpindahanError("Alasan wajib diisi bila kredit order dipindahkan ke penerima", 400);

  return prisma.$transaction(async (tx) => {
    await tx.conversation.update({ where: { id: conversationId }, data: { ...dataLain, assignedToId: tujuan.id, handoverNote } });
    await tx.handoverEvent.create({
      data: { conversationId, fromUserId: sebelum.assignedToId, toUserId: tujuan.id, reason: "transfer" },
    });
    if (sebelum.customerId) await tx.customer.update({ where: { id: sebelum.customerId }, data: { assignedSalesId: tujuan.id } });
    const kredit = terdampak.length
      ? await terapkanKeputusanKredit(tx, { daftar: siapkanDaftar(terdampak), keputusan, dariUserId: sebelum.assignedToId, keUserId: tujuan.id, aktorId: actor.id, alasan })
      : { ikut: 0, tetap: 0 };
    const hasil = await tx.conversation.findUnique({
      where: { id: conversationId },
      include: { assignedTo: { select: { id: true, name: true, avatarUrl: true } } },
    });
    return { ...hasil, kreditOrder: kredit };
  });
}
