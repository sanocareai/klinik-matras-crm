// EXPORT EXCEL — PEMBAYARAN & VERIFIKASI. Sumber data = services/finance/customerPaymentRead.js (query yang SAMA dengan layar
// GET /api/finance/customer-payments) dan daftarLunasBelumDicatat() (sama dengan GET /penerimaan/lunas-belum-dicatat).
//
// Cara layar memfilter: periode + tab (status) di SERVER; pencarian + chip (cara bayar, status, dibagi, foto bukti) di KLIEN.
// Karena itu layar mengirim `ids` = id pembayaran yang TAMPIL (urutan layar) + `periode` + `filter.status`; server memuat ulang baris itu
// lewat fungsi baca yang sama (masih dalam periode/status yang sama). Tab "Perlu Verifikasi Finance" & "Klaim Lunas dari Sales" juga
// menampilkan daftar klaim Lunas dari Sales (filter sisi-klien) → `filter.klaimIds`; tab "Klaim Lunas dari Sales" saja → `filter.hanyaKlaim`.
//
// Total: baris TOTAL = jumlah nominal pembayaran AKTIF pada baris yang diekspor (yang dibatalkan/diganti tidak dihitung, sama dengan
// kartu "Total Uang Masuk" di layar). Sheet "Ringkasan" mereproduksi tiga kartu angka di atas tabel (seluruh periode, apa pun tab-nya).
import { PERMISSIONS as P, hasPermission } from "../../../middleware/authorize.js";
import { moneyToNumber } from "../money.js";
import { ambilDaftarPembayaran } from "../customerPaymentRead.js";
import { daftarLunasBelumDicatat } from "../penerimaanOrder.js";
import { susunLabelFilter, tanggalIndonesiaPendek, ExportError } from "./excel.js";
import { labelCaraBayar } from "./label.js";
import { saringPembayaran } from "../saringPembayaran.js";
import { bangunAntreanVerifikasi } from "../antreanVerifikasi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_VALID = new Set(["belum_verifikasi", "terverifikasi", "dibatalkan"]);
const BATAS = 50_001; // 1 lebih dari MAKS_BARIS supaya excel.js menolak dengan pesan jelas, bukan memotong diam-diam

const rupiah = (n) => `Rp${Math.round(Number(n) || 0).toLocaleString("id-ID")}`;
const jumlah = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
// id pembayaran bertipe UUID di database — nilai yang bukan UUID dibuang (kalau tidak, Prisma melempar galat, bukan baris kosong).
const idsAman = (v) => (Array.isArray(v) ? [...new Set(v.map(String).filter((x) => UUID.test(x)))] : null);
// id order (klaim lunas) bukan UUID (cuid); hanya dicocokkan di memori.
// Saringan chip/pencarian layar yang dikirim sebagai parameter (bukan daftar id): dipakai fungsi saringPembayaran yang dibuktikan identik dengan layar.
const saringanDari = (filter) => ({ q: String(filter.q ?? ""), metode: String(filter.metode ?? ""), verif: String(filter.verif ?? ""), alokasi: String(filter.alokasi ?? ""), bukti: String(filter.bukti ?? ""), rekening: String(filter.rekening ?? "") });
const idsBebas = (v) => (Array.isArray(v) ? [...new Set(v.map(String))] : null);

/** Status turunan yang sama dengan badge di layar. */
function statusPembayaran(p) {
  if (p.cancelledAt) return p.replacedBy ? "Diganti versi baru" : "Dibatalkan";
  return p.verifications.length > 0 ? "Sudah diverifikasi" : "Menunggu";
}

async function sheetUangMasuk(db, { fromStr, toStr, status, ids, saringan }) {
  const mentah = saringPembayaran(await ambilDaftarPembayaran(db, { fromStr, toStr, status, ids }, { take: BATAS }), saringan);
  return bentukSheetPembayaran(mentah, { nama: "Uang Masuk", judul: "Pembayaran Pelanggan & Verifikasi" });
}

