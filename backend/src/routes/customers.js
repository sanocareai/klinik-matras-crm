import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { rolesOf } from "../middleware/authorize.js";
import { generateOrderNumber } from "../services/orderNumberGenerator.js";
import { loadCustomerContext, buildCustomerIntelligence } from "../services/intelligence/index.js";
import { dispatchLeadWon } from "../services/automationWebhook.js";
import { syncCustomerOrderAggregate } from "../services/customerOrderAggregate.js";
import { createUnitsForOrder } from "../services/unitProvisioning.js";
import { syncOrderStatus } from "../services/orderStatusSync.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../utils/wib.js";
import { buatFileVCard } from "../services/vcard.js";

export const customerRouter = express.Router();
customerRouter.use(requireAuth);

// Sama persis dengan logika filter di GET / (diekstrak supaya
// POST /bulk-reassign bisa memakai kriteria yang SAMA tanpa duplikasi yang
// bisa drift — "pilih semua yang cocok filter ini" harus benar-benar
// berarti filter yang sama dengan yang sedang dilihat user).
function buildCustomerWhere(query) {
  const { search, stage, source, sales, salesId, city, customerType, quickChip, confirmed, from, to } = query;
  const where = {};
  // Filter tanggal PENDAFTARAN pelanggan — dipakai saat masuk dari
  // Laporan > Traffic (klik sumber lead). Tanpa ini, laporan "30 hari
  // terakhir" membuka daftar SELURUH waktu dan jumlahnya tidak pernah
  // cocok dengan angka yang barusan diklik.
  // Batas atas EKSKLUSIF (lihat aturan tanggal di CLAUDE.md §11).
  if (from && to) {
    where.createdAt = { gte: startOfDayWIB(from), lt: endOfDayExclusiveWIB(to) };
  }
  if (stage)  where.pipelineStage = stage;
  if (source) where.leadSource    = source;
  // ?confirmed=false — dipakai antrean "Konfirmasi Sumber": WHATSAPP_DIRECT
  // yang belum pernah dikoreksi manual sales (leadSourceConfirmed masih
  // default false). ?confirmed=true kebalikannya, jarang dipakai tapi
  // disediakan untuk simetri.
  if (confirmed === "false") where.leadSourceConfirmed = false;
  if (confirmed === "true") where.leadSourceConfirmed = true;
  if (sales)  where.assignedSalesId = sales;
  if (salesId) where.conversations = { some: { assignedToId: salesId } };
  if (city) where.city = city;
  if (customerType) where.customerType = customerType;
  if (search) {
    where.OR = [
      { name:            { contains: search, mode: "insensitive" } },
      { phone:           { contains: search } },
      { instagramHandle: { contains: search, mode: "insensitive" } },
      { email:           { contains: search, mode: "insensitive" } },
    ];
  }
  if (quickChip === "vip") where.orderValue = { gte: 5_000_000 };
  if (quickChip === "no-order") where.orderCount = 0;
  if (quickChip === "inactive") {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    where.NOT = { conversations: { some: { type: "INDIVIDUAL", lastMessageAt: { gt: cutoff } } } };
  }
  return where;
}

// POST /api/customers/bulk-reassign — pindahkan SEMUA pelanggan yang cocok
// filter (bukan cuma yang termuat di 1 halaman) ke sales lain sekaligus.
// Dipakai skenario "sales resign, 190 pelanggannya perlu dipindah" — bulk
// assign yang sudah ada di frontend (loop api.updateCustomer per id) cuma
// masuk akal untuk baris yang KELIHATAN di halaman aktif (puluhan), bukan
// ratusan lintas halaman. `updateMany` di sini satu query DB, bukan ratusan
// request bolak-balik dari browser.
customerRouter.post("/bulk-reassign", async (req, res) => {
  const { toSalesId, filters } = req.body;
  if (!toSalesId) return res.status(400).json({ error: "toSalesId wajib diisi" });
  try {
    const target = await prisma.user.findUnique({ where: { id: toSalesId }, select: { id: true, active: true } });
    if (!target) return res.status(404).json({ error: "Sales tujuan tidak ditemukan" });
    if (target.active === false) {
      return res.status(400).json({ error: "Sales tujuan sudah nonaktif — pilih sales yang masih aktif" });
    }

    const where = buildCustomerWhere(filters || {});
    const result = await prisma.customer.updateMany({ where, data: { assignedSalesId: toSalesId } });
    res.json({ count: result.count });
  } catch (err) {
    console.error("bulk-reassign error:", err);
    res.status(500).json({ error: "Gagal memindahkan pelanggan" });
  }
});

