// ─── INVOICE — SATU-SATUNYA sumber logika tagihan (31 Agustus 2026) ─────────
//
// Semua aturan invoice (penomoran, nominal, status) ada DI SINI, bukan
// tersebar di route/komponen. Route cuma memanggil; UI cuma menampilkan apa
// yang dikembalikan. Kalau aturan tagihan berubah, satu file ini yang diubah.
//
// TIGA KEPUTUSAN YANG MENENTUKAN BENTUK FILE INI:
//
// 1. NOMINAL TIDAK PERNAH DISIMPAN DI TABEL invoices. Diturunkan tiap dibaca
//    dari Order + OrderItem + ledger Payment. Order lahir `value: 0` dan
//    itemnya menyusul (routes/customers.js POST /:id/orders), jadi invoice
//    yang menyalin angka saat dibuat akan selamanya Rp0. Menyalin juga =
//    dua sumber kebenaran untuk uang yang sama.
//
// 2. STATUS UANG TIDAK PERNAH DIKETIK MANUSIA. Kolom `lifecycleStatus` cuma
//    menyimpan tahap yang memang keputusan manusia (DRAFT → SENT → VIEWED,
//    atau CANCELLED). PARTIALLY_PAID / PAID / OVERDUE dihitung ulang dari
//    ledger + dueDate tiap kali dibaca (statusEfektif di bawah) — jadi
//    status invoice mustahil bertentangan dengan kebenaran uangnya. Pola
//    yang sama sudah dipakai Order.paymentStatus (services/paymentLedger.js).
//
// 3. ARTI UANGNYA IKUT `buildRingkasanOrder` DI routes/orders.js — sumber
//    yang SUDAH dipakai sales tiap hari untuk kirim ringkasan order ke WA:
//    OrderItem.harga = HARGA FINAL yang ditagih, Order.value = jumlahnya,
//    dan promo.discountPercent dipakai MENGHITUNG MUNDUR harga sebelum
//    diskon (bukan dipotong lagi dari value — itu akan dobel-diskon).
//    Invoice WAJIB menghasilkan angka yang sama dengan yang sudah dikirim
//    sales lewat WA, kalau tidak dua dokumen ke customer yang sama akan
//    saling bertentangan.

import { prisma } from "../db.js";

// Penomoran: INV-DDMMYYYY-NNN, counter per bulan — memakai ULANG tabel
// OrderSequence yang sudah ada (kuncinya [prefix, year, month], jadi prefix
// "INV" tinggal masuk) alih-alih membuat tabel counter kedua yang harus
// dirawat terpisah. Pola & alasan race-safety identik
// services/orderNumberGenerator.js.
export async function generateInvoiceNumber(tx = prisma) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const record = await tx.orderSequence.upsert({
    where: { prefix_year_month: { prefix: "INV", year, month } },
    update: { lastSeq: { increment: 1 } },
    create: { prefix: "INV", year, month, lastSeq: 1 },
  });

  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `INV-${dd}${mm}${year}-${String(record.lastSeq).padStart(3, "0")}`;
}

// Buat draft invoice untuk satu order — IDEMPOTEN. Dipanggil saat order lahir,
// TAPI juga dipakai sebagai jaring untuk order lama (dibuat sebelum fitur ini
// ada) begitu invoice-nya pertama kali dibuka: tidak ada backfill massal,
// invoice lahir saat benar-benar dibutuhkan.
//
// `tx` WAJIB diisi kalau dipanggil dari dalam transaksi order — supaya order
// gagal = invoice ikut batal, tidak meninggalkan invoice yatim.
export async function ensureInvoiceForOrder(tx, { orderId, userId = null }) {
  const existing = await tx.invoice.findUnique({ where: { orderId } });
  if (existing) return existing;

  const invoiceNumber = await generateInvoiceNumber(tx);
  try {
    return await tx.invoice.create({
      data: { orderId, invoiceNumber, createdById: userId },
    });
  } catch (e) {
    // P2002 = dua request bersamaan sama-sama lolos findUnique di atas.
    // Yang kalah race memakai punya yang menang, bukan gagal keras.
    if (e.code !== "P2002") throw e;
    return tx.invoice.findUnique({ where: { orderId } });
  }
}

