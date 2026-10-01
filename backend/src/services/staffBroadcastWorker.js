// Worker StaffBroadcast — tiap menit, cari broadcast SCHEDULED yang
// scheduledAt-nya sudah lewat, kirim ke SEMUA penerima sekaligus (tidak ada
// pacing/kuota harian, lihat catatan di schema.prisma model StaffBroadcast
// kenapa itu tidak perlu di skala ini), lalu tandai SENT dengan hasil
// per-penerima di kolom `results`.
//
// Tahan restart (SAMA prinsip dengan broadcast_targets di routes/
// broadcast.js) — antreannya baris di tabel, bukan Map in-memory. Kalau
// backend restart tepat di antara jadwal & pengiriman, broadcast itu tetap
// terkirim di siklus cron berikutnya, tidak pernah hilang diam-diam.

import cron from "node-cron";
import { prisma } from "../db.js";
import { sendText, getDefaultOpsSession, isPlaceholderGroupJid } from "./wahaClient.js";
import { readSalesPhoneDirectory, resolveSalesPhone } from "./salesPhoneDirectory.js";

// Cari percakapan GRUP WA di Inbox untuk kontak kind=GROUP (Broadcast Team,
// 1 Okt 2026). Dicocokkan lewat NAMA grup (tanpa beda huruf besar/kecil, spasi
// ganda diabaikan); JID placeholder ("unknown-…") dilewati karena bukan alamat
// WA asli. Kalau ada beberapa yang cocok, pilih yang pesannya paling baru aktif.
export async function cariGrupUntukKontak(contact) {
  const nama = String(contact.groupName || contact.name || "").trim().replace(/\s+/g, " ");
  if (!nama) return null;
  const kandidat = await prisma.conversation.findMany({
    where: { type: "GROUP", groupName: { equals: nama, mode: "insensitive" }, groupJid: { not: null } },
    select: { id: true, groupJid: true, sessionId: true, lastMessageAt: true },
    orderBy: { lastMessageAt: "desc" },
  });
  return kandidat.find((k) => k.groupJid && !isPlaceholderGroupJid(k.groupJid)) || null;
}

let cycleRunning = false; // cegah tumpang tindih siklus kalau kirim lambat

async function processDue() {
  const due = await prisma.staffBroadcast.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
  });
  if (due.length === 0) return;

  const directory = readSalesPhoneDirectory();

  for (const broadcast of due) {
    const users = await prisma.user.findMany({
      where: { id: { in: broadcast.recipientIds } },
      select: { id: true, name: true },
    });

    const results = {};
    // Kontak tim (Broadcast Team): orang → WA PRIBADI satu per satu; grup → ke grupnya.
    const contacts = broadcast.contactIds?.length
      ? await prisma.teamContact.findMany({ where: { id: { in: broadcast.contactIds } } })
      : [];
    for (const c of contacts) {
      const key = "c:" + c.id;
      const label = c.roleLabel ? `${c.name} (${c.division} · ${c.roleLabel})` : c.name;
      try {
        if (c.kind === "GROUP") {
          const g = await cariGrupUntukKontak(c);
          if (!g) {
            results[key] = { nama: label, phone: null, status: "GAGAL", error: "Grup belum terdeteksi di Inbox (nama harus sama persis & nomor WA bot anggota grup)" };
            continue;
          }
          await sendText(g.groupJid, broadcast.message, null, g.sessionId || getDefaultOpsSession());
          results[key] = { nama: label, phone: g.groupJid, status: "TERKIRIM" };
        } else {
          if (!c.phone) {
            results[key] = { nama: label, phone: null, status: "GAGAL", error: "Nomor WA belum diisi" };
            continue;
          }
          await sendText(c.phone, broadcast.message, null, getDefaultOpsSession());
          results[key] = { nama: label, phone: c.phone, status: "TERKIRIM" };
        }
      } catch (err) {
        results[key] = { nama: label, phone: c.phone || null, status: "GAGAL", error: err.message };
      }
    }
    for (const u of users) {
      const phone = resolveSalesPhone(u.name, directory);
      if (!phone) {
        results[u.id] = { nama: u.name, phone: null, status: "GAGAL", error: "Nomor WA belum terdaftar di directory" };
        continue;
      }
      try {
        await sendText(phone, broadcast.message, null, getDefaultOpsSession());
        results[u.id] = { nama: u.name, phone, status: "TERKIRIM" };
      } catch (err) {
        results[u.id] = { nama: u.name, phone, status: "GAGAL", error: err.message };
      }
    }

    await prisma.staffBroadcast.update({
      where: { id: broadcast.id },
      data: { status: "SENT", sentAt: new Date(), results },
    });
    console.log(`[staff-broadcast] Terkirim ke ${Object.values(results).filter((r) => r.status === "TERKIRIM").length}/${users.length + contacts.length} penerima (id: ${broadcast.id})`);
  }
}

async function runCycle() {
  if (cycleRunning) return;
  cycleRunning = true;
  try {
    await processDue();
  } catch (err) {
    console.error("[staff-broadcast] Error siklus worker:", err.message);
  } finally {
    cycleRunning = false;
  }
}

export function startStaffBroadcastWorker() {
  cron.schedule("* * * * *", runCycle, { timezone: "Asia/Jakarta" });
  console.log("[staff-broadcast] Worker terdaftar — cek broadcast terjadwal tiap menit");
}

export { runCycle as runStaffBroadcastCycle };