function bentukSheetPembayaran(mentah, { nama, judul, catatanTambahan = [] }) {
  const baris = mentah.map((p) => {
    const ver = p.verifications[0];
    const alokasi = p.finAllocations.map((a) => `${a.order?.orderNumber || "—"}: ${rupiah(moneyToNumber(a.amount))}`);
    return {
      waktu: p.createdAt, order: p.order?.orderNumber || "", pelanggan: p.order?.customer?.name || "", pencatat: p.recordedBy?.name || "",
      cara: labelCaraBayar(p.method), rekening: p.cashAccount?.name || "belum dipilih", nominal: p.amount,
      dibagi: alokasi.length > 0 ? "Ya" : "Tidak", alokasi: alokasi.length === 0 ? "order ini saja" : alokasi.join("; "),
      status: statusPembayaran(p), aktif: !p.cancelledAt,
      verifikator: ver?.verifiedBy?.name || "", waktuVerifikasi: ver?.createdAt || null,
      foto: p.proofPhotoUrl ? "Ada" : "Tanpa", tautanBukti: p.proofPhotoUrl || "",
      referensi: p.referenceNumber || "", catatan: p.notes || "", catatanInternal: p.internalNote || "",
      dibatalkanOleh: p.cancelledAt ? (p.cancelledBy?.name || "") : "", waktuBatal: p.cancelledAt || null, alasanBatal: p.cancelledAt ? (p.cancelReason || "") : "",
    };
  });
  const aktif = baris.filter((b) => b.aktif);
  return {
    baris,
    sheet: {
      nama, judul,
      kolom: [
        { key: "waktu", header: "Tanggal & Jam Dicatat", tipe: "waktu" }, { key: "order", header: "No. Order", tipe: "teks", lebar: 20 },
        { key: "pelanggan", header: "Pelanggan", tipe: "teks", lebar: 24 }, { key: "pencatat", header: "Dicatat Oleh", tipe: "teks", lebar: 18 },
        { key: "cara", header: "Cara Bayar", tipe: "teks", lebar: 12 }, { key: "rekening", header: "Masuk ke Rekening", tipe: "teks", lebar: 22 },
        { key: "nominal", header: "Nominal (Rp)", tipe: "uang" },
        { key: "dibagi", header: "Dibagi ke Beberapa Order", tipe: "teks", lebar: 14 }, { key: "alokasi", header: "Untuk Order", tipe: "teks", lebar: 34 },
        { key: "status", header: "Status", tipe: "teks", lebar: 20 },
        { key: "verifikator", header: "Diverifikasi Oleh", tipe: "teks", lebar: 18 }, { key: "waktuVerifikasi", header: "Tanggal & Jam Verifikasi", tipe: "waktu" },
        { key: "foto", header: "Foto Bukti", tipe: "teks", lebar: 10 },
        { key: "tautanBukti", header: "Tautan Foto Bukti", tipe: "teks", lebar: 36, sensitif: true },
        { key: "referensi", header: "No. Referensi", tipe: "teks", lebar: 20, sensitif: true },
        { key: "catatan", header: "Catatan", tipe: "teks", lebar: 30, sensitif: true },
        { key: "catatanInternal", header: "Catatan Internal", tipe: "teks", lebar: 30, sensitif: true },
        { key: "dibatalkanOleh", header: "Dibatalkan Oleh", tipe: "teks", lebar: 18 }, { key: "waktuBatal", header: "Tanggal & Jam Dibatalkan", tipe: "waktu" },
        { key: "alasanBatal", header: "Alasan Pembatalan", tipe: "teks", lebar: 28, sensitif: true },
      ],
      baris,
      total: { label: `TOTAL aktif (${aktif.length} pembayaran)`, nilai: { nominal: jumlah(aktif, "nominal") } },
      catatan: ["Yang dibatalkan atau diganti versi baru tidak dihitung di baris TOTAL. Salah catat dikoreksi lewat versi pengganti, bukan dihapus.", ...catatanTambahan],
    },
  };
}