// Hitung seluruh nominal tagihan dari data yang SUDAH ada. Tidak menyentuh DB
// (murni, gampang dites & dipanggil ulang) — pemanggil yang menyediakan order
// (beserta items/promo) dan daftar payment-nya.
export function hitungNominal(order, payments = []) {
  const totalLayanan = order.value || 0; // = SUM(items.harga), harga FINAL
  const ongkir = order.ongkir || 0;
  const ongkirKlaimGaransi = order.ongkirKlaimGaransi || 0;

  // Harga sebelum diskon dihitung MUNDUR dari harga final — persis cara
  // buildRingkasanOrder() di routes/orders.js. Tanpa promo, keduanya sama.
  const diskonPersen = order.promo?.discountPercent || null;
  const hargaSebelumDiskon = diskonPersen
    ? Math.round(totalLayanan / (1 - diskonPersen / 100))
    : totalLayanan;
  const nilaiDiskon = hargaSebelumDiskon - totalLayanan;

  // Yang benar-benar ditagih = layanan + ongkir. `ongkirKlaimGaransi`
  // SENGAJA tidak dijumlahkan ke tagihan: itu ongkir yang ditanggung untuk
  // klaim garansi (biaya kami, bukan tagihan customer) — ditampilkan
  // terpisah supaya tetap terlihat, tidak diam-diam masuk total.
  const totalTagihan = totalLayanan + ongkir;

  // ⚠️ LEDGER KOSONG BUKAN BERARTI BELUM BAYAR (ditemukan saat uji ke data
  // production, 31 Agustus 2026). Tabel `payments` di production masih NOL
  // baris: 228 order berstatus LUNAS mendapat status itu lewat dropdown
  // manual (services/paymentLedger.js baru dipakai jalur Payment/pengiriman
  // yang belum jalan). Kalau invoice cuma percaya ledger, SEMUA order lama
  // yang sudah lunas akan menagih ulang uang yang sudah dibayar — salah
  // yang langsung terlihat customer.
  //
  // Jadi: ledger dipakai kalau ADA isinya (paling akurat, ada rincian per
  // pembayaran). Kalau kosong, jatuh ke Order.paymentStatus yang memang
  // sinyal operasional yang dipakai tim hari ini. `sumber` ikut dikembalikan
  // supaya UI JUJUR menyebut angkanya dari mana — bukan mengarang rincian
  // pembayaran yang tidak pernah dicatat.
  const dibayarLedger = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const adaLedger = payments.length > 0;

  let dibayar = dibayarLedger;
  let sumber = "ledger";
  let dibayarTidakRinci = false;

  if (!adaLedger) {
    sumber = "statusManual";
    if (order.paymentStatus === "LUNAS") {
      dibayar = totalTagihan; // dianggap lunas penuh sesuai status
    } else if (order.paymentStatus === "DP") {
      // Tahu "sudah DP" tapi TIDAK tahu berapa — tidak boleh dikarang.
      dibayar = 0;
      dibayarTidakRinci = true;
    } else {
      dibayar = 0;
    }
  }

  const sisa = Math.max(totalTagihan - dibayar, 0);

  return {
    totalLayanan,
    hargaSebelumDiskon,
    diskonPersen,
    nilaiDiskon,
    promoCode: order.promo?.code || null,
    ongkir,
    ongkirKlaimGaransi,
    totalTagihan,
    dibayar,
    sisa,
    lunas: totalTagihan > 0 && dibayar >= totalTagihan,
    // "ledger" = ada rincian pembayaran tercatat; "statusManual" = angka
    // mengikuti dropdown status bayar di order, tanpa rincian.
    sumber,
    // true = statusnya DP tapi nominalnya tidak pernah tercatat di mana pun.
    dibayarTidakRinci,
  };
}

// Status yang DITAMPILKAN = gabungan tahap manual + kebenaran uang + jatuh
// tempo. Urutan pengecekan di bawah adalah aturannya, dibaca dari atas:
// pembatalan mengalahkan segalanya, lalu lunas, lalu jatuh tempo, dst.
export function statusEfektif({ invoice, nominal, now = new Date() }) {
  if (invoice.lifecycleStatus === "CANCELLED") return "CANCELLED";

  // Lunas menang atas apa pun tahap manualnya — invoice yang belum sempat
  // ditandai "terkirim" tapi uangnya sudah masuk penuh tetap PAID, bukan
  // tertinggal di DRAFT.
  if (nominal.lunas) return "PAID";

  // Jatuh tempo lewat & belum lunas. Dicek SEBELUM PARTIALLY_PAID supaya
  // tagihan yang baru dibayar separuh tapi sudah telat tetap kelihatan
  // sebagai masalah, bukan "sedang berjalan normal".
  if (invoice.dueDate && new Date(invoice.dueDate) < now) return "OVERDUE";

  // `dibayarTidakRinci` = status order bilang DP tapi nominalnya tidak
  // pernah tercatat — tetap PARTIALLY_PAID (kenyataannya memang sudah ada
  // uang masuk), walau angkanya nol di layar.
  if (nominal.dibayar > 0 || nominal.dibayarTidakRinci) return "PARTIALLY_PAID";

  // Belum ada uang masuk sama sekali → tahap manualnya yang berlaku.
  return invoice.lifecycleStatus; // DRAFT | SENT | VIEWED
}

