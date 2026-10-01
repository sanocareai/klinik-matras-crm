// Broadcast MANUAL admin/leader ke WA pribadi sales (mis. "meeting tanggal
// X") — lihat catatan panjang di schema.prisma model StaffBroadcast untuk
// kenapa ini terpisah total dari routes/broadcast.js (itu untuk PELANGGAN).
//
// Seluruh route di sini ADMIN-ONLY (requireAdmin) — ini kanal internal
// admin/leader ke tim, sales tidak perlu (dan tidak boleh) membuat/melihat
// daftar broadcast ini di CRM, mereka cukup MENERIMA pesannya di WA.

import express from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { readSalesPhoneDirectory, resolveSalesPhone } from "../services/salesPhoneDirectory.js";
import { cariGrupUntukKontak } from "../services/staffBroadcastWorker.js";

export const staffBroadcastRouter = express.Router();
staffBroadcastRouter.use(requireAuth, requireAdmin);

// GET / — daftar broadcast, terbaru (berdasar jadwal) dulu.
staffBroadcastRouter.get("/", async (req, res) => {
  try {
    const items = await prisma.staffBroadcast.findMany({
      orderBy: { scheduledAt: "desc" },
      include: { createdBy: { select: { name: true } } },
      take: 200,
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /recipients — daftar sales aktif yang bisa dipilih sbg penerima,
// lengkap nomor WA-nya (kalau ada di directory) supaya admin lihat DULU
// siapa yang belum terdaftar nomornya sebelum menjadwalkan (bukan baru
// ketahuan gagal setelah waktunya tiba).
staffBroadcastRouter.get("/recipients", async (req, res) => {
  try {
    const sales = await prisma.user.findMany({
      where: { role: "SALES", active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const directory = readSalesPhoneDirectory();
    const withPhone = sales.map((s) => ({ ...s, phone: resolveSalesPhone(s.name, directory) }));
    res.json(withPhone);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /contacts — kontak tim non-sales (orang & grup WA) per divisi, untuk
// Broadcast Team. Untuk GRUP, dicek apakah grupnya SUDAH terdeteksi di Inbox
// (Conversation GROUP dengan nama itu, JID asli) — kalau belum, UI memberi
// peringatan SEBELUM dijadwalkan, bukan baru gagal saat waktunya tiba.
staffBroadcastRouter.get("/contacts", async (req, res) => {
  try {
    const rows = await prisma.teamContact.findMany({
      where: { active: true },
      orderBy: [{ division: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    const out = [];
    for (const c of rows) {
      if (c.kind === "GROUP") {
        const g = await cariGrupUntukKontak(c);
        out.push({ ...c, ready: !!g, problem: g ? null : "Grup belum terdeteksi di Inbox (nama grup harus sama persis dan nomor WA bot harus anggota grup)" });
      } else {
        out.push({ ...c, ready: !!c.phone, problem: c.phone ? null : "Nomor WA belum diisi" });
      }
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — jadwalkan broadcast baru.
staffBroadcastRouter.post("/", async (req, res) => {
  try {
    const { message, recipientIds = [], contactIds = [], scheduledAt } = req.body;
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "Pesan wajib diisi" });
    }
    if (!Array.isArray(recipientIds) || !Array.isArray(contactIds) || recipientIds.length + contactIds.length === 0) {
      return res.status(400).json({ error: "Pilih minimal 1 penerima" });
    }
    const when = new Date(scheduledAt);
    if (isNaN(when.getTime())) {
      return res.status(400).json({ error: "Jadwal kirim tidak valid" });
    }

    // Validasi penerima BENAR-BENAR sales aktif — jangan simpan id yang
    // sudah tidak valid/nonaktif hanya karena body request mengirimnya.
    const validSales = await prisma.user.findMany({
      where: { id: { in: recipientIds }, role: "SALES", active: true },
      select: { id: true },
    });
    const validIds = validSales.map((s) => s.id);
    // Kontak tim (orang/grup) — hanya yang aktif.
    const validContacts = contactIds.length
      ? await prisma.teamContact.findMany({ where: { id: { in: contactIds }, active: true }, select: { id: true } })
      : [];
    const validContactIds = validContacts.map((c) => c.id);
    if (validIds.length + validContactIds.length === 0) {
      return res.status(400).json({ error: "Tidak ada penerima valid dari pilihan ini" });
    }

    const created = await prisma.staffBroadcast.create({
      data: {
        message: String(message).trim(),
        recipientIds: validIds,
        contactIds: validContactIds,
        scheduledAt: when,
        createdById: req.user?.id || null,
      },
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /:id/cancel — batalkan, cuma kalau masih SCHEDULED (belum diproses worker).
staffBroadcastRouter.post("/:id/cancel", async (req, res) => {
  try {
    const existing = await prisma.staffBroadcast.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Broadcast tidak ditemukan" });
    if (existing.status !== "SCHEDULED") {
      return res.status(409).json({ error: "Cuma broadcast yang masih terjadwal yang bisa dibatalkan" });
    }
    const updated = await prisma.staffBroadcast.update({
      where: { id: req.params.id },
      data: { status: "CANCELLED" },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
