import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { JENIS_LAYANAN, MERK_KASUR, UKURAN_KASUR } from "../constants/orderOptions.js";
import { prisma } from "../db.js";

export const masterDataRouter = express.Router();
masterDataRouter.use(requireAuth);

// Opsi dropdown form order (Jenis Layanan, Merk Kasur, Ukuran Kasur) — satu
// sumber dipakai frontend web (OrderSection.jsx) & mobile (OrderFormModal.js),
// supaya rename/tambah opsi tidak perlu duplikasi kode di 2 platform.
masterDataRouter.get("/order-options", (req, res) => {
  res.json({ jenisLayanan: JENIS_LAYANAN, merkKasur: MERK_KASUR, ukuranKasur: UKURAN_KASUR });
});

// GET /api/master-data/service-catalog — katalog layanan aktif (Production
// Tahap 2), untuk dropdown "tetapkan layanan" di detail unit
// (PATCH /units/:id/service). Sumbernya routing_stages/service_catalog yang
// SUDAH ter-seed sejak Phase 0 — endpoint ini cuma menyingkapnya, bukan
// data baru.
masterDataRouter.get("/service-catalog", async (req, res) => {
  try {
    const services = await prisma.serviceCatalog.findMany({
      where: { active: true },
      orderBy: [{ serviceLine: "asc" }, { sortOrder: "asc" }],
      select: { id: true, code: true, labelId: true, serviceLine: true },
    });
    res.json({ services });
  } catch (err) {
    res.status(500).json({ error: "Server error: " + err.message });
  }
});

// GET /api/master-data/price-list?productLine=KASUR&variantKey=160
// Katalog harga SALES untuk satu lini produk + satu varian — dipakai form
// order (OrderSection.jsx) menampilkan daftar layanan beserta harga normal &
// standard-nya begitu sales memilih lini produk + ukuran.
//
// ⚠️ BUKAN /service-catalog di atas. Itu katalog PRODUKSI (routing modul
// kerja, tanpa harga, ditetapkan tim produksi di Uji Fondasi). Yang ini
// katalog harga jual. Lihat catatan panjang di schema.prisma#PriceItem.
const PRODUCT_LINES = new Set(["KASUR", "SOFA", "DIVAN"]);

masterDataRouter.get("/price-list", async (req, res) => {
  try {
    const { productLine, variantKey } = req.query;
    // Whitelist eksplisit, bukan diteruskan mentah ke query — konvensi sama
    // dengan LEAD_SOURCE_VALUES di analytics.js.
    if (!PRODUCT_LINES.has(productLine)) {
      return res.status(400).json({ error: "productLine wajib salah satu dari: KASUR, SOFA, DIVAN" });
    }

    const items = await prisma.priceItem.findMany({
      where: { productLine, active: true },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true, code: true, name: true, kind: true, note: true,
        // Kalau variantKey dikirim, muat HANYA sel untuk varian itu (1 baris
        // per layanan). Kalau tidak, muat semua sel — dipakai kalau nanti ada
        // halaman admin daftar harga yang menampilkan matriks penuh.
        rates: {
          where: variantKey ? { variantKey: String(variantKey) } : undefined,
          select: { variantKey: true, normalPrice: true, standardPrice: true },
        },
      },
    });

    // Diratakan jadi 1 objek per layanan saat variantKey diminta, supaya
    // frontend tidak perlu menggali rates[0] sendiri. normalPrice/
    // standardPrice tetap boleh null — NULL artinya harga belum ditetapkan
    // untuk ukuran itu, BUKAN nol (lihat catatan di PriceRate).
    const data = variantKey
      ? items.map(({ rates, ...item }) => ({
          ...item,
          variantKey: String(variantKey),
          normalPrice: rates[0]?.normalPrice ?? null,
          standardPrice: rates[0]?.standardPrice ?? null,
          // true = layanan ini memang ada di katalog, tapi harga untuk ukuran
          // ini belum diisi. Frontend menampilkannya sebagai "harga belum
          // ditetapkan" dan tetap membolehkan input manual.
          belumBerharga: rates.length === 0 || (rates[0]?.normalPrice == null && rates[0]?.standardPrice == null),
        }))
      : items;

    res.json({ productLine, variantKey: variantKey ? String(variantKey) : null, items: data });
  } catch (err) {
    res.status(500).json({ error: "Server error: " + err.message });
  }
});
