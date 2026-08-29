// ═══ SEED KATALOG HARGA (SEBAGIAN) — 29 Agustus 2026 ══════════════════════
// Sumber: "DAFTAR HARGA KLINIK MATRAS SANO — HARGA PER 5 JUL 2026".
// IDEMPOTEN (upsert by code) — aman dijalankan berulang.
//   docker compose exec backend node scripts/seedPriceList.mjs
//
// ⚠️ SENGAJA BARU SEBAGIAN. Baris daftar harga yang selnya JANGGAL TIDAK
// dimasukkan sama sekali — harga bukan sesuatu yang boleh ditebak. Daftar
// yang ditahan ada di PENDING di bawah dan dicetak ulang tiap kali script
// jalan, supaya tidak diam-diam terlupakan. Setelah owner mengonfirmasi
// angka benarnya, pindahkan barisnya dari PENDING ke ITEMS.
//
// Catatan tautan produksi: keenam layanan yang punya padanan di
// service_catalog (SVC_FONDASI, SVC_FULL, UPG_LAPISAN, UPG_FONDASI,
// UPG_FONDASI_LAPISAN, UPG_FULL) SEMUANYA masih di PENDING, jadi belum ada
// productionServiceId yang bisa ditautkan di seed ini.
//
// Revisi 30 Agustus 2026 — `sortOrder` KASUR diperbaiki supaya PERSIS
// mengikuti urutan baris di spreadsheet sumber (sebelumnya diurutkan bebas
// per kelompok kind, jadi katalog di UI tidak nyambung dengan urutan yang
// biasa dipakai sales lihat di Excel). Jarak antar angka (kelipatan 10)
// SENGAJA disisakan supaya baris PENDING nanti bisa disisipkan di posisi
// yang benar tanpa menomori ulang seluruhnya — lihat komentar posisi di
// tiap baris ITEMS & PENDING KASUR di bawah.
import { prisma } from "../src/db.js";

const K = ["90", "100", "120", "160", "180", "200"]; // varian kasur & divan
const S = ["SOFABED", "SOFA_L", "SOFA_1_SEATER", "SOFA_2_SEATER", "SOFA_3_SEATER"]; // varian sofa

// rate(keys, [[normal, standard], …]) — null = harga belum ditetapkan.
function rate(keys, pairs) {
  return keys.map((variantKey, i) => ({
    variantKey,
    normalPrice: pairs[i]?.[0] ?? null,
    standardPrice: pairs[i]?.[1] ?? null,
  }));
}
// Baris yang di daftar harga HANYA punya kolom STANDARD terisi.
function stdOnly(keys, vals) {
  return keys.map((variantKey, i) => ({ variantKey, normalPrice: null, standardPrice: vals[i] ?? null }));
}

