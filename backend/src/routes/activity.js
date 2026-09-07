// Aktivitas lintas entitas — permukaan BACA untuk activity_events
// (Production Core Slice 1). Lihat catatan panjang di
// backend/src/lib/activityLog.js dan schema.prisma model ActivityEvent
// untuk kenapa tabel ini ada DI SAMPING (bukan pengganti) unit_stage_logs
// dkk.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { ENTITY_TYPES } from "../lib/activityLog.js";
import { prisma } from "../db.js";

export const activityRouter = express.Router();
activityRouter.use(requireAuth);

// Permission per entityType — dijaga di SINI (bukan cuma di endpoint yang
// MENULIS activity_events) supaya membaca linimasa unit tidak bocor ke
// siapa pun yang login. SENGAJA whitelist eksplisit: entityType yang belum
// terdaftar ditolak 400, bukan diam-diam lolos tanpa permission — menambah
// entityType baru nanti wajib menambah barisnya di sini juga.
const PERMISSION_BY_ENTITY_TYPE = {
  [ENTITY_TYPES.UNIT]: P.UNIT_READ,
  [ENTITY_TYPES.ORDER]: P.ORDER_READ,
};

const PAGE_SIZE = 50;

// GET /api/activity?entityType=unit&entityId=<uuid>&cursor=<id>
// Linimasa SATU entitas, terbaru dulu, dipaginasi lewat cursor (id baris
// terakhir yang sudah diterima klien). Tidak ada endpoint "semua aktivitas
// lintas entitas" di Slice ini — belum ada pemanggilnya (Command Center
// baru menyusul), dan membuka tanpa filter entitas akan mengembalikan
// seluruh tabel tanpa cara membatasinya secara berarti.
activityRouter.get("/", async (req, res) => {
  try {
    const { entityType, entityId, cursor } = req.query;
    if (!entityType || !entityId) {
      return res.status(400).json({ error: "entityType dan entityId wajib diisi" });
    }

    const permission = PERMISSION_BY_ENTITY_TYPE[entityType];
    if (!permission) {
      return res.status(400).json({ error: `entityType "${entityType}" tidak dikenali` });
    }
    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ error: "Anda tidak punya akses untuk aksi ini" });
    }

    const rows = await prisma.activityEvent.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const hasMore = rows.length > PAGE_SIZE;
    const events = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

    // actorId SENGAJA bukan relasi FK (lihat schema.prisma) — resolve nama
    // aktor lewat lookup batch terpisah, bukan `include`. Dibatasi actorType
    // "USER" — actor jenis lain (mis. "SYSTEM" nanti) tidak punya baris User.
    const userIds = [...new Set(
      events.filter((e) => e.actorType === "USER" && e.actorId).map((e) => e.actorId)
    )];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
    const nameById = Object.fromEntries(users.map((u) => [u.id, u.name]));

    res.json({
      events: events.map((e) => ({ ...e, actorName: e.actorId ? nameById[e.actorId] || null : null })),
      nextCursor: hasMore ? events[events.length - 1].id : null,
    });
  } catch (err) {
    console.error("Activity read error:", err);
    res.status(500).json({ error: "Server error: " + err.message });
  }
});