/** Tiga kartu angka di atas tabel layar: seluruh pembayaran aktif pada periode (apa pun tab-nya), dipisah terverifikasi / menunggu. */
async function sheetRingkasan(db, { fromStr, toStr }) {
  const semua = await ambilDaftarPembayaran(db, { fromStr, toStr, status: "" }, { take: BATAS });
  const aktif = semua.filter((p) => !p.cancelledAt);
  const sudah = aktif.filter((p) => p.verifications.length > 0);
  const belum = aktif.filter((p) => p.verifications.length === 0);
  const s = (rows) => rows.reduce((a, p) => a + (p.amount || 0), 0);
  return {
    nama: "Ringkasan", judul: "Ringkasan Uang Masuk Periode Ini",
    kolom: [
      { key: "ket", header: "Keterangan", tipe: "teks", lebar: 40 }, { key: "jumlah", header: "Jumlah Pembayaran", tipe: "angka" }, { key: "nominal", header: "Nominal (Rp)", tipe: "uang" },
    ],
    baris: [
      { ket: "Total Uang Masuk (periode ini)", jumlah: aktif.length, nominal: s(aktif) },
      { ket: "Menunggu Verifikasi", jumlah: belum.length, nominal: s(belum) },
      { ket: "Sudah Diverifikasi", jumlah: sudah.length, nominal: s(sudah) },
    ],
    catatan: ["Sama dengan tiga kartu di atas tabel layar: seluruh pembayaran pada periode yang dipilih (yang dibatalkan tidak dihitung), apa pun tab yang sedang dibuka."],
  };
}

/** Ringkasan antrean "Perlu Verifikasi Finance" — angka dari bangunAntreanVerifikasi (fungsi baca yang sama dengan layar). Tidak ada transaksi yang dihitung dua kali. */
function sheetRingkasanAntrean(a, { periodeLabel }) {
  const r = a.ringkasan;
  const baris = [
    { ket: "Payment menunggu verifikasi", jumlah: r.paymentMenunggu.jumlah, nominal: r.paymentMenunggu.nominal, catatan: `Payment aktif yang belum diverifikasi pada periode ${periodeLabel} (sesuai saringan layar)` },
    { ket: "Klaim Lunas Sales (jumlah)", jumlah: r.klaimSales.jumlah, nominal: r.klaimSales.nominal, catatan: "Tidak terikat periode. Satu order = satu klaim (klaim berbukti didahulukan atas klaim lama)" },
    { ket: "   — klaim berbukti menunggu verifikasi", jumlah: r.klaimBerbuktiMenunggu.jumlah, nominal: r.klaimBerbuktiMenunggu.nominal, catatan: "Sales sudah mengajukan klaim dengan bukti pembayaran" },
    { ket: "   — klaim berbukti, bukti diminta", jumlah: r.klaimBerbuktiBuktiDiminta.jumlah, nominal: r.klaimBerbuktiBuktiDiminta.nominal, catatan: "Finance sudah meminta bukti tambahan; menunggu Sales" },
    { ket: "   — klaim lama, bukti belum lengkap", jumlah: r.klaimLamaBuktiBelumLengkap.jumlah, nominal: r.klaimLamaBuktiBelumLengkap.nominal, catatan: `Order Lunas tanpa Payment; ${r.klaimLamaBuktiBelumLengkap.dariItuBuktiDiminta} di antaranya sudah diminta buktinya` },
    { ket: "Bukti belum lengkap (ringkas)", jumlah: r.buktiBelumLengkap.jumlah, nominal: r.buktiBelumLengkap.nominal, catatan: "= klaim lama di atas; bagian dari Klaim Lunas Sales, bukan tambahan" },
    { ket: "Bukti diminta (ringkas)", jumlah: r.buktiDiminta.jumlah, nominal: r.buktiDiminta.nominal, catatan: "Klaim berbukti + klaim lama yang sudah diminta buktinya; bagian dari Klaim Lunas Sales, bukan tambahan" },
    { ket: "Dikurangi: order yang muncul di Payment menunggu DAN klaim", jumlah: -r.tumpangTindih.jumlah, nominal: -r.tumpangTindih.nominal, catatan: "Satu pekerjaan Finance dihitung sekali" },
    { ket: "TOTAL ANTREAN (tanpa hitung ganda)", jumlah: r.totalAntrean.jumlah, nominal: r.totalAntrean.nominal, catatan: r.totalAntrean.keterangan },
  ];
  return {
    nama: "Ringkasan", judul: "Ringkasan Antrean Perlu Verifikasi Finance",
    kolom: [{ key: "ket", header: "Keterangan", tipe: "teks", lebar: 56 }, { key: "jumlah", header: "Jumlah", tipe: "angka" }, { key: "nominal", header: "Nominal (Rp)", tipe: "uang" }, { key: "catatan", header: "Penjelasan", tipe: "teks", lebar: 80 }],
    baris,
    catatan: ["Sama dengan antrean di tab Perlu Verifikasi Finance: dihitung oleh fungsi baca server yang sama dengan layar. Payment dibatalkan tidak dihitung."],
  };
}