const ITEMS = [
  // ── KASUR ── sortOrder = posisi baris di spreadsheet × 10 (lihat posisi
  // PENDING KASUR di bawah untuk baris yang celah nomornya sengaja kosong).
  // Posisi 3 dari atas.
  { code: "ADD_FONDASI_EXTRA_200", name: "Add Fondasi Extra (200kg)", productLine: "KASUR", kind: "SERVICE", sortOrder: 30,
    rates: rate(K, [[2000000, 1000000], [2000000, 1000000], [2400000, 1100000], [2600000, 1400000], [3100000, 1500000], [3500000, 1700000]]) },
  // Posisi 9.
  { code: "SVC_GANTI_KAIN_PREMIUM", name: "Ganti Kain Premium", productLine: "KASUR", kind: "SERVICE", discountPercent: 41.77, sortOrder: 90,
    rates: rate(K, [[1185000, 690000], [1185000, 690000], [1485000, 890000], [1935000, 1090000], [2235000, 1190000], [2535000, 1290000]]) },
  // Posisi 10.
  { code: "SVC_GANTI_KAIN_STANDARD", name: "Ganti Kain Standard", productLine: "KASUR", kind: "SERVICE", sortOrder: 100,
    rates: rate(K, [[1000000, 550000], [1000000, 550000], [1100000, 750000], [1300000, 850000], [1400000, 950000], [1500000, 990000]]) },
  // Posisi 12 (ADDON — di daftar harga hanya punya kolom STANDARD).
  { code: "ADD_KAIN_PINGGIR", name: "Ganti Kain Pinggir", productLine: "KASUR", kind: "ADDON", sortOrder: 120,
    rates: stdOnly(K, [250000, 250000, 300000, 400000, 500000, 500000]) },
  // Posisi 13.
  { code: "ADD_KAIN_ATAS_BAWAH", name: "Ganti Kain Atas/Bawah", productLine: "KASUR", kind: "ADDON", sortOrder: 130,
    rates: stdOnly(K, [300000, 300000, 400000, 500000, 600000, 600000]) },
  // Posisi 15 (posisi 14 "Harga Kaki" kosong total di spreadsheet — lihat PENDING).
  { code: "SVC_FONDASI_TAMBAH_BUSA", name: "Service Fondasi + Tambah Busa", productLine: "KASUR", kind: "SERVICE", sortOrder: 150,
    rates: stdOnly(K, [900000, 900000, 1200000, 1600000, 1700000, 1900000]) },
  // Posisi 16.
  { code: "SVC_RUBAH_TEXTURE", name: "Rubah Texture Menjadi Empuk/Keras", productLine: "KASUR", kind: "SERVICE", discountPercent: 33, sortOrder: 160,
    rates: rate(K, [[1635000, 1090000], [1635000, 1090000], [1935000, 1290000], [2235000, 1490000], [2685000, 1790000], [2985000, 1990000]]) },
  // Posisi 17.
  { code: "UPG_LAPISAN_LATEX", name: "Upgrade Lapisan Latex", productLine: "KASUR", kind: "SERVICE", discountPercent: 33, sortOrder: 170,
    rates: rate(K, [[2685000, 1790000], [2685000, 1790000], [2985000, 1990000], [3735000, 2490000], [4335000, 2890000], [4485000, 2990000]]) },
  // Posisi 19 (posisi 18 "Potong Ukuran" masih PENDING).
  { code: "SVC_TAMBAH_UKURAN", name: "Tambah Ukuran", productLine: "KASUR", kind: "SERVICE", discountPercent: 33, sortOrder: 190,
    rates: rate(K, [[2385000, 1590000], [2385000, 1590000], [2685000, 1790000], [2985000, 1990000], [3435000, 2290000], [3735000, 2490000]]) },
  // Posisi 20.
  { code: "SVC_STERILISASI", name: "Sterilisasi Tungau/Kutu", productLine: "KASUR", kind: "SERVICE", discountPercent: 33, sortOrder: 200,
    rates: rate(K, [[750000, 500000], [750000, 500000], [900000, 600000], [1050000, 700000], [1200000, 800000], [1350000, 900000]]) },
  // Posisi 22-23 (posisi 21 "Service Divan/Sandaran" ada di productLine DIVAN sendiri, lihat di bawah).
  { code: "ADD_BUSA_HRFOAM_2CM", name: "Tambah Busa HR Foam 2cm", productLine: "KASUR", kind: "ADDON", sortOrder: 220,
    rates: stdOnly(K, [150000, 150000, 200000, 250000, 300000, 350000]) },
  { code: "ADD_BUSA_ORTHOPEDI_2CM", name: "Tambah Busa Orthopedi 2cm", productLine: "KASUR", kind: "ADDON", sortOrder: 230,
    rates: stdOnly(K, [200000, 200000, 250000, 300000, 350000, 400000]) },

  // ── KASUR · PRODUCT (kategori order BARU) — posisi 25-28 (posisi 24
  // "Kasur Sewa" masih PENDING). ──────────────────────────────────────────
  { code: "PRD_MS_CUSTOM_T15", name: "Matras Sehat Custom TP T15", productLine: "KASUR", kind: "PRODUCT", sortOrder: 250,
    rates: stdOnly(K, [1890000, 1890000, 1990000, 2790000, 2990000, 3290000]) },
  { code: "PRD_MS_CUSTOM_T20", name: "Matras Sehat Custom TP T20", productLine: "KASUR", kind: "PRODUCT", discountPercent: 50, sortOrder: 260,
    rates: rate(K, [[6580000, 2090000], [6580000, 2090000], [6980000, 2390000], [7980000, 3290000], [8580000, 3690000], [8980000, 3990000]]) },
  { code: "PRD_MS_CUSTOM_T25", name: "Matras Sehat Custom TP T25", productLine: "KASUR", kind: "PRODUCT", discountPercent: 50, sortOrder: 270,
    rates: rate(K, [[7580000, 2590000], [7580000, 2590000], [7980000, 2990000], [8980000, 3790000], [9580000, 4190000], [9980000, 4490000]]) },
  { code: "PRD_MS_CUSTOM_T30", name: "Matras Sehat Custom TP T30", productLine: "KASUR", kind: "PRODUCT", discountPercent: 50, sortOrder: 280,
    rates: rate(K, [[8380000, 2990000], [8380000, 2990000], [8780000, 3490000], [9980000, 4490000], [10580000, 4890000], [10980000, 5190000]]) },
  // Posisi 32-34 (posisi 29 "Kasur Sehat 2in1", 30-31 Divan/Sandaran ada di
  // productLine DIVAN sendiri, masih PENDING utk 2in1).
  { code: "PRD_TOPPER_6CM", name: "Topper Kasur Sehat 6cm", productLine: "KASUR", kind: "PRODUCT", sortOrder: 320,
    note: "Sel NORMAL ukuran 90 di daftar harga berisi Rp576.000 — LEBIH RENDAH dari standard-nya (Rp850.000), jadi sengaja tidak diambil. Perlu konfirmasi owner.",
    rates: stdOnly(K, [850000, 850000, 950000, 1200000, 1300000, 1400000]) },
  { code: "PRD_TOPPER_8CM", name: "Topper Kasur Sehat 8cm", productLine: "KASUR", kind: "PRODUCT", sortOrder: 330,
    rates: stdOnly(K, [1100000, 1100000, 1300000, 1600000, 1800000, 2000000]) },
  { code: "PRD_TOPPER_10CM", name: "Topper Kasur Sehat 10cm", productLine: "KASUR", kind: "PRODUCT", sortOrder: 340,
    rates: stdOnly(K, [1300000, 1300000, 1500000, 1900000, 2200000, 2500000]) },

  // ── KASUR · FEE — posisi 35-36 (baris paling bawah spreadsheet). ────────
  { code: "FEE_TRANSPORT", name: "Biaya Transport (order di bawah Rp750rb)", productLine: "KASUR", kind: "FEE", sortOrder: 350,
    rates: stdOnly(K, [250000, 250000, 250000, 250000, 250000, 250000]) },
  { code: "FEE_BUANG_KASUR", name: "Biaya Buang Kasur/Divan per pcs", productLine: "KASUR", kind: "FEE", sortOrder: 360,
    rates: stdOnly(K, [200000, 200000, 200000, 200000, 200000, 250000]) },

  // ── DIVAN ───────────────────────────────────────────────────────────────
  { code: "SVC_DIVAN_SANDARAN", name: "Service Divan/Sandaran", productLine: "DIVAN", kind: "SERVICE", discountPercent: 33, sortOrder: 10,
    rates: rate(K, [[750000, 500000], [750000, 500000], [750000, 500000], [975000, 650000], [1125000, 750000], [1425000, 950000]]) },
  { code: "PRD_DIVAN", name: "Divan", productLine: "DIVAN", kind: "PRODUCT", sortOrder: 20,
    rates: stdOnly(K, [750000, 750000, 850000, 900000, 1000000, 1200000]) },
  { code: "PRD_SANDARAN", name: "Sandaran", productLine: "DIVAN", kind: "PRODUCT", sortOrder: 30,
    rates: stdOnly(K, [750000, 750000, 850000, 900000, 1000000, 1200000]) },

  // ── SOFA (paling konsisten di seluruh daftar — semua tepat 20%) ─────────
  { code: "SOFA_UPGRADE_BUSA", name: "Upgrade Busa Sofa", productLine: "SOFA", kind: "SERVICE", discountPercent: 20, sortOrder: 10,
    rates: rate(S, [[500000, 400000], [875000, 700000], [500000, 400000], [875000, 700000], [1125000, 900000]]) },
  { code: "SOFA_GANTI_KULIT_KAIN", name: "Ganti Kulit/Kain Sofa", productLine: "SOFA", kind: "SERVICE", discountPercent: 20, sortOrder: 20,
    rates: rate(S, [[625000, 500000], [1500000, 1200000], [875000, 700000], [1625000, 1300000], [2375000, 1900000]]) },
  { code: "SOFA_RESTORASI_RANGKA", name: "Restorasi Rangka Sofa", productLine: "SOFA", kind: "SERVICE", discountPercent: 20, sortOrder: 30,
    rates: rate(S, [[375000, 300000], [750000, 600000], [375000, 300000], [625000, 500000], [750000, 600000]]) },
  { code: "SOFA_FULL_SERVICE", name: "Full Service Sofa", productLine: "SOFA", kind: "SERVICE", discountPercent: 20, sortOrder: 40,
    rates: rate(S, [[1237500, 990000], [2487500, 1990000], [1375000, 1100000], [2625000, 2100000], [3750000, 3000000]]) },
];

