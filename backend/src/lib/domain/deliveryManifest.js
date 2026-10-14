// MANIFEST BARANG DELIVERY — SATU sumber untuk "apa yang dibawa stop/job ini".
//
// Masalah nyata (PKR Indra, 14 Okt 2026): kartu stop menampilkan "Kasur • 100 × 200 cm" — label dibentuk dari ringkasan KATEGORI order (produkLineLabel + ukuran di notes),
// bukan dari unit yang benar-benar ditautkan ke job. Stop yang membawa U1/U2/U3 terbaca seperti satu kasur, dan "1 stop" mudah dibaca sebagai jumlah barang.
//
// Aturan:
//   • Sumber utama = unit operasional yang TERTAUT ke job (job.units[].unit) + item PKR-nya (unit.pkrItemUnit.item) bila ada. Ringkasan order hanya cadangan untuk order tanpa item.
//   • Tiga angka dipisah: stop (1 job = 1 stop), unit (jumlah barang fisik), jenis produk (kelompok baris).
//   • Unit identik digabung ("3× …") tetapi daftar unit tetap tersedia; produk berbeda = baris terpisah; set/bundel = komponen fisik (Kasur, Divan, Sandaran).
//   • Tanpa harga/nilai/pembayaran sama sekali — aman untuk Driver, Produksi, dan Gudang.
//   • Unit berstatus CANCELLED tidak ikut (histori tidak dihapus; hanya tidak dibawa).
import { ukuranLabel } from "./pkrItem.js";

const LABEL_BENTUK = { KASUR: "Kasur", SERVICE: "Service/Upgrade", DIVAN: "Divan", SANDARAN: "Sandaran", SET: "Set", CUSTOM: "Produk custom" };
const teks = (v) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Label unit pendek untuk driver: "NEW-11102026-023-U2" → "U2". */
export function labelUnit(unit) {
  const m = /-U(\d+)$/i.exec(teks(unit?.unitCode));
  if (m) return `U${m[1]}`;
  return unit?.seq ? `U${unit.seq}` : teks(unit?.unitCode) || "U?";
}

function ukuranDariItem(item) {
  const label = ukuranLabel({
    bentuk: item.shape, panjang: num(item.lengthCm), lebar: num(item.widthCm), tebal: num(item.thicknessCm), tinggi: num(item.heightCm),
  });
  return label || "";
}

/** Deskriptor satu unit: { kunci, nama, ukuran, spesifikasi, bentuk, jenisKerja, bundel? }. */
function deskriptorUnit(unit, order, ukuranOrder, merkOrder) {
  const item = unit?.pkrItemUnit?.item ?? null;
  if (item) {
    const bundel = item.bundleNo != null ? { no: item.bundleNo, nama: teks(item.bundleName) || `Set ${item.bundleNo}` } : null;
    const adopsi = /^Pesanan awal/i.test(teks(item.categoryName));
    const produk = teks(item.productName);
    const komponen = bundel ? teks(item.categoryName) : "";
    const nama = bundel
      ? [komponen, produk].filter(Boolean).join(" ")
      : (produk || teks(item.categoryName) || LABEL_BENTUK[item.shape] || "Barang");
    const ukuran = ukuranDariItem(item) || (adopsi ? (ukuranOrder || teks(unit.ukuran)) : teks(unit.ukuran));
    const spesifikasi = adopsi ? "" : teks(item.specNotes);
    return { nama, ukuran, spesifikasi, bentuk: item.shape, jenisKerja: item.workKind, bundel };
  }
  // Order tanpa item (order lama / non-PKR): data unit lebih dipercaya daripada ringkasan kategori order.
  const nama = teks(unit?.merk) || teks(merkOrder) || LABEL_BENTUK.KASUR;
  const ukuran = ukuranOrder || teks(unit?.ukuran);
  return { nama, ukuran, spesifikasi: "", bentuk: null, jenisKerja: null, bundel: null };
}

/**
 * Bangun manifest dari job (bentuk hasil Prisma `jobInclude`: job.units[].unit, job.order, unit.order).
 * @param {object} job
 * @param {{ ukuranDariNotes?: (notes:string)=>{ukuranKasur:string, merkKasur:string} }} [alat] fungsi parser notes order (disuntik supaya modul ini murni)
 */