/** Sheet "Klaim Lunas Sales" TERPADU: klaim berbukti (menunggu / bukti diminta) + klaim lama (Lunas tanpa Payment), satu baris per order. */
function sheetKlaimTerpadu(a, cutoff) {
  const tgl = tanggalIndonesiaPendek(cutoff);
  const b1 = a.klaimBerbukti.map((k) => ({
    order: k.order.orderNumber || "", pelanggan: k.order.customerName, sales: k.order.salesName || "", lunasSejak: k.paymentDate || null,
    nilaiOrder: k.order.nilai, sudahDicatat: k.order.dibayar, perluDicek: k.amount || 0,
    jenis: k.status === "EVIDENCE_REQUESTED" ? "Klaim berbukti — bukti diminta" : "Klaim berbukti — menunggu verifikasi",
    buktiDiminta: k.status === "EVIDENCE_REQUESTED" ? (k.reviewedAt || null) : null, jumlahBukti: k.bukti.length, buktiLengkap: k.bukti.length > 0 ? "Ada" : "Belum lengkap",
  }));
  const b2 = a.klaimLama.map((i) => ({
    order: i.orderNumber || "", pelanggan: i.customerName, sales: i.salesName || "", lunasSejak: i.lunasSejak || null,
    nilaiOrder: i.nilaiOrder, sudahDicatat: i.sudahDicatat, perluDicek: i.sisa,
    jenis: i.kelompok === "BARU" ? "Klaim lama — perlu dicek" : `Klaim lama — sebelum ${tgl}`, buktiDiminta: i.buktiDiminta?.pada || null, jumlahBukti: 0, buktiLengkap: "Belum lengkap",
  }));
  const baris = [...b1, ...b2];
  return {
    nama: "Klaim Lunas Sales", judul: "Klaim Lunas dari Sales",
    kolom: [
      { key: "order", header: "No. Order", tipe: "teks", lebar: 20 }, { key: "pelanggan", header: "Pelanggan", tipe: "teks", lebar: 24 },
      { key: "sales", header: "Sales", tipe: "teks", lebar: 16 }, { key: "lunasSejak", header: "Ditandai Lunas", tipe: "tanggal" },
      { key: "nilaiOrder", header: "Nilai Order (Rp)", tipe: "uang" }, { key: "sudahDicatat", header: "Sudah Dicatat (Rp)", tipe: "uang" },
      { key: "perluDicek", header: "Perlu Dicek (Rp)", tipe: "uang" }, { key: "jenis", header: "Jenis", tipe: "teks", lebar: 34 },
      { key: "buktiLengkap", header: "Bukti", tipe: "teks", lebar: 16 }, { key: "jumlahBukti", header: "Jumlah Berkas Bukti", tipe: "angka" },
      { key: "buktiDiminta", header: "Bukti Diminta Pada", tipe: "waktu" },
    ],
    baris,
    total: { label: `TOTAL (${baris.length} order)`, nilai: { nilaiOrder: jumlah(baris, "nilaiOrder"), sudahDicatat: jumlah(baris, "sudahDicatat"), perluDicek: jumlah(baris, "perluDicek") } },
    catatan: ["Satu baris per order; klaim berbukti didahulukan atas klaim lama. Tidak terikat periode. Klaim Resi Gabungan tidak ikut di berkas ini."],
  };
}

