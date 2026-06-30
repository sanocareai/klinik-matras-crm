// Script seed produk contoh untuk Klinik Matras
// Jalankan: node backend/seed-products.js
// (pastikan backend/data/products/ ada dulu)

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const products = [
  {
    name: "Upgrade Lapisan Matras Sehat",
    description: "Ganti lapisan matras lama dengan bahan baru yang lebih sehat dan nyaman. Menggunakan bahan hypoallergenic berkualitas tinggi.",
    category: "Upgrade",
    price: 450000,
    priceUnit: "mulai dari",
    sortOrder: 0,
  },
  {
    name: "Garansi Premium Matras",
    description: "Paket garansi 3 tahun untuk servis rutin, penggantian pegas, dan pembersihan mendalam. Tenang tanpa biaya tak terduga.",
    category: "Garansi",
    price: 250000,
    priceUnit: "per tahun",
    sortOrder: 1,
  },
  {
    name: "Servis Fondasi Matras",
    description: "Perbaikan dan pengencangan fondasi/rangka matras agar tidak bunyi dan tetap kokoh. Termasuk pengecekan per dan kain pelapis.",
    category: "Servis",
    price: 175000,
    priceUnit: "mulai dari",
    sortOrder: 2,
  },
];

async function main() {
  console.log("Memulai seed produk...");
  for (const p of products) {
    const existing = await prisma.product.findFirst({ where: { name: p.name } });
    if (existing) {
      console.log(`  ⏭  Sudah ada: ${p.name}`);
      continue;
    }
    await prisma.product.create({ data: p });
    console.log(`  ✓  Dibuat: ${p.name}`);
  }
  console.log("Seed selesai! Upload foto produk di halaman /products (login sebagai ADMIN).");
}

main().catch(console.error).finally(() => prisma.$disconnect());