// Buat pelanggan baru secara manual (wajib isi minimal phone atau instagramHandle)
customerRouter.post("/", async (req, res) => {
  const { name, phone, instagramHandle, city, email, leadSource } = req.body;

  const cleanPhone = phone?.trim() || null;
  const cleanHandle = instagramHandle?.trim() || null;

  if (!cleanPhone && !cleanHandle) {
    return res.status(400).json({ error: "Wajib isi nomor WhatsApp atau username Instagram" });
  }

  // Cek duplikat
  if (cleanPhone) {
    const exists = await prisma.customer.findUnique({ where: { phone: cleanPhone } });
    if (exists) return res.status(409).json({ error: "Nomor WhatsApp sudah terdaftar" });
  }
  if (cleanHandle) {
    const exists = await prisma.customer.findUnique({ where: { instagramHandle: cleanHandle } });
    if (exists) return res.status(409).json({ error: "Username Instagram sudah terdaftar" });
  }

  const cleanName = name?.trim() || null;
  const customer = await prisma.customer.create({
    data: {
      name: cleanName,
      phone: cleanPhone,
      instagramHandle: cleanHandle,
      city: city?.trim() || null,
      email: email?.trim() || null,
      leadSource: leadSource || "OTHER",
      // Sama seperti PATCH /:id — kalau sales isi nama sekarang (bukan
      // dikosongkan), webhook (resolveCustomerName) tidak boleh timpa lagi.
      ...(cleanName && { nameManuallyEdited: true }),
    },
  });
  res.status(201).json(customer);
});