/** Sheet "Klaim Lunas Sales": order yang ditandai Lunas oleh sales tetapi uang masuknya belum dicatat (daftar yang sama dengan layar). */
async function sheetKlaim(db, klaimIds) {
  const d = await daftarLunasBelumDicatat(db);
  const pilih = klaimIds ? new Set(klaimIds) : null;
  const items = d.items.filter((i) => !pilih || pilih.has(i.orderId));
  const tgl = tanggalIndonesiaPendek(d.cutoff);
  const baris = items.map((i) => ({
    order: i.orderNumber || "", pelanggan: i.customerName, sales: i.salesName || "", lunasSejak: i.lunasSejak || null,
    nilaiOrder: i.nilaiOrder, sudahDicatat: i.sudahDicatat, perluDicek: i.sisa,
    jenis: i.kelompok === "BARU" ? "Perlu dicek" : `Sebelum ${tgl}`, buktiDiminta: i.buktiDiminta?.pada || null,
  }));
  return {
    nama: "Klaim Lunas Sales", judul: "Klaim Lunas dari Sales (uang masuk belum dicatat)",
    kolom: [
      { key: "order", header: "No. Order", tipe: "teks", lebar: 20 }, { key: "pelanggan", header: "Pelanggan", tipe: "teks", lebar: 24 },
      { key: "sales", header: "Sales", tipe: "teks", lebar: 16 }, { key: "lunasSejak", header: "Ditandai Lunas", tipe: "tanggal" },
      { key: "nilaiOrder", header: "Nilai Order (Rp)", tipe: "uang" }, { key: "sudahDicatat", header: "Sudah Dicatat (Rp)", tipe: "uang" },
      { key: "perluDicek", header: "Perlu Dicek (Rp)", tipe: "uang" }, { key: "jenis", header: "Jenis", tipe: "teks", lebar: 18 },
      { key: "buktiDiminta", header: "Bukti Diminta Pada", tipe: "waktu" },
    ],
    baris,
    total: { label: `TOTAL (${baris.length} order)`, nilai: { nilaiOrder: jumlah(baris, "nilaiOrder"), sudahDicatat: jumlah(baris, "sudahDicatat"), perluDicek: jumlah(baris, "perluDicek") } },
    catatan: ["Order yang ditandai Lunas oleh sales di CRM tetapi belum ada catatan uang masuknya; daftar ini tidak terikat periode. Klaim Resi Gabungan tidak ikut di berkas ini."],
  };
}

