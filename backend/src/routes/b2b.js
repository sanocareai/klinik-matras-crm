// ─── WORKSPACE B2B / NON-CRM (D-115, 11 September 2026) ────────────────────
//
// Permintaan owner: order vendor/korporat yang kontak LANGSUNG ke WA
// pribadi Gilang — sama sekali di luar Inbox omnichannel (nomor CS-1/CS-2).
// Dibatasi Role.OWNER (Gilang/Juri/Kemal secara eksplisit lewat Pengguna &
// Peran, BUKAN semua ADMIN — Novi ber-role ADMIN juga tapi sengaja tidak
// ikut, lihat komentar di constants/permissions.js).
//
// PENTING soal integrasi lintas divisi: endpoint di sini HANYA mengatur
// SIAPA yang boleh mencatat deal B2B baru (data kontak vendor/PIC). Begitu
// Order terbentuk, ia adalah Order NORMAL — dibuat lewat
// services/orderCreation.js yang SAMA PERSIS dipakai Sales CRM (Inbox/
// Drawer), jadi Unit/job pickup otomatis/draft invoice-nya identik, dan
// langsung terlihat + bisa dikerjakan oleh Produksi/Warehouse/Delivery
// lewat ORDER_READ/UNIT_READ yang sudah mereka pegang — TIDAK ada jalur
// visibilitas terpisah yang perlu dibangun di sana.
import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { createOrderForCustomer } from "../services/orderCreation.js";
import { syncCustomerOrderAggregate } from "../services/customerOrderAggregate.js";

export const b2bRouter = express.Router();
b2bRouter.use(requireAuth);

// GET /api/b2b/orders — daftar order yang lahir dari workspace ini.
// Filternya `customer.leadSource === "B2B_DIRECT"` — BUKAN
// `customerType === "CORPORATE"` (field itu sudah dipakai lebih dulu oleh
// Sales CRM biasa untuk customer korporat yang datang lewat Inbox normal;
// menyamakan filter akan ikut menyedot order yang bukan urusan workspace
// ini).
b2bRouter.get("/orders", requirePermission(P.B2B_READ), async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { customer: { leadSource: "B2B_DIRECT" } },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        customer: { select: { id: true, name: true, phone: true, city: true, tags: true, assignedSalesId: true } },
        promo: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    res.json({ items: orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/b2b/orders — bikin Customer(CORPORATE) + Order dalam 1 langkah.
// Nomor kontak yang dikirim di sini murni field referensi (dipakai KALAU
// perlu telepon/WA manual lagi) — BUKAN channel yang sistem pantau
// balasannya, karena memang bukan nomor CS yang terhubung WAHA.
b2bRouter.post("/orders", requirePermission(P.B2B_WRITE), async (req, res) => {
  const { customerName, customerPhone, companyName, city, notesKontak, ...orderBody } = req.body;
  if (!customerName?.trim()) return res.status(400).json({ error: "Nama vendor/PIC wajib diisi" });

  try {
    const customer = await prisma.customer.create({
      data: {
        name: customerName.trim(),
        phone: customerPhone?.trim() || null,
        city: city || null,
        customerType: "CORPORATE",
        leadSource: "B2B_DIRECT",
        leadSourceConfirmed: true,
        assignedSalesId: req.user.id,
        tags: companyName?.trim() ? [companyName.trim()] : [],
      },
    });

    if (notesKontak?.trim()) {
      await prisma.note.create({
        data: { customerId: customer.id, authorId: req.user.id, content: notesKontak.trim() },
      });
    }

    const order = await createOrderForCustomer(customer.id, orderBody, req.user.id);
    await syncCustomerOrderAggregate(customer.id);

    res.status(201).json({ customer, order });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});
