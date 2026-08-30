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
// UPG_FONDASI_LAPISAN, UPG_FULL) — 5 dari 6 sudah masuk ITEMS sejak revisi
// 30 Agustus 2026 (SVC_FONDASI_MATRAS_SEHAT, UPG_FONDASI_150KG,
// UPG_LAPISAN_MS, PAKET_FONDASI_LAPISAN_MS, SVC_FULL_SERVICE_KASUR — cuma
// UPG_FULL/"Full Upgrade Fondasi+Lapisan+Kain MS" masih PENDING). Belum
// satu pun dari keenamnya diisi `productionServiceId` DI SEED INI — itu
// tautan terpisah ke ServiceCatalog production, di luar cakupan seed harga
// jual ini, belum dikerjakan.
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
  //
  // Revisi 30 Agustus 2026 — 8 dari 12 baris PENDING dipindahkan ke sini
  // atas konfirmasi owner: nominal Normal/Standard di spreadsheet SENDIRI
  // tidak ambigu (angka jelas terbaca), yang janggal cuma kolom DIS%
  // (potongan aktual tidak cocok dengan label %) — itu kolom REFERENSI yang
  // TIDAK PERNAH ditampilkan ke sales (endpoint /price-list tidak
  // mengembalikan field `discountPercent` sama sekali), jadi tidak
  // berisiko salah kutip harga ke customer. `discountPercent` tetap
  // disimpan APA ADANYA dari spreadsheet (bukan dihitung ulang) — sekadar
  // arsip, bukan sumber kebenaran harga.
  //
  // 4 baris SISANYA (posisi 7, 14, 24, 35) TETAP di PENDING — itu ambigu
  // soal ANGKA/MAKNANYA sendiri (bukan cuma label DIS%), lihat alasan
  // masing-masing di PENDING di bawah.
  //
  // Posisi 1.
  { code: "SVC_FONDASI_MATRAS_SEHAT", name: "Service Fondasi Matras Sehat", productLine: "KASUR", kind: "SERVICE", discountPercent: 33, sortOrder: 10,
    note: "DIS tertulis 33% di spreadsheet, potongan aktual ±47% — kolom ini arsip, tidak ditampilkan ke sales.",
    rates: rate(K, [[1485000, 790000], [1485000, 790000], [1785000, 1090000], [2235000, 1390000], [2535000, 1590000], [2985000, 1990000]]) },
  // Posisi 2.
  { code: "UPG_FONDASI_150KG", name: "Upgrade Fondasi Matras Sehat (150kg)", productLine: "KASUR", kind: "SERVICE", discountPercent: 33, sortOrder: 20,
    note: "DIS tertulis 33%, potongan aktual bervariasi 6,5%–33% antar ukuran — kolom ini arsip, tidak ditampilkan ke sales.",
    rates: rate(K, [[2235000, 1590000], [2235000, 1590000], [2685000, 1890000], [2985000, 2790000], [3435000, 2990000], [3735000, 3290000]]) },
  // Posisi 3.
  { code: "ADD_FONDASI_EXTRA_200", name: "Add Fondasi Extra (200kg)", productLine: "KASUR", kind: "SERVICE", sortOrder: 30,
    rates: rate(K, [[2000000, 1000000], [2000000, 1000000], [2400000, 1100000], [2600000, 1400000], [3100000, 1500000], [3500000, 1700000]]) },
  // Posisi 4.
  { code: "UPG_LAPISAN_MS", name: "Upgrade Lapisan Matras Sehat", productLine: "KASUR", kind: "SERVICE", discountPercent: 33, sortOrder: 40,
    note: "Harga ukuran 180 (Rp1.648.500) tidak bulat & lebih murah dari ukuran 160 — apa adanya dari spreadsheet, sudah dicek ulang bukan salah baca.",
    rates: rate(K, [[1335000, 900000], [1335000, 900000], [1485000, 1000000], [1935000, 1300000], [1648500, 1400000], [2385000, 1600000]]) },
  // Posisi 5.
  { code: "PAKET_FONDASI_LAPISAN_MS", name: "Paket Upgrade Fondasi + Lapisan MS", productLine: "KASUR", kind: "SERVICE", discountPercent: 33, sortOrder: 50,
    note: "Layanan paling laku (80 order). Potongan aktual turun dari ±30% (90/100/120) ke 8–12% (160/180/200) — kolom DIS arsip, tidak ditampilkan ke sales.",
    rates: rate(K, [[2985000, 2090000], [2985000, 2090000], [3285000, 2390000], [3735000, 3290000], [4035000, 3690000], [4485000, 3990000]]) },
  // Posisi 6.
  { code: "PAKET_FONDASI_EXTRA_LAPISAN_MS", name: "Paket Upgrade Fondasi Extra + Lapisan MS", productLine: "KASUR", kind: "SERVICE", sortOrder: 60,
    note: "Harga ukuran 180 (Rp8.183.500) tidak bulat, pola sama dengan Upgrade Lapisan MS ukuran 180 — apa adanya dari spreadsheet.",
    rates: rate(K, [[5570000, 3090000], [5570000, 3090000], [6570000, 3490000], [7520000, 4690000], [8183500, 5190000], [9620000, 5690000]]) },
  // Posisi 7 "Full Upgrade Fondasi+Lapisan+Kain MS" masih PENDING (lihat di bawah).
  // Posisi 8.
  { code: "ADD_LAPISAN_MEMORY_FOAM", name: "Add Lapisan Memory Foam", productLine: "KASUR", kind: "SERVICE", discountPercent: 33, sortOrder: 80,
    note: "DIS tertulis 33%, potongan aktual ±74% — kolom ini arsip, tidak ditampilkan ke sales.",
    rates: rate(K, [[2685000, 700000], [2685000, 700000], [2985000, 900000], [4150000, 1300000], [4335000, 1500000], [4485000, 1700000]]) },
  // Posisi 9.
  { code: "SVC_GANTI_KAIN_PREMIUM", name: "Ganti Kain Premium", productLine: "KASUR", kind: "SERVICE", discountPercent: 41.77, sortOrder: 90,
    rates: rate(K, [[1185000, 690000], [1185000, 690000], [1485000, 890000], [1935000, 1090000], [2235000, 1190000], [2535000, 1290000]]) },
  // Posisi 10.
  { code: "SVC_GANTI_KAIN_STANDARD", name: "Ganti Kain Standard", productLine: "KASUR", kind: "SERVICE", sortOrder: 100,
    rates: rate(K, [[1000000, 550000], [1000000, 550000], [1100000, 750000], [1300000, 850000], [1400000, 950000], [1500000, 990000]]) },
  // Posisi 11.
  { code: "SVC_FULL_SERVICE_KASUR", name: "Full Service (Service+Tambah Busa+Ganti Kain)", productLine: "KASUR", kind: "SERVICE", discountPercent: 29, sortOrder: 110,
    note: "Sel harga NORMAL ukuran 120 di spreadsheet berisi huruf \"X\" (bukan angka) — sengaja dikosongkan (null), bukan salah input. Standard ukuran 120 tetap terisi apa adanya.",
    rates: rate(K, [[2100000, 1500000], [2100000, 1500000], [null, 1800000], [3000000, 2000000], [3300000, 2100000], [3750000, 2200000]]) },
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
  // Posisi 18.
  { code: "SVC_POTONG_UKURAN", name: "Potong Ukuran", productLine: "KASUR", kind: "SERVICE", discountPercent: 33, sortOrder: 180,
    note: "Harga ukuran 180 (Rp2.025.000) lebih tinggi dari ukuran 200 (Rp1.125.000) — tidak monoton, tapi apa adanya dari spreadsheet.",
    rates: rate(K, [[750000, 500000], [750000, 500000], [750000, 500000], [900000, 600000], [2025000, 700000], [1125000, 900000]]) },
  // Posisi 19.
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
  // Posisi 29 — 3 pasang angka di spreadsheet sejajar PERSIS di bawah kolom
  // 90/100/120 (bukan 160/180/200), dikonfirmasi ulang lewat scan lebih
  // jelas 30 Agustus 2026. Kind PRODUCT — ini kasur jadi utuh, sama seperti
  // Matras Custom TP, bukan add-on/service.
  { code: "PRD_KASUR_2IN1", name: "Kasur Sehat 2in1", productLine: "KASUR", kind: "PRODUCT", sortOrder: 290,
    rates: rate(K, [[7980000, 3990000], [8980000, 4490000], [9980000, 4990000], null, null, null]) },
  // Posisi 32-34 (posisi 30-31 Divan/Sandaran ada di productLine DIVAN sendiri).
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
//
// Revisi 30 Agustus 2026 — 8 baris lain SUDAH dipindahkan ke ITEMS (lihat
// komentar di atas). 4 baris ini TETAP tertahan karena ambigu soal
// ANGKA/MAKNANYA SENDIRI (bukan cuma label DIS% yang toh tidak ditampilkan
// ke sales) — beda kelas masalah, tidak aman diisi apa adanya.
const PENDING = [
  // Posisi 7 — beda dari 8 baris yang sudah dipindahkan: yang dicoret di
  // sini BUKAN label DIS%, tapi ANGKA HARGA STANDARD-nya sendiri (160 & 180)
  // — coretan di Excel biasanya berarti "batal/tidak berlaku lagi", jadi
  // dipakai apa adanya berisiko salah kutip harga yang sudah tidak valid.
  ["Full Upgrade Fondasi+Lapisan+Kain MS", "Angka standard ukuran 160 & 180 DICORET di spreadsheet. Masih berlaku atau sudah dicabut?"],
  // Posisi 14 — BUKAN salah baca, baris ini memang kosong total di
  // spreadsheet (nama ada, tidak ada satu pun angka harga).
  ["Harga Kaki", "Baris ada di spreadsheet tapi seluruh kolom harga kosong (bukan cuma sel tertentu) — belum ada angka sama sekali."],
  // Posisi 24.
  ["Kasur Sewa", "Kolom DIS berisi #DIV/0!, ukuran 90 & 100 kosong, dan ukuran 200 cuma ada 1 angka (tidak jelas itu Normal atau Standard)."],
  // Posisi 35.
  ["Hemat (Sofa)", "Hanya punya kolom standard. Belum jelas ini paket hemat atau batas bawah khusus, dan belum jelas ini baris tersendiri atau modifier dari layanan lain."],
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