async function ambil(db, { user, filter, periode, ids, filterLabel }) {
  const status = STATUS_VALID.has(filter.status) ? filter.status : "";
  const hanyaKlaim = filter.hanyaKlaim === true || filter.hanyaKlaim === "1";
  const sertakanKlaim = hanyaKlaim || filter.sertakanKlaim === true || filter.sertakanKlaim === "1";
  const klaimIds = idsBebas(filter.klaimIds);
  const punyaIzinKlaim = hasPermission(user, P.PAYMENT_READ);
  if (hanyaKlaim && !punyaIzinKlaim) throw new ExportError("Akun Anda tidak punya izin melihat klaim Lunas dari Sales", 403, "TIDAK_BERHAK");

  const sheets = [];
  let periodeLabel = "Klaim yang belum dicatat saat ini (tidak terikat periode)";
  if (!hanyaKlaim) {
    // Periode layar selalu terkirim; bila tidak (pemanggil lain) → bulan berjalan, sama dengan default layar (rentangDariQuery).
    const { rentangDariQuery } = await import("../../../routes/finance.js");
    let { fromStr, toStr } = rentangDariQuery({ from: periode.from ?? filter.from, to: periode.to ?? filter.to });
    periodeLabel = `${tanggalIndonesiaPendek(fromStr)} – ${tanggalIndonesiaPendek(toStr)}`;
    // Antrean "Perlu Verifikasi" (Payment menunggu + klaim) TIDAK terikat periode — sama dengan layar (FinancePayments.jsx): Payment menunggu dari bulan lalu tetap ikut.
    if (status === "belum_verifikasi" && sertakanKlaim && punyaIzinKlaim) { fromStr = "2000-01-01"; toStr = "2100-01-01"; periodeLabel = "Semua periode (antrean tidak terikat periode)"; }
    const saringan = saringanDari(filter);
    if (status === "belum_verifikasi" && sertakanKlaim && punyaIzinKlaim) {
      // TAB "PERLU VERIFIKASI FINANCE" = antrean gabungan (Payment menunggu + klaim Sales): Ringkasan, Payment Menunggu, Klaim Lunas Sales. BUKAN sheet "Uang Masuk".
      const a = await bangunAntreanVerifikasi(db, { fromStr, toStr, saringan, ids: idsAman(ids), klaimIds, denganKlaim: true });
      const dKlaim = await daftarLunasBelumDicatat(db);
      sheets.push(
        sheetRingkasanAntrean(a, { periodeLabel }),
        bentukSheetPembayaran(a.payments, { nama: "Payment Menunggu", judul: "Payment Menunggu Verifikasi Finance" }).sheet,
        sheetKlaimTerpadu(a, dKlaim.cutoff),
      );
      return { nama: "Pembayaran & Verifikasi", periodeLabel, filterLabel: filterLabel || susunLabelFilter([["Tab", "Perlu Verifikasi Finance"]]), sheets, basisTanggalLabel: "Tanggal pembayaran dicatat (Payment menunggu); klaim tidak terikat periode" };
    }
    const uang = await sheetUangMasuk(db, { fromStr, toStr, status, ids: idsAman(ids), saringan });
    sheets.push(uang.sheet, await sheetRingkasan(db, { fromStr, toStr }));
  }
  if (sertakanKlaim && punyaIzinKlaim) {
    if (hanyaKlaim) {
      const a = await bangunAntreanVerifikasi(db, { fromStr: "2000-01-01", toStr: "2100-01-01", klaimIds, denganKlaim: true });
      const dKlaim = await daftarLunasBelumDicatat(db);
      sheets.push(sheetKlaimTerpadu({ klaimBerbukti: a.klaimBerbukti, klaimLama: a.klaimLama }, dKlaim.cutoff));
    } else sheets.push(await sheetKlaim(db, klaimIds));
  }

  const labelStatus = { belum_verifikasi: "Perlu Verifikasi (menunggu)", terverifikasi: "Uang Masuk Terverifikasi", dibatalkan: "Dibatalkan" }[status];
  return {
    nama: "Pembayaran & Verifikasi",
    periodeLabel,
    filterLabel: filterLabel || susunLabelFilter([["Tab", hanyaKlaim ? "Klaim Lunas dari Sales" : labelStatus || "Semua"]]),
    sheets,
  };
}

export default { kunci: "pembayaran", nama: "Pembayaran & Verifikasi", izin: [P.FINANCE_READ], ambil };