// Baris daftar harga yang DITAHAN sampai owner mengonfirmasi angkanya.
// Urutan daftar ini SENGAJA mengikuti posisi baris asli di spreadsheet
// (dicocokkan dengan komentar "Posisi N" di ITEMS KASUR di atas) — supaya
// gampang dilacak balik ke baris mana persisnya kalau owner buka Excel-nya.
const PENDING = [
  // Posisi 1.
  ["Service Fondasi Matras Sehat", "DIS tertulis 33%, tapi potongan sebenarnya 47% (1.485.000 → 790.000) di semua ukuran."],
  // Posisi 2.
  ["Upgrade Fondasi Matras Sehat (150kg)", "Ukuran 160: 2.985.000 → 2.790.000 = potongan 6,5%, ukuran lain ±29-33%."],
  // Posisi 4.
  ["Upgrade Lapisan Matras Sehat", "Ukuran 180 normal Rp1.648.500 — tidak bulat, dan lebih murah dari ukuran 160 (Rp1.935.000)."],
  // Posisi 5.
  ["Paket Upgrade Fondasi + Lapisan MS", "LAYANAN PALING LAKU (80 order). Potongan drop dari ±30% (90/100/120) ke 8-12% (160/180/200)."],
  // Posisi 6.
  ["Paket Upgrade Fondasi Extra + Lapisan MS", "Ukuran 180 normal Rp8.183.500 — tidak bulat, pola sama dengan Upgrade Lapisan 180."],
  // Posisi 7.
  ["Full Upgrade Fondasi+Lapisan+Kain MS", "Angka standard ukuran 160 & 180 DICORET di spreadsheet. Masih berlaku atau sudah dicabut?"],
  // Posisi 8.
  ["Add Lapisan Memory Foam", "2.685.000 → 700.000 = potongan 74%, jauh dari DIS 33% yang tertulis."],
  // Posisi 11.
  ["Full Service", "Sel normal ukuran 120 berisi huruf \"X\", bukan angka."],
  // Posisi 14 — BUKAN salah baca, baris ini memang kosong total di
  // spreadsheet (nama ada, tidak ada satu pun angka harga).
  ["Harga Kaki", "Baris ada di spreadsheet tapi seluruh kolom harga kosong (bukan cuma sel tertentu) — belum ada angka sama sekali."],
  // Posisi 18.
  ["Potong Ukuran", "Ukuran 180 normal Rp2.025.000, sementara ukuran 200 cuma Rp1.125.000 — tidak monoton."],
  // Posisi 24.
  ["Kasur Sewa", "Kolom DIS berisi #DIV/0!, ukuran 90 & 100 kosong, dan ukuran 200 cuma ada 1 angka (tidak jelas itu Normal atau Standard)."],
  // Posisi 29 — scan lebih jelas (30 Agt) menunjukkan 3 pasang angka itu
  // sejajar tepat di bawah kolom 90/100/120 (bukan 160/180/200), tapi masih
  // ditahan karena baris ini tidak masuk salah satu dari 6 layanan yang
  // sudah punya padanan service_catalog — perlu konfirmasi kode/kind yang
  // tepat sebelum masuk katalog (PRODUCT seperti Matras Custom, atau kind
  // lain?).
  ["Kasur Sehat 2in1", "3 pasang angka terisi PERSIS di bawah kolom 90/100/120; kolom 160/180/200 kosong total. Kind katalog yang tepat belum dikonfirmasi."],
  ["Hemat (Sofa)", "Hanya punya kolom standard. Belum jelas ini paket hemat atau batas bawah khusus."],
];