// Payload lengkap untuk UI — satu panggilan, tidak perlu UI menggabungkan
// data dari beberapa endpoint (dan tidak ada peluang UI salah menghitung
// sendiri). Mengembalikan null kalau order tidak ada.
export async function buildInvoiceView(orderId, { userId = null, autoCreate = true } = {}) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      promo: { select: { code: true, name: true, discountPercent: true } },
      payments: { orderBy: { createdAt: "asc" } },
      customer: {
        select: {
          id: true, name: true, phone: true, city: true,
          assignedSales: { select: { id: true, name: true } },
        },
      },
      invoice: { include: { createdBy: { select: { id: true, name: true } } } },
    },
  });
  if (!order) return null;

  let invoice = order.invoice;
  if (!invoice && autoCreate) {
    invoice = await prisma.$transaction((tx) => ensureInvoiceForOrder(tx, { orderId, userId }));
  }
  if (!invoice) return null;

  const nominal = hitungNominal(order, order.payments);
  const status = statusEfektif({ invoice, nominal });

  return {
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status, // status EFEKTIF — ini yang ditampilkan
      lifecycleStatus: invoice.lifecycleStatus, // tahap manualnya, utk tombol aksi
      sentAt: invoice.sentAt,
      viewedAt: invoice.viewedAt,
      cancelledAt: invoice.cancelledAt,
      dueDate: invoice.dueDate,
      notes: invoice.notes,
      alamatTujuan: invoice.alamatTujuan,
      namaTujuan: invoice.namaTujuan,
      createdAt: invoice.createdAt,
      createdBy: invoice.createdBy?.name || null,
    },
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      category: order.category,
      status: order.status,
      paymentStatus: order.paymentStatus,
      merkKasur: order.merkKasur,
      ukuranKasur: order.ukuranKasur,
      deliveryAddress: order.deliveryAddress,
      deliveryCity: order.deliveryCity,
      pickupEstimate: order.pickupEstimate,
      pickupConfirmedDate: order.pickupConfirmedDate,
      deliveryEstimate: order.deliveryEstimate,
      deliveryConfirmedDate: order.deliveryConfirmedDate,
      createdAt: order.createdAt,
      items: order.items.map((i) => ({ id: i.id, nama: i.layananName, harga: i.harga })),
    },
    customer: {
      id: order.customer?.id || null,
      nama: order.customer?.name || null,
      phone: order.customer?.phone || null,
      kota: order.customer?.city || null,
      salesOwner: order.customer?.assignedSales?.name || null,
    },
    nominal,
    // `createdAt` = kapan pembayaran DICATAT (Payment memang tidak punya
    // kolom tanggal terpisah — lihat model Payment, sengaja append-only).
    payments: order.payments.map((p) => ({
      id: p.id, amount: p.amount, method: p.method, createdAt: p.createdAt,
    })),
  };
}

// Pindah tahap manual. SENGAJA menolak menulis status yang seharusnya
// TURUNAN (PAID/PARTIALLY_PAID/OVERDUE) — kalau suatu saat ada yang mencoba
// mengetik status uang lewat sini, gagalnya keras & jelas, bukan diam-diam
// menciptakan invoice yang statusnya bertentangan dengan ledger.
const TAHAP_MANUAL = new Set(["DRAFT", "SENT", "VIEWED", "CANCELLED"]);

export async function setInvoiceLifecycle(orderId, lifecycleStatus) {
  if (!TAHAP_MANUAL.has(lifecycleStatus)) {
    const e = new Error(
      `Status "${lifecycleStatus}" tidak bisa diset manual — PAID/PARTIALLY_PAID/OVERDUE ` +
      `diturunkan otomatis dari pembayaran & jatuh tempo.`
    );
    e.statusCode = 400;
    throw e;
  }

  const now = new Date();
  return prisma.invoice.update({
    where: { orderId },
    data: {
      lifecycleStatus,
      ...(lifecycleStatus === "SENT" && { sentAt: now }),
      ...(lifecycleStatus === "VIEWED" && { viewedAt: now }),
      ...(lifecycleStatus === "CANCELLED" && { cancelledAt: now }),
      // Batal lalu diaktifkan lagi: jejak pembatalan dibersihkan supaya
      // tidak menyisakan "cancelledAt" pada invoice yang hidup lagi.
      ...(lifecycleStatus === "DRAFT" && { cancelledAt: null, sentAt: null, viewedAt: null }),
    },
  });
}