// Kota untuk dropdown filter — dulu diturunkan client-side dari SELURUH
// daftar pelanggan yang di-fetch (lihat catatan paginasi di bawah); begitu
// list utama dipaginasi, tidak ada lagi "seluruh daftar" di browser untuk
// menurunkannya dari situ, jadi dipisah jadi endpoint kecil sendiri.
// GET /api/customers/export/vcard — unduh pelanggan sebagai file .vcf
// untuk diimpor ke buku alamat HP.
//
// KENAPA INI ADA (bukan sinkron otomatis ke WhatsApp). WAHA terhubung
// sebagai perangkat tertaut — dia TIDAK PUNYA buku alamat sendiri untuk
// ditulisi, dan nama kontak WhatsApp memang tersimpan di HP masing-masing
// orang, bukan di server. Diverifikasi langsung ke WAHA production
// 16 Agt 2026: semua endpoint tulis kontak (PUT/POST/PATCH /api/contacts,
// /contacts/name, /rename, /update, /set-name, /addressbook) menjawab 404.
// Ini bukan keterbatasan tier yang bisa diakali upgrade.
//
// Jadi ini SATU ARAH & MANUAL: file diunduh dari CRM, diimpor sekali oleh
// sales ke HP mereka. Nama baru/berubah di CRM TIDAK otomatis menyusul —
// harus diimpor ulang. Filter query SAMA PERSIS dengan yang dipakai
// tabel Pelanggan (buildCustomerWhere), supaya "ekspor yang sedang saya
// lihat" benar-benar berarti itu.
customerRouter.get("/export/vcard", async (req, res) => {
  try {
    const where = buildCustomerWhere(req.query);
    const pelanggan = await prisma.customer.findMany({
      where,
      select: { name: true, phone: true },
      orderBy: { name: "asc" },
    });

    const { isi, jumlah, dilewati } = buatFileVCard(pelanggan);
    if (jumlah === 0) {
      return res.status(400).json({
        error: dilewati > 0
          ? `${dilewati} pelanggan cocok filter, tapi semuanya tanpa nama atau tanpa nomor — tidak ada yang bisa diekspor`
          : "Tidak ada pelanggan yang cocok filter ini",
      });
    }

    console.log(`[export/vcard] ${req.user.id} mengekspor ${jumlah} kontak (${dilewati} dilewati: tanpa nama/nomor)`);

    res.setHeader("Content-Type", "text/vcard; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="pelanggan-klinik-matras-${jumlah}.vcf"`);
    res.send(isi);
  } catch (err) {
    console.error("[export/vcard] gagal:", err.message);
    res.status(500).json({ error: "Gagal membuat file kontak" });
  }
});

customerRouter.get("/meta/cities", async (req, res) => {
  try {
    const rows = await prisma.customer.findMany({
      where: { city: { not: null } },
      distinct: ["city"],
      select: { city: true },
      orderBy: { city: "asc" },
    });
    res.json(rows.map((r) => r.city).filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Kolom yang boleh dipakai sort — whitelist eksplisit (bukan terima nama
// kolom apa pun dari query string langsung) supaya tidak ada jalan untuk
// sort ke kolom yang tidak dimaksudkan/tidak ada.
const SORT_FIELDS = {
  name: "name", createdAt: "createdAt", updatedAt: "updatedAt",
  orderCount: "orderCount", orderValue: "orderValue", city: "city",
  leadSource: "leadSource",
};
// `assignedSales` SENGAJA di luar SORT_FIELDS — itu kolom SCALAR, ini sort
// LEWAT RELASI (assignedSales.name), bentuk orderBy Prisma-nya beda (nested
// object, bukan string field), jadi ditangani terpisah di bawah, bukan
// dipaksa masuk map yang sama.

// Revisi 27 Jul 2026 — PAGINASI & FILTER PINDAH KE SERVER (dulu SEMUA
// pelanggan di-fetch sekaligus dengan include orders/items/weightEntries
// PENUH, lalu search/filter/sort/pagination dihitung di browser dari array
// itu). Di 1.320+ pelanggan (94% tanpa order sama sekali, tapi tetap ikut
// ter-include relasinya) ini cuma "belum kelihatan lambat", bukan "aman" —
// growth lead adalah angka yang paling cepat naik di bisnis ini. Sekarang:
// - `where` dibangun dari query params (termasuk quickChip VIP/Belum Order/
//   Tidak Aktif yang dulu cuma client-side), difilter di DATABASE.
// - orderCount/orderValue dibaca LANGSUNG dari kolom Customer (denormalized,
//   lihat services/customerOrderAggregate.js) — bukan include seluruh
//   relasi orders lagi, jadi VIP/sort nilai order jadi query Postgres biasa.
// - "Latest order" (status/keluhan/merk/dll) & riwayat komplain HANYA
//   diambil untuk pelanggan di HALAMAN INI (1 query ber-`IN`, bukan N+1,
//   dan bukan seluruh 1.320 pelanggan).
// ⚠️ KOMPATIBILITAS MUNDUR — JANGAN DIHAPUS TANPA MEMPERBARUI SEMUA PEMANGGIL:
// endpoint ini dipakai 3 tempat dengan ekspektasi BENTUK RESPONS BERBEDA:
//   - frontend/src/pages/Customers.jsx (SUDAH diperbarui bareng revisi ini,
//     kirim ?page= eksplisit) → ekspektasi { items, total, page, pageSize, counts }
//   - frontend/src/pages/Pengaturan.jsx#handleExportCustomers (export Excel,
//     BELUM diperbarui — sengaja, butuh SEMUA baris tanpa terpotong halaman)
//     dan mobile/src/screens/PelangganScreen.js (BELUM diperbarui, scope
//     revisi ini cuma tabel Pelanggan web) → keduanya TIDAK PERNAH kirim
//     ?page=, ekspektasi array polos SEMUA pelanggan seperti sebelumnya.
// Pembeda: KEHADIRAN query param `page`. Ada → jalur paginasi baru (array
// dipotong + metadata). Tidak ada → jalur lama (semua baris, array polos) —
// masih query yang sama (denormalized orderCount/orderValue, bukan include
// orders penuh lagi), cuma tanpa skip/take dan bentuk respons array polos.
customerRouter.get("/", async (req, res) => {
  try {
    const { sortKey, sortDir } = req.query;
    const isPaginated = req.query.page !== undefined;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

    // ?salesId= — BEDA dari ?sales=: ?sales= filter Customer.assignedSalesId
    // (kepemilikan LEAD/pipeline). ?salesId= filter lewat conversation yang
    // DITANGANI sales itu (Conversation.assignedToId — definisi take-over),
    // dipakai filter "Sales:" di tab Pelanggan mobile (lihat
    // mobile/src/screens/PelangganScreen.js). Keduanya ditangani di
    // buildCustomerWhere() di atas (dipakai bersama POST /bulk-reassign).
    const where = buildCustomerWhere(req.query);

    const orderByDir = sortDir === "asc" ? "asc" : "desc";
    const orderBy = sortKey === "assignedSales"
      ? { assignedSales: { name: orderByDir } }
      : { [SORT_FIELDS[sortKey] || "updatedAt"]: orderByDir };

    // Sama seperti `where` di atas TAPI TANPA pipelineStage — dipakai untuk
    // hitung "berapa customer di tiap stage KALAU tab ini dipilih" (tab
    // pipeline chip mobile, lihat mobile/PelangganScreen.js), supaya count
    // tetap masuk akal walau search/salesId lagi aktif, TIDAK ikut berubah
    // cuma karena user pindah-pindah tab stage itu sendiri.
    const { pipelineStage: _omitStage, ...whereForStageCounts } = where;

    const [totalCount, customersPage, typeGroups, stageGroups] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        include: {
          assignedSales: true,
          conversations: {
            where: { type: "INDIVIDUAL" },
            orderBy: { lastMessageAt: "desc" }, take: 1,
            select: { id: true, lastMessageAt: true },
          },
        },
        orderBy,
        // Jalur lama (mobile, export Pengaturan) TIDAK kirim ?page= — tanpa
        // skip/take di situ supaya perilakunya tetap "semua baris" seperti
        // sebelumnya, cuma sekarang query-nya lebih ringan (tidak include
        // orders penuh lagi).
        ...(isPaginated && { skip: (page - 1) * pageSize, take: pageSize }),
      }),
      // Total per tab (Semua/End User/Korporat) — SENGAJA lepas dari filter
      // lain (search/stage/quickChip/dst), sama seperti perilaku lama:
      // tab count itu angka global, bukan "yang cocok filter saat ini".
      prisma.customer.groupBy({ by: ["customerType"], _count: { _all: true } }),
      prisma.customer.groupBy({ by: ["pipelineStage"], where: whereForStageCounts, _count: { _all: true } }),
    ]);

    // "Order terbaru" (status/keluhan/merk/ukuran/layanan) + riwayat komplain
    // — HANYA untuk pelanggan di halaman ini, 1 query ber-`IN`.
    const ids = customersPage.map((c) => c.id);
    const orders = ids.length
      ? await prisma.order.findMany({
          where: { customerId: { in: ids } },
          include: {
            items:         { orderBy: { sortOrder: "asc" } },
            weightEntries: { orderBy: { sortOrder: "asc" } },
          },
          orderBy: { updatedAt: "desc" },
        })
      : [];
    const ordersByCustomer = {};
    for (const o of orders) (ordersByCustomer[o.customerId] ||= []).push(o);

    const items = customersPage.map(({ conversations, ...c }) => {
      const custOrders = ordersByCustomer[c.id] || [];
      const latest = custOrders[0] || null; // sudah terurut updatedAt desc dari query

      let latestKeluhan = null, latestMerkKasur = null, latestUkuranKasur = null;
      if (latest?.notes) {
        try {
          const n = JSON.parse(latest.notes);
          latestKeluhan    = n.keluhanCustomer || null;
          latestMerkKasur  = n.merkKasur       || null;
          latestUkuranKasur = n.ukuranKasur    || null;
        } catch {}
      }

      const latestLayanan = (latest?.items || [])
        .map((i) => i.layananName)
        .filter(Boolean)
        .join(", ") || null;

      const riwayatKomplain = custOrders
        .filter((o) => o.hasComplaint)
        .sort((a, b) => new Date(b.complaintDate) - new Date(a.complaintDate))
        .map((o) => ({
          orderId:        o.id,
          orderNumber:    o.orderNumber,
          complaintDate:  o.complaintDate,
          complaintDetail: o.complaintDetail,
        }));

      return {
        ...c,
        // orderCount/orderValue SUDAH ada di `c` (kolom denormalized asli),
        // tidak dihitung ulang di sini lagi.
        lastMessageAt: conversations[0]?.lastMessageAt || null,
        // conversationId — dipakai frontend supaya klik baris/kartu Pelanggan
        // bisa langsung deep-link ke chat customer ini (/inbox?conv=<id>),
        // sama pola yang sudah dipakai halaman Order (bukaChat) & Pipeline
        // KanbanCard — bukan cuma lempar ke /inbox generik lalu sales harus
        // cari sendiri percakapannya secara manual (susah di layar HP/tablet).
        conversationId: conversations[0]?.id || null,
        latestOrderStatus:   latest?.status        || null,
        latestOrderNumber:   latest?.orderNumber   || null,
        latestPaymentStatus: latest?.paymentStatus || null,
        latestBeratBadan:    latest?.beratBadan    || null,
        latestWeightEntries: latest?.weightEntries || [],
        latestKeluhan,
        latestMerkKasur,
        latestUkuranKasur,
        latestLayanan,
        pernahKomplain: riwayatKomplain.length > 0,
        riwayatKomplain,
      };
    });

    // Jalur lama: array polos, tanpa metadata paginasi — persis bentuk
    // respons sebelum revisi ini (mobile & export Pengaturan masih
    // mengandalkan ini apa adanya).
    if (!isPaginated) return res.json(items);

    const counts = {
      all: typeGroups.reduce((s, g) => s + g._count._all, 0),
      endUser: typeGroups.find((g) => g.customerType === "END_USER")?._count._all || 0,
      korporat: typeGroups.find((g) => g.customerType === "CORPORATE")?._count._all || 0,
    };
    // Per stage — dipakai chip pipeline mobile (mobile/PelangganScreen.js).
    // "ALL" = jumlah SEMUA stage dijumlahkan (setara totalCount TANPA filter
    // stage), supaya tab "Semua" tetap benar walau salah satu tab stage
    // dipilih.
    const stageCounts = { ALL: stageGroups.reduce((s, g) => s + g._count._all, 0) };
    for (const g of stageGroups) stageCounts[g.pipelineStage] = g._count._all;

    res.json({ items, total: totalCount, page, pageSize, counts, stageCounts });
  } catch (err) {
    console.error("customers list error:", err);
    res.status(500).json({ error: "Gagal memuat daftar pelanggan" });
  }
});

customerRouter.get("/:id", async (req, res) => {
  const customer = await prisma.customer.findUnique({
    where: { id: req.params.id },
    include: {
      notes: { include: { author: true }, orderBy: { createdAt: "desc" } },
      orders: {
        orderBy: { updatedAt: "desc" },
        include: {
          items:         { orderBy: { sortOrder: "asc" } },
          weightEntries: { orderBy: { sortOrder: "asc" } },
          promo:         { select: { id: true, code: true, name: true } }, // D-026
        },
      },
      assignedSales: true,
      // D-030 (20 Agustus 2026) — dibutuhkan supaya OrderTimelineDrawer bisa
      // dipakai dari tab Order di drawer Pelanggan juga (sebelumnya cuma
      // dari halaman /orders, yang sumber datanya endpoint list TERPISAH
      // dan sudah menyertakan ini). Cuma id/type — sama minimal seperti
      // include di GET /customers list.
      conversations: {
        where: { type: "INDIVIDUAL" },
        orderBy: { lastMessageAt: "desc" }, take: 1,
        select: { id: true },
      },
    },
  });
  if (!customer) return res.status(404).json({ error: "Pelanggan tidak ditemukan" });

  // Kumpulkan semua keluhan dari semua order (non-kosong, urut terbaru)
  const allKeluhan = customer.orders
    .map((o) => {
      let keluhan = null;
      if (o.notes) { try { keluhan = JSON.parse(o.notes).keluhanCustomer || null; } catch {} }
      return keluhan ? { keluhan, tanggal: o.updatedAt || o.createdAt } : null;
    })
    .filter(Boolean);

  // Riwayat komplain
  const riwayatKomplain = customer.orders
    .filter((o) => o.hasComplaint)
    .sort((a, b) => new Date(b.complaintDate) - new Date(a.complaintDate))
    .map((o) => ({
      orderId:        o.id,
      orderNumber:    o.orderNumber,
      complaintDate:  o.complaintDate,
      complaintDetail: o.complaintDetail,
    }));

  res.json({ ...customer, allKeluhan, pernahKomplain: riwayatKomplain.length > 0, riwayatKomplain });
});

// Update data CRM: nama, phone, tags, pipeline stage, sales yang ditugaskan, dll
customerRouter.patch("/:id", async (req, res) => {
  const {
    name, phone, tags, pipelineStage, assignedSalesId, email, city,
    leadSource, leadSourceDetail, leadSourceConfirmed,
    customerType, healthStatus, complaintCategory,
  } = req.body;

  // Cek duplikat nomor kalau diubah
  if (phone !== undefined && phone !== null) {
    const cleanPhone = phone.replace(/\D/g, "").replace(/^0/, "62") || null;
    if (cleanPhone) {
      const dup = await prisma.customer.findFirst({ where: { phone: cleanPhone, NOT: { id: req.params.id } } });
      if (dup) return res.status(409).json({ error: "Nomor WhatsApp sudah dipakai pelanggan lain" });
    }
  }

  const data = {
    // nameManuallyEdited=true — webhook (resolveCustomerName di webhooks.js)
    // TIDAK BOLEH timpa lagi nama yang sales sudah koreksi manual di CRM.
    ...(name !== undefined && { name, nameManuallyEdited: true }),
    ...(phone !== undefined && { phone: phone ? phone.replace(/\D/g, "").replace(/^0/, "62") || null : null }),
    ...(tags !== undefined && { tags }),
    ...(pipelineStage !== undefined && { pipelineStage }),
    ...(assignedSalesId !== undefined && { assignedSalesId }),
    ...(email !== undefined && { email }),
    ...(city !== undefined && { city }),
    ...(leadSourceDetail !== undefined && { leadSourceDetail: leadSourceDetail || null }),
    ...(leadSourceConfirmed !== undefined && { leadSourceConfirmed }),
    ...(customerType !== undefined && { customerType }),
    // D-028: kategori keluhan cuma relevan kalau healthStatus = SAKIT —
    // dipaksa [] di sini juga kalau toggle balik ke Tidak Sakit/kosong,
    // sama seperti Order.complaintCategory di routes/orders.js. Array
    // (multi-pilih) sejak revisi 20 Agustus 2026.
    ...(healthStatus !== undefined && {
      healthStatus: healthStatus || null,
      complaintCategory: healthStatus === "SAKIT" ? (complaintCategory || []) : [],
    }),
    ...(healthStatus === undefined && complaintCategory !== undefined && { complaintCategory: complaintCategory || [] }),
  };

  // Kalau leadSource diubah manual → otomatis set confirmed = true
  if (leadSource !== undefined) {
    data.leadSource = leadSource;
    data.leadSourceConfirmed = true;
  }

  try {
    // Stage LAMA dibaca di dalam transaksi yang sama dengan update-nya, supaya
    // baris pipeline_transitions tidak pernah tercatat tanpa perubahan
    // Customer-nya ikut berhasil (dan sebaliknya).
    //
    // CATATAN RACE: isolation level default (read committed) berarti 2 PATCH
    // bersamaan pada customer yang SAMA secara teori bisa mencatat 2 transisi
    // dari stage-lama yang sama. Dengan 7 user dan stage dipindah manual lewat
    // drag & drop, ini tidak realistis — dan dampaknya cuma 1 baris riwayat
    // berlebih, bukan data Customer yang rusak. Kalau nanti stage bisa diubah
    // otomatis (workflow/AI), naikkan ke SELECT ... FOR UPDATE.
    const { customer, transisi } = await prisma.$transaction(async (tx) => {
      const sebelum = await tx.customer.findUnique({
        where: { id: req.params.id },
        select: { pipelineStage: true },
      });
      if (!sebelum) {
        throw Object.assign(new Error("Pelanggan tidak ditemukan"), { statusCode: 404 });
      }

      const customer = await tx.customer.update({ where: { id: req.params.id }, data });

      // Dicatat HANYA kalau stage BENAR-BENAR berpindah. Form CRM sering
      // mengirim seluruh field termasuk pipelineStage yang tidak berubah —
      // tanpa cek ini riwayat akan penuh baris "NEW → NEW" dan analisa
      // kecepatan pipeline jadi tidak berguna.
      let transisi = null;
      if (pipelineStage !== undefined && pipelineStage !== sebelum.pipelineStage) {
        transisi = await tx.pipelineTransition.create({
          data: {
            customerId:  customer.id,
            fromStage:   sebelum.pipelineStage,
            toStage:     pipelineStage,
            changedById: req.user?.id || null,
          },
        });
      }

      return { customer, transisi };
    });

    res.json(customer);

    // ── SETELAH respons: webhook keluar ke n8n (fire-and-forget) ─────────────
    // Sengaja TIDAK di-await dan TIDAK di dalam transaksi — sales tidak boleh
    // menunggu n8n, dan n8n yang mati tidak boleh membatalkan perubahan stage.
    // dispatchLeadWon() sudah menangkap semua error di dalam; .catch() di sini
    // hanya jaring terakhir supaya tidak ada unhandled rejection.
    //
    // Revisi 30 Jul 2026: trigger pindah dari PAID (dihapus dari pipeline,
    // lihat schema.prisma enum PipelineStage) ke COMPLETED — sekarang stage
    // terakhir "operasional" sebelum Reviewed, paling dekat maknanya dengan
    // "deal selesai" yang dulu diwakili Paid.
    if (transisi?.toStage === "COMPLETED") {
      dispatchLeadWon(prisma, {
        customerId:  customer.id,
        fromStage:   transisi.fromStage,
        changedById: transisi.changedById,
      }).catch((err) => console.error("[automation-webhook] lead.won tak tertangkap:", err));
    }
  } catch (err) {
    // Blok try ini sekarang MELEWATI res.json() (webhook dijalankan setelah
    // respons terkirim) — tanpa cek ini, error apa pun sesudahnya akan memicu
    // "Cannot set headers after they are sent" yang menutupi error aslinya.
    if (res.headersSent) {
      console.error("PATCH /customers/:id error setelah respons terkirim:", err);
      return;
    }
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

customerRouter.post("/:id/notes", async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Catatan kosong" });

  const note = await prisma.note.create({
    data: { customerId: req.params.id, authorId: req.user.id, content },
    include: { author: true },
  });
  res.status(201).json(note);
});

// Riwayat semua percakapan pelanggan beserta pesannya (untuk tab Riwayat Chat di drawer)
customerRouter.get("/:id/conversations", async (req, res) => {
  const conversations = await prisma.conversation.findMany({
    where: { customerId: req.params.id },
    orderBy: { lastMessageAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  res.json(conversations);
});

// Wave 4A — intelligence per-customer (ADDITIVE, read-only). Health + Priority +
// Opportunity + Next Best Action + Insight dari engine kanonik. Role scope:
// SALES hanya boleh yang miliknya / belum diambil, selain itu 403.
customerRouter.get("/:id/intelligence", async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const ctx = await loadCustomerContext(prisma, req.params.id);
    if (!ctx) return res.status(404).json({ error: "Pelanggan tidak ditemukan" });
    if (role !== "ADMIN" && ctx.customer.assignedSalesId && ctx.customer.assignedSalesId !== userId)
      return res.status(403).json({ error: "Tidak boleh mengakses pelanggan ini" });
    res.json(buildCustomerIntelligence(ctx));
  } catch (err) {
    console.error("customer intelligence error:", err);
    res.status(500).json({ error: "Gagal memuat intelligence" });
  }
});

// Catat order baru — value mulai 0, akan dihitung otomatis dari items
// orderNumber di-generate otomatis berdasarkan category (jangan kirim dari frontend)
//
// SEJAK 1 Agustus 2026 endpoint ini JUGA membuat Unit (kasur fisik) untuk order
// tersebut. Sebelumnya tidak ada jalur runtime mana pun yang membuat Unit, jadi
// setiap order baru berhenti sebagai catatan komersial dan tidak pernah bisa
// masuk ke bengkel/armada — lihat catatan panjang di services/unitProvisioning.js.
//
// `unitCount` OPSIONAL, default 1. SENGAJA BUKAN `quantity`: `quantity` adalah
// jumlah barang yang dipesan (bisa 2 bantal / 2 guling), bukan jumlah kasur.
// Klien lama yang tidak mengirim `unitCount` tetap benar untuk mayoritas order.
customerRouter.post("/:id/orders", async (req, res) => {
  const {
    quantity, status, notes, beratBadan, category, unitCount, promoId, deliveryCity, deliveryAddress,
    healthStatus, complaintCategory, ongkir, ongkirKlaimGaransi, pickupEstimate, pickupConfirmedDate,
    deliveryEstimate, deliveryConfirmedDate, locationUrl,
  } = req.body;

  const cat = category || "LAYANAN";

  // generateOrderNumber punya transaksinya sendiri (counter OrderSequence) —
  // dipanggil DI LUAR transaksi di bawah, jangan disarangkan.
  const orderNumber = await generateOrderNumber(cat);

  // Order + unit-unitnya lahir dalam SATU transaksi. Order tanpa unit persis
  // keadaan yang sedang diperbaiki di sini; jangan biarkan kegagalan separuh
  // jalan membuatnya lagi.
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        customerId: req.params.id,
        value: 0,
        quantity: quantity ? Number(quantity) : 1,
        status: status || "PENDING",
        category: cat,
        orderNumber,
        notes,
        ...(beratBadan !== undefined && { beratBadan: beratBadan ? Number(beratBadan) : null }),
        ...(promoId && { promoId }),
        ...(deliveryCity && { deliveryCity }),
        ...(deliveryAddress && { deliveryAddress }),
        ...(healthStatus && {
          healthStatus,
          complaintCategory: healthStatus === "SAKIT" ? (complaintCategory || []) : [],
        }),
        ...(ongkir !== undefined && { ongkir: ongkir === "" || ongkir === null ? null : Number(ongkir) }),
        ...(ongkirKlaimGaransi !== undefined && { ongkirKlaimGaransi: ongkirKlaimGaransi === "" || ongkirKlaimGaransi === null ? null : Number(ongkirKlaimGaransi) }),
        ...(pickupEstimate && { pickupEstimate }),
        ...(pickupConfirmedDate && { pickupConfirmedDate }),
        ...(deliveryEstimate && { deliveryEstimate }),
        ...(deliveryConfirmedDate && { deliveryConfirmedDate }),
        ...(locationUrl && { locationUrl }),
      },
      include: { items: true },
    });

    const jumlahUnit = unitCount === undefined ? 1 : Math.max(0, Math.floor(Number(unitCount) || 0));
    if (jumlahUnit > 0) {
      await createUnitsForOrder(tx, { order: created, count: jumlahUnit });
      await syncOrderStatus(tx, created.id);
    }

    return tx.order.findUnique({
      where: { id: created.id },
      include: { items: true, units: { orderBy: { seq: "asc" } } },
    });
  });

  await syncCustomerOrderAggregate(req.params.id);
  res.status(201).json(order);
});

