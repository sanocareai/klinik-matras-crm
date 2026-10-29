// LAPORAN PRODUKSI TERPADU — definisi metrik (satu sumber untuk ikon info di layar dan sheet Excel) + dokumen ekspor per tab.
// Ekspor memakai FUNGSI DATA YANG SAMA dengan layar (services/laporanProduksi.js) atas SELURUH hasil (bukan halaman pertama) → layar = grafik = tabel = Excel.
import { buatXlsx, namaBerkas } from "./finance/export/excel.js";
import { DASAR_TANGGAL, bahanGudang, biayaPerOrder, kinerja, ringkasOrder, ringkasan, saringUrutOrder } from "./laporanProduksi.js";
import { MASALAH, STATUS_NILAI } from "../lib/domain/laporanProduksi.js";

export const DEFINISI = Object.freeze([
  { key: "order_dikerjakan", label: "Order dikerjakan", formula: "Order yang punya pemakaian bahan pada periode ATAU unitnya diserahkan sebagai barang jadi pada periode. Order, unit, dan baris pemakaian dihitung terpisah.", basis: DASAR_TANGGAL.biaya },
  { key: "hpp_diketahui", label: "HPP Bahan diketahui", formula: "Σ nilai pemakaian − pengembalian ± koreksi yang SUDAH dibekukan dengan harga berlaku resmi saat pemakaian diposting. Di luar delivery dan biaya lain. Susut dan SANO GUARD tidak ikut. Bukan nilai persediaan/jurnal Finance.", basis: DASAR_TANGGAL.biaya },
  { key: "status_biaya", label: "Status biaya (Lengkap / Parsial / Belum diketahui)", formula: "Lengkap = tidak ada masalah dan ada nilai dibekukan (atau semua unit dinyatakan tanpa bahan baru). Parsial = sebagian nilai diketahui tetapi masih ada masalah. Belum diketahui = belum ada nilai dibekukan. Nilai kosong BUKAN Rp0.", basis: DASAR_TANGGAL.posisi },
  { key: "masalah", label: "Jumlah masalah", formula: "Jumlah item yang perlu ditindaklanjuti: pemakaian belum dibekukan / tanpa harga / gagal, catatan historis tertahan, unit dinilai tanpa pemakaian, pemakaian sementara, SANO GUARD.", basis: "Pemakaian: tanggal pemakaian dalam periode · catatan/unit: posisi saat ini" },
  { key: "unit_selesai", label: "Unit selesai produksi", formula: "Unit yang barang jadinya diserahkan produksi ke Gudang pada periode. Setiap unit dihitung sekali; berpindah meja atau punya beberapa PIC tidak menggandakan total.", basis: DASAR_TANGGAL.selesai },
  { key: "tidak_tercatat", label: "Tidak tercatat", formula: "Unit selesai yang meja/PIC-nya tidak tercatat pada rencana produksi. Ditampilkan sendiri supaya jumlah baris sama dengan total selesai; tidak ditebak.", basis: "Penetapan terakhir pada rencana/jadwal" },
  { key: "durasi", label: "Durasi produksi", formula: "Rata-rata menit dari mulai produksi sampai serah barang jadi, hanya untuk unit yang memiliki KEDUA waktu itu. Belum tersedia bila kurang dari 3 unit; tidak pernah dianggap 0.", basis: DASAR_TANGGAL.selesai },
  { key: "rencana_terisi", label: "Rencana terisi", formula: "Unit terjadwal ÷ kapasitas rencana (kapasitas per meja per hari × hari yang berjadwal). Ini rencana, BUKAN pekerjaan aktual; pekerjaan aktual = unit selesai.", basis: DASAR_TANGGAL.jadwal },
  { key: "permintaan_menunggu", label: "Permintaan bahan menunggu", formula: "Permintaan bahan produksi yang belum diterbitkan (menunggu persetujuan, siap ambil, atau sudah diambil).", basis: DASAR_TANGGAL.posisi },
  { key: "kelengkapan", label: "Kelengkapan data (Bahan belum dicatat / perlu dicek / HPP belum lengkap)", formula: "Klasifikasi yang sama dengan filter di Order Produksi.", basis: DASAR_TANGGAL.posisi },
  { key: "sano_guard", label: "SANO GUARD", formula: "Bahan produksi internal. Hubungan biaya perakitannya ke bahan penyusun belum tersedia di sistem; menghitung keduanya otomatis berisiko hitung ganda, jadi nilainya tidak dijumlahkan sebagai biaya terbukti.", basis: "Gap data" },
]);