async function main() {
  let itemCount = 0;
  let rateCount = 0;

  for (const { rates, ...item } of ITEMS) {
    const saved = await prisma.priceItem.upsert({
      where: { code: item.code },
      create: item,
      update: item, // rename/ubah kind & sortOrder ikut terbawa saat seed diulang
    });
    itemCount++;

    for (const r of rates) {
      // Sel yang dua-duanya null (varian tidak dilayani) tidak perlu dibuat.
      if (r.normalPrice == null && r.standardPrice == null) continue;
      await prisma.priceRate.upsert({
        where: { priceItemId_variantKey: { priceItemId: saved.id, variantKey: r.variantKey } },
        create: { priceItemId: saved.id, ...r },
        update: { normalPrice: r.normalPrice, standardPrice: r.standardPrice },
      });
      rateCount++;
    }
  }

  const perLine = await prisma.priceItem.groupBy({ by: ["productLine"], _count: { _all: true } });

  console.log("\n═══ SEED KATALOG HARGA SELESAI ═══");
  console.log(`Item tersimpan : ${itemCount}`);
  console.log(`Baris harga    : ${rateCount}`);
  for (const g of perLine) console.log(`  ${g.productLine.padEnd(6)} ${g._count._all} item`);

  console.log(`\n⚠️  DITAHAN — ${PENDING.length} baris daftar harga BELUM masuk katalog,`);
  console.log("   menunggu konfirmasi angka dari owner (harga tidak boleh ditebak):\n");
  for (const [nama, alasan] of PENDING) {
    console.log(`  • ${nama}`);
    console.log(`      ${alasan}`);
  }
  console.log("\nSetelah dikonfirmasi: pindahkan barisnya dari PENDING ke ITEMS di script ini, jalankan ulang.\n");

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