// Update status / notes / orderNumber order
// (endpoint lama — UI aktif sekarang pakai PATCH /orders/:id di orders.js;
// dipertahankan + tetap disinkronkan supaya tidak jadi jalan diam-diam yang
// membuat Customer.orderCount/orderValue basi kalau ini masih dipanggil
// lewat integrasi lain di luar UI.)
customerRouter.patch("/:id/orders/:orderId", async (req, res) => {
  const { status, notes, quantity, orderNumber } = req.body;
  const order = await prisma.order.update({
    where: { id: req.params.orderId },
    data: {
      ...(status      !== undefined && { status }),
      ...(notes       !== undefined && { notes }),
      ...(quantity    !== undefined && { quantity: Number(quantity) }),
      ...(orderNumber !== undefined && { orderNumber: orderNumber?.trim() || null }),
    },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  await syncCustomerOrderAggregate(order.customerId);
  res.json(order);
});

// PATCH /api/notes/:id — edit catatan (hanya penulis asli atau ADMIN)
customerRouter.patch("/notes/:id", async (req, res) => {
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: "Catatan tidak boleh kosong" });

  try {
    const note = await prisma.note.findUnique({ where: { id: req.params.id } });
    if (!note) return res.status(404).json({ error: "Catatan tidak ditemukan" });

    const isOwner = note.authorId === req.user.id;
    const isAdmin = rolesOf(req.user).includes("ADMIN");
    if (!isOwner && !isAdmin) return res.status(403).json({ error: "Tidak punya akses edit catatan ini" });

    const updated = await prisma.note.update({
      where: { id: req.params.id },
      data: { content: content.trim() },
      include: { author: true },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notes/:id — hapus catatan (hanya penulis asli atau ADMIN)
customerRouter.delete("/notes/:id", async (req, res) => {
  try {
    const note = await prisma.note.findUnique({ where: { id: req.params.id } });
    if (!note) return res.status(404).json({ error: "Catatan tidak ditemukan" });

    const isOwner = note.authorId === req.user.id;
    const isAdmin = rolesOf(req.user).includes("ADMIN");
    if (!isOwner && !isAdmin) return res.status(403).json({ error: "Tidak punya akses hapus catatan ini" });

    await prisma.note.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