export function bangunManifest(job, alat = {}) {
  const parse = alat.ukuranDariNotes || (() => ({ ukuranKasur: "", merkKasur: "" }));
  const order = job?.order || job?.units?.[0]?.unit?.order || null;
  const info = order?.notes ? parse(order.notes) : { ukuranKasur: "", merkKasur: "" };
  const unitAktif = (job?.units ?? []).map((ju) => ju?.unit).filter((u) => u && u.status !== "CANCELLED")
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || teks(a.unitCode).localeCompare(teks(b.unitCode)));

  const dimuatSet = new Set((job?.unitLoads ?? []).map((l) => l.unitId));
  const kelompok = new Map();
  for (const u of unitAktif) {
    const d = deskriptorUnit(u, u.order || order, info.ukuranKasur, info.merkKasur);
    const kunci = JSON.stringify([d.nama, d.ukuran, d.spesifikasi, d.bundel?.no ?? null]);
    const g = kelompok.get(kunci) ?? { ...d, qty: 0, unit: [] };
    g.qty += 1;
    g.unit.push({ id: u.id, kode: teks(u.unitCode), label: labelUnit(u), status: u.status, dimuat: dimuatSet.has(u.id) });
    kelompok.set(kunci, g);
  }
  const baris = [...kelompok.values()].map((g) => ({
    nama: g.nama, ukuran: g.ukuran, spesifikasi: g.spesifikasi, qty: g.qty, bentuk: g.bentuk, jenisKerja: g.jenisKerja, bundel: g.bundel,
    unit: g.unit, unitLabel: g.unit.map((x) => x.label),
  }));

  const pkr = order?.penjualanKaryawan ?? null;
  const penjual = teks(pkr?.seller?.name);
  // picLead = pemilik lead customer (Customer.assignedSales) — BUKAN penjual transaksi; hanya ditampilkan bila berbeda, dengan label "PIC lead".
  const picLeadRaw = teks(order?.customer?.assignedSales?.name);
  const sumber = pkr
    ? { jenis: "PENJUALAN_KARYAWAN", penjual: penjual || null, picLead: picLeadRaw && picLeadRaw !== penjual ? picLeadRaw : null, label: `Penjualan Karyawan${penjual ? ` — dijual oleh ${penjual}` : ""}` }
    : null;

  // Tambahan pesanan yang BELUM masuk job ini: unit aktif satu order yang tidak tertaut ke job DELIVERY mana pun, selagi job belum berjalan. Hanya SINYAL (kebijakan Owner: unit
  // baru tidak disisipkan diam-diam ke job yang sudah dikomit; masuk lewat aksi eksplisit Kirim Sebagian/Gabung).
  const idJob = new Set(unitAktif.map((u) => u.id));
  const belumMasuk = job?.type === "DELIVERY" && ["UNSCHEDULED", "SCHEDULED", "ASSIGNED"].includes(job?.status)
    ? (order?.units ?? []).filter((u) => u.status !== "CANCELLED" && !idJob.has(u.id) && !(u.jobUnits ?? []).some((ju) => ju?.job?.type === "DELIVERY"))
      .map((u) => ({ kode: teks(u.unitCode), label: labelUnit(u) }))
    : [];
  const totalUnit = unitAktif.length;
  const jenisProduk = baris.length;
  const sudahDimuat = unitAktif.filter((u) => dimuatSet.has(u.id)).length;
  return {
    stop: 1,
    unit: totalUnit,
    jenisProduk,
    ringkas: `1 stop • ${totalUnit} unit • ${jenisProduk} jenis produk`,
    baris,
    sumber,
    tambahanBelumMasuk: belumMasuk,
    // Progres muat: "Barang dimuat 3/3 unit" (unit yang sudah dikonfirmasi dibawa / total unit tertaut).
    muat: { dimuat: sudahDimuat, total: totalUnit, lengkap: totalUnit > 0 && sudahDimuat === totalUnit, label: `Barang dimuat ${sudahDimuat}/${totalUnit} unit` },
  };
}

/** Satu baris teks barang: "3× Kasur Sorong 3in1 custom — 100 × 200 cm" (+ spesifikasi bila ada). */
export function teksBarisManifest(b) {
  const inti = `${b.qty}× ${b.nama}`;
  const rincian = [b.ukuran, b.spesifikasi].filter(Boolean).join(" · ");
  return rincian ? `${inti} — ${rincian}` : inti;
}

/** Blok teks manifest untuk pesan grup/ekspor: ringkas + baris + unit + sumber. */
export function teksManifest(m, { denganRingkas = true } = {}) {
  if (!m) return [];
  const out = [];
  if (denganRingkas) out.push(m.ringkas);
  const adaSet = m.baris.some((b) => b.bundel);
  let set = null;
  for (const b of m.baris) {
    if (b.bundel && (!set || set !== b.bundel.no)) { out.push(`Set ${b.bundel.nama}:`); set = b.bundel.no; }
    if (!b.bundel) set = null;
    out.push(`${b.bundel ? "  " : ""}${teksBarisManifest(b)}`);
    out.push(`${b.bundel ? "  " : ""}Unit: ${b.unitLabel.join(", ")}`);
  }
  if (!m.baris.length && !adaSet) out.push("(belum ada unit tertaut pada job ini)");
  if (m.sumber) out.push(`Sumber: ${m.sumber.label}`);
  if (m.sumber?.picLead) out.push(`PIC lead: ${m.sumber.picLead}`);
  return out;
}

/** Satu baris untuk sel tabel sempit (sheet gambar): "3× Kasur Sorong 3in1 custom — 100 × 200 cm (U1, U2, U3)". */
export function teksSelManifest(m) {
  if (!m || !m.baris.length) return "-";
  return m.baris.map((b) => `${teksBarisManifest(b)} (${b.unitLabel.join(", ")})`).join("; ");
}