const rp = (k, h) => ({ key: k, header: h, tipe: "uang", sensitif: true });
const KOLOM_MASALAH = Object.entries(MASALAH).map(([k, v]) => ({ key: `m_${k}`, header: v.label, tipe: "angka" }));
const barisMasalah = (m) => Object.fromEntries(Object.keys(MASALAH).map((k) => [`m_${k}`, m[k] ?? 0]));

function sheetCakupan(ctx, filterTeks, tab) {
  const p = ctx.periode;
  const info = [
    { item: "Periode", nilai: `${p.from} s/d ${p.to} (${p.days} hari, WIB)` }, { item: "Filter", nilai: filterTeks },
    { item: "Cakupan", nilai: "Semua unit non-batal (dikerjakan langsung, historis, atau di luar rencana V2). Bukan hanya unit dalam kohort rencana." },
    { item: "Pergerakan pada unit batal/tidak ditemukan (tidak dihitung)", nilai: String(ctx.movKeluarUnit) },
    ...Object.entries(DASAR_TANGGAL).map(([k, v]) => ({ item: `Dasar tanggal — ${k}`, nilai: v })),
    ...DEFINISI.map((d) => ({ item: `Definisi: ${d.label}`, nilai: `${d.formula} [Dasar: ${d.basis}]` })),
    ...Object.entries(STATUS_NILAI).map(([k, v]) => ({ item: `Status nilai: ${k}`, nilai: v })),
    { item: "Tab", nilai: tab },
  ];
  return { nama: "Cakupan dan Definisi", judul: "Cakupan, dasar tanggal, definisi metrik", kolom: [{ key: "item", header: "Item", tipe: "teks", lebar: 40 }, { key: "nilai", header: "Nilai", tipe: "teks", lebar: 120 }], baris: info };
}

export async function dokumenEkspor(prisma, ctx, tab, query, { izinHarga }) {
  const filterTeks = [query.q && `cari "${query.q}"`, query.status && `status ${query.status}`, query.masalah && `masalah ${query.masalah}`, query.dasar && `tampilan ${query.dasar}${query.peran ? ` (${query.peran})` : ""}`, ctx.termasukMasuk && "termasuk order yang baru masuk tanpa pemakaian"].filter(Boolean).join("; ") || "Tanpa filter";
  const periodeLabel = `${ctx.periode.from} s/d ${ctx.periode.to}`;
  const dasarLabel = tab === "kinerja" ? DASAR_TANGGAL.selesai : tab === "bahan-gudang" ? `${DASAR_TANGGAL.biaya}; permintaan: ${DASAR_TANGGAL.permintaan}` : DASAR_TANGGAL.biaya;
  const sheets = [];
  if (tab === "biaya-order") {
    const { orders } = await biayaPerOrder(prisma, ctx, { izinHarga });
    const baris = saringUrutOrder(orders, query); const tot = ringkasOrder(baris);
    sheets.push({
      nama: "Biaya per Order", judul: "Biaya per Order — HPP Bahan operasional", baris: baris.map((o) => ({ order: o.orderNumber, pelanggan: o.pelanggan, unitDalamOrder: o.unitDalamOrder, unitDikerjakan: o.unitDikerjakan, barisPemakaian: o.barisPemakaian, hpp: o.nilaiDiketahui, susut: o.susut, status: o.statusLabel, jumlahMasalah: o.jumlahMasalah, ...barisMasalah(o.masalah) })),
      kolom: [{ key: "order", header: "No. Order", tipe: "teks", lebar: 20 }, { key: "pelanggan", header: "Pelanggan", tipe: "teks", lebar: 26 }, { key: "unitDalamOrder", header: "Unit dalam order", tipe: "angka" }, { key: "unitDikerjakan", header: "Unit dikerjakan (periode)", tipe: "angka" }, { key: "barisPemakaian", header: "Baris pemakaian", tipe: "angka" },
        rp("hpp", "HPP Bahan diketahui (Rp)"), rp("susut", "Susut (Rp, terpisah)"), { key: "status", header: "Status biaya", tipe: "teks", lebar: 18 }, { key: "jumlahMasalah", header: "Jumlah masalah", tipe: "angka" }, ...KOLOM_MASALAH],
      total: izinHarga ? { label: `TOTAL (${tot.order} order, ${tot.unit} unit)`, nilai: { barisPemakaian: tot.barisPemakaian, hpp: tot.nilaiDiketahui, susut: tot.susut, jumlahMasalah: tot.jumlahMasalah } } : undefined,
      catatan: ["Sel nilai kosong/Belum diketahui = belum ada harga resmi yang dibekukan — bukan Rp0.", "HPP Bahan operasional ≠ nilai persediaan/jurnal Finance."],
    });
    sheets.push({
      nama: "Rincian Bahan", judul: "Rincian bahan per unit", kolom: [{ key: "order", header: "No. Order", tipe: "teks", lebar: 20 }, { key: "unit", header: "Unit", tipe: "teks", lebar: 18 }, { key: "kode", header: "Kode Bahan", tipe: "teks", lebar: 18 }, { key: "bahan", header: "Bahan", tipe: "teks", lebar: 30 }, { key: "jenis", header: "Jenis", tipe: "teks", lebar: 14 },
        { key: "qty", header: "Jumlah", tipe: "angka" }, { key: "satuan", header: "Satuan", tipe: "teks", lebar: 9 }, rp("harga", "Harga (Rp/satuan)"), rp("subtotal", "Subtotal (Rp)"), { key: "tanggalPemakaian", header: "Tanggal pemakaian (WIB)", tipe: "tanggal" }, { key: "dasarTanggal", header: "Dasar tanggal", tipe: "teks", lebar: 28 },
        { key: "waktuPencatatan", header: "Waktu pencatatan (WIB)", tipe: "waktu" }, { key: "tanggalDasarHarga", header: "Harga berlaku sejak", tipe: "tanggal" }, { key: "sumberHarga", header: "Sumber harga", tipe: "teks", lebar: 22 }, { key: "status", header: "Status nilai", tipe: "teks", lebar: 34 }],
      baris: baris.flatMap((o) => o.unit.flatMap((u) => u.baris.map((b) => ({ order: o.orderNumber, unit: u.unitCode, kode: b.kode, bahan: b.bahan, jenis: b.jenis, qty: b.qty, satuan: b.satuan, harga: b.harga, subtotal: b.subtotal, tanggalPemakaian: b.tanggalPemakaian, dasarTanggal: b.dasarTanggal, waktuPencatatan: b.waktuPencatatan, tanggalDasarHarga: b.dasarHargaTanggal, sumberHarga: b.sumberHarga, status: STATUS_NILAI[b.status] ?? b.status })))),
    });
  } else if (tab === "kinerja") {
    const k = await kinerja(prisma, ctx, { peran: query.peran === "CORNER" ? "CORNER" : "MEJA" });
    sheets.push({ nama: "Per Meja", judul: "Kinerja Produksi per Meja", kolom: [{ key: "label", header: "Meja", tipe: "teks", lebar: 20 }, { key: "terjadwal", header: "Terjadwal (rencana)", tipe: "angka" }, { key: "kapasitasRencana", header: "Kapasitas rencana", tipe: "angka" }, { key: "rencanaTerisiPct", header: "Rencana terisi (%)", tipe: "angka" }, { key: "selesai", header: "Selesai (aktual)", tipe: "angka" }, { key: "durasi", header: "Rata-rata durasi produksi", tipe: "teks", lebar: 30 }],
      baris: [...k.meja.baris.map((m) => ({ ...m, durasi: m.durasi.rataMenit != null ? `${m.durasi.rataMenit} menit (n=${m.durasi.n})` : m.durasi.catatan })), { label: "Tidak tercatat", terjadwal: null, kapasitasRencana: null, rencanaTerisiPct: null, selesai: k.meja.tidakTercatat.selesai, durasi: "Belum tersedia" }],
      total: { label: "TOTAL unit selesai", nilai: { selesai: k.meja.totalSelesai } }, catatan: ["Total selesai = jumlah unit unik; setiap unit dihitung sekali meski berpindah meja.", "Rencana (terjadwal) dan pekerjaan aktual (selesai) dipisah; keduanya bukan skor performa."] });
    sheets.push({ nama: "Per PIC", judul: `Kinerja Produksi per PIC (${k.pic.peran === "CORNER" ? "Corner" : "Meja"})`, kolom: [{ key: "label", header: "PIC", tipe: "teks", lebar: 28 }, { key: "selesai", header: "Unit selesai", tipe: "angka" }, { key: "durasi", header: "Rata-rata durasi produksi", tipe: "teks", lebar: 30 }],
      baris: k.pic.baris.map((p) => ({ label: p.label, selesai: p.selesai, durasi: p.durasi.rataMenit != null ? `${p.durasi.rataMenit} menit (n=${p.durasi.n})` : p.durasi.catatan })), total: { label: "TOTAL unit selesai", nilai: { selesai: k.selesai.unit } }, catatan: [k.pic.catatan] });
  } else if (tab === "bahan-gudang") {
    const g = await bahanGudang(prisma, ctx, { izinHarga, q: query.q });
    sheets.push({ nama: "Pemakaian per Bahan", judul: "Pemakaian bahan per bahan (periode)", kolom: [{ key: "kode", header: "Kode", tipe: "teks", lebar: 20 }, { key: "bahan", header: "Bahan", tipe: "teks", lebar: 32 }, { key: "satuan", header: "Satuan", tipe: "teks", lebar: 9 }, { key: "dipakai", header: "Dipakai", tipe: "angka" }, { key: "dikembalikan", header: "Dikembalikan", tipe: "angka" }, { key: "koreksi", header: "Koreksi", tipe: "angka" }, { key: "bersih", header: "Pemakaian bersih", tipe: "angka" }, { key: "susut", header: "Susut (terpisah)", tipe: "angka" }, { key: "unit", header: "Unit", tipe: "angka" }, rp("nilaiDiketahui", "Nilai diketahui (Rp)"), { key: "masalah", header: "Masalah", tipe: "angka" }], baris: g.bahan });
    sheets.push({ nama: "Permintaan Bahan", judul: "Permintaan bahan produksi & kelengkapan", kolom: [{ key: "item", header: "Item", tipe: "teks", lebar: 46 }, { key: "nilai", header: "Nilai", tipe: "angka" }],
      baris: [{ item: "Permintaan dibuat (periode)", nilai: g.permintaan.dibuatPeriode }, { item: "Permintaan diterbitkan (periode)", nilai: g.permintaan.diterbitkanPeriode }, { item: "Permintaan menunggu (saat ini)", nilai: g.permintaan.menungguSaatIni }, { item: "Bahan belum dicatat (saat ini, unit)", nilai: g.kelengkapan.bahanBelumDicatat }, { item: "Bahan perlu dicek (saat ini, unit)", nilai: g.kelengkapan.bahanPerluDicek }, { item: "HPP belum lengkap (saat ini, unit)", nilai: g.kelengkapan.hppBelumLengkap }] });
  } else {
    const r = await ringkasan(prisma, ctx, { izinHarga });
    sheets.push({ nama: "Ringkasan", judul: "Ringkasan Laporan Produksi", kolom: [{ key: "item", header: "Metrik", tipe: "teks", lebar: 46 }, { key: "nilai", header: "Nilai", tipe: "angka" }, { key: "catatan", header: "Dasar", tipe: "teks", lebar: 60 }],
      baris: [{ item: "Order dikerjakan", nilai: r.kartu.orderDikerjakan.order, catatan: DASAR_TANGGAL.biaya }, { item: "Unit pada order tersebut", nilai: r.kartu.orderDikerjakan.unit, catatan: "" }, { item: "Baris pemakaian bahan", nilai: r.kartu.orderDikerjakan.barisPemakaian, catatan: "" },
        ...(izinHarga && r.kartu.hppDiketahui ? [{ item: "HPP Bahan diketahui (Rp)", nilai: r.kartu.hppDiketahui.nilai, catatan: "Bukan nilai Finance" }, { item: "Order Lengkap", nilai: r.kartu.hppDiketahui.orderLengkap, catatan: "" }, { item: "Order Parsial", nilai: r.kartu.hppDiketahui.orderParsial, catatan: "" }, { item: "Order Belum diketahui", nilai: r.kartu.hppDiketahui.orderBelumDiketahui, catatan: "" }] : []),
        { item: "Jumlah masalah", nilai: r.kartu.masalah.jumlah, catatan: "Lihat tab Biaya per Order" }, { item: "Unit selesai produksi", nilai: r.kartu.selesai.unit, catatan: DASAR_TANGGAL.selesai }, { item: "Permintaan bahan menunggu", nilai: r.kartu.permintaanMenunggu, catatan: DASAR_TANGGAL.posisi }] });
    sheets.push({ nama: "Per Hari", judul: "Unit selesai dan pemakaian per hari", kolom: [{ key: "tanggal", header: "Tanggal (WIB)", tipe: "tanggal" }, { key: "selesai", header: "Unit selesai", tipe: "angka" }, { key: "biaya", header: izinHarga ? "HPP diketahui (Rp)" : "Baris pemakaian", tipe: izinHarga ? "uang" : "angka", sensitif: false }],
      baris: r.grafik.selesaiPerHari.map((s, i) => ({ tanggal: s.tanggal, selesai: s.nilai, biaya: r.grafik.biayaPerHari[i].nilai })) });
  }
  sheets.push(sheetCakupan(ctx, filterTeks, tab));
  return { nama: `Laporan Produksi — ${tab}`, periodeLabel, filterLabel: filterTeks, basisTanggalLabel: dasarLabel, sheets };
}

export async function buatBerkas(prisma, ctx, tab, query, { izinHarga, pengekspor, now = new Date() }) {
  const data = await dokumenEkspor(prisma, ctx, tab, query, { izinHarga });
  const buf = await buatXlsx(data, { pengekspor, bolehSensitif: izinHarga, sekarang: now });
  return { buf, nama: namaBerkas(`Produksi_${tab}`, { from: ctx.periode.from, to: ctx.periode.to }, now) };
}
