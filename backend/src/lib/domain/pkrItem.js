// ITEM PRODUKSI PENJUALAN KARYAWAN (multi-item) — fungsi MURNI (tanpa DB) supaya aturan yang sama dipakai backend, gerbang Produksi, pratinjau, dan tes.
//
// Satu PKR -> satu Order CRM -> BANYAK item (kasur + divan + sandaran, dst). Tiap item punya kategori (dari katalog yang dikelola Admin), produk/varian, jumlah, ukuran yang RELEVAN
// untuk bentuknya, spesifikasi, dan "dikirim atau diambil". Katalog menyimpan baris (kategori & produk) sebagai DATA; yang tetap di kode hanya HIMPUNAN FIELD per bentuk (BENTUK) —
// itu aturan bisnis ("divan butuh ukuran + tipe"), bukan daftar produk. Frontend membaca BENTUK dari server (GET katalog-item) sehingga layar tidak punya salinan sendiri.
//
// Status "lengkap" dihitung dari isi (bukan kolom) — sama dengan pola pkrSpesifikasi.js. Isi item dicerminkan ke Order.notes.pkrItems (denormalisasi dalam transaksi yang sama)
// supaya SEMUA gerbang Produksi yang sudah membaca Order.notes (Rencana, mulai tahap, backlog) langsung memakai kelengkapan berbasis item tanpa perubahan select.

export const JENIS_KERJA = Object.freeze({ BARU: "BARU", LAYANAN: "LAYANAN" });
export const MAKS_ITEM = 20;
export const MAKS_UNIT_ORDER = 20; // sama dengan batas lama jumlah unit satu order PKR
export const MAKS_DIMENSI_CM = 1000;
export const SPEK_MIN_CUSTOM = 5;
export const SPEK_MAKS = 1000;
export const PRODUK_MAKS = 160;

const DIM = Object.freeze({
  panjang: { key: "panjang", label: "Panjang", satuan: "cm" },
  lebar: { key: "lebar", label: "Lebar", satuan: "cm" },
  tebal: { key: "tebal", label: "Tebal", satuan: "cm" },
  tinggi: { key: "tinggi", label: "Tinggi", satuan: "cm" },
});
const dim = (key, wajib) => ({ ...DIM[key], wajib });

/**
 * Himpunan field kontekstual per bentuk. `produk.wajib` = produk/varian (atau nama bebas) harus terisi untuk dianggap lengkap.
 * `spesifikasi.keras` = TIDAK boleh kosong saat input (galat 400), bukan sekadar "perlu dilengkapi" — hanya Produk Custom.
 */
export const BENTUK = Object.freeze({
  KASUR: {
    label: "Kasur", produk: { label: "Produk / merk", wajib: true },
    dimensi: [dim("panjang", true), dim("lebar", true), dim("tebal", true)],
    spesifikasi: { label: "Spesifikasi / catatan", keras: false, hint: "mis. kekerasan, lapisan, kain" },
  },
  SERVICE: {
    label: "Service / upgrade kasur", produk: { label: "Layanan", wajib: true },
    dimensi: [dim("panjang", true), dim("lebar", true), dim("tebal", false)],
    spesifikasi: { label: "Keluhan / catatan pekerjaan", keras: false, hint: "mis. kempes di bagian tengah, ganti kain" },
  },
  DIVAN: {
    label: "Divan / box", produk: { label: "Tipe divan", wajib: true },
    dimensi: [dim("panjang", true), dim("lebar", true), dim("tinggi", false)],
    spesifikasi: { label: "Spesifikasi / catatan", keras: false, hint: "mis. warna, laci, bahan" },
  },
  SANDARAN: {
    label: "Sandaran / headboard", produk: { label: "Model", wajib: false },
    dimensi: [dim("lebar", true), dim("tinggi", true), dim("tebal", false)],
    spesifikasi: { label: "Spesifikasi / catatan", keras: false, hint: "mis. bahan, warna, bentuk" },
  },
  // BUNDEL: bukan item operasional. Dipecah saat order dibuat menjadi komponen (Kasur, Divan, Sandaran, … sesuai komposisi katalog yang diatur Admin); tiap komponen memakai
  // bentuk kategorinya sendiri (kasur P×L×T, divan ukuran + tipe, sandaran L×T). Baris `pkr_order_items` tidak pernah berbentuk SET.
  SET: {
    label: "Set kasur lengkap (bundel)", produk: { label: "Paket / set", wajib: false }, bundel: true,
    dimensi: [],
    spesifikasi: { label: "Catatan set", keras: false, hint: "mis. warna seragam, urutan pengerjaan" },
  },
  CUSTOM: {
    label: "Produk custom", produk: { label: "Nama produk", wajib: false },
    dimensi: [dim("panjang", false), dim("lebar", false), dim("tebal", false), dim("tinggi", false)],
    spesifikasi: { label: "Spesifikasi produk custom", keras: true, hint: "Wajib: jelaskan bentuk, ukuran, bahan" },
  },
});
export const BENTUK_KODE = Object.freeze(Object.keys(BENTUK));

export class ItemPkrError extends Error {
  constructor(message, code = "ITEM_PKR_TIDAK_VALID", extra = null) { super(message); this.name = "ItemPkrError"; this.statusCode = 400; this.code = code; if (extra) this.extra = extra; }
}
const gagal = (m, code, extra) => new ItemPkrError(m, code, extra);

const teksAtauNull = (v, maks, nama) => {
  if (v === undefined || v === null) return null;
  const t = String(v).trim().replace(/\s+/g, " ");
  if (t === "") return null;
  if (t.length > maks) throw gagal(`${nama} maksimal ${maks} karakter`);
  return t;
};

/** Angka cm: boleh koma/titik, > 0, maks 1 desimal (kolom DECIMAL(7,1)), maks 1000. null bila kosong. */
export function angkaCm(v, nama) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const t = String(v).trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw gagal(`${nama} harus berupa angka dalam cm`);
  const n = Math.round(Number(t) * 10) / 10;
  if (!(n > 0)) throw gagal(`${nama} harus lebih dari 0`);
  if (n > MAKS_DIMENSI_CM) throw gagal(`${nama} maksimal ${MAKS_DIMENSI_CM} cm`);
  return n;
}

/** true / false / null. Menerima boolean, "ya"/"tidak", "true"/"false", "" (= belum ditentukan). */
export function pilihanKirim(v) {
  if (v === undefined || v === null || v === "") return null;
  if (v === true || v === "ya" || v === "true") return true;
  if (v === false || v === "tidak" || v === "false") return false;
  throw gagal("Pilihan dikirim atau diambil sendiri tidak valid");
}

/**
 * Normalisasi SATU item mentah. `kategori` = baris katalog { id, code, name, shape, workKind }; `produk` = baris katalog atau null.
 * Galat keras dilempar (bentuk/angka tidak valid, custom tanpa spesifikasi); data yang belum diisi dikembalikan di `kurang` (order "Perlu dilengkapi").
 */
export function normalisasiItem(raw, { kategori, produk = null, no }) {
  const awal = `Item ${no}: `;
  const bungkus = (fn) => { try { return fn(); } catch (e) { if (e instanceof ItemPkrError) throw gagal(awal + e.message, e.code); throw e; } };
  const bentuk = BENTUK[kategori.shape];
  if (!bentuk) throw gagal(`${awal}bentuk kategori "${kategori.name}" tidak dikenal`, "BENTUK_TIDAK_DIKENAL");

  const n = bungkus(() => {
    const q = raw.jumlah === undefined || raw.jumlah === null || raw.jumlah === "" ? 1 : Number(raw.jumlah);
    if (!Number.isInteger(q) || q < 1 || q > MAKS_UNIT_ORDER) throw gagal(`Jumlah harus bilangan bulat 1–${MAKS_UNIT_ORDER}`);
    const dimensi = {};
    for (const d of Object.keys(DIM)) {
      const nilai = angkaCm(raw[d], DIM[d].label);
      if (nilai !== null && !bentuk.dimensi.some((x) => x.key === d)) throw gagal(`${DIM[d].label} tidak dipakai untuk ${bentuk.label.toLowerCase()}`);
      dimensi[d] = nilai;
    }
    const spesifikasi = teksAtauNull(raw.spesifikasi, SPEK_MAKS, "Spesifikasi");
    if (bentuk.spesifikasi.keras && (!spesifikasi || spesifikasi.length < SPEK_MIN_CUSTOM)) {
      throw gagal(`Produk custom wajib diisi spesifikasi (minimal ${SPEK_MIN_CUSTOM} karakter)`, "SPESIFIKASI_CUSTOM_WAJIB");
    }
    const produkNama = produk ? produk.name : teksAtauNull(raw.produkNama, PRODUK_MAKS, "Nama produk");
    return { jumlah: q, ...dimensi, spesifikasi, produkNama, perluDikirim: pilihanKirim(raw.perluDikirim) };
  });

  const item = {
    no, kategoriId: kategori.id, kategoriCode: kategori.code, kategoriNama: kategori.name, bentuk: kategori.shape, jenisKerja: kategori.workKind,
    produkId: produk?.id ?? null, productionServiceId: produk?.productionServiceId ?? null, ...n,
  };
  item.kurang = kurangItem(item);
  item.ukuranLabel = ukuranLabel(item);
  return item;
}

/** Nama field yang masih kosong untuk item ini (tanpa awalan "Item N"). */
export function kurangItem(item) {
  const bentuk = BENTUK[item.bentuk];
  if (!bentuk) return [];
  const kurang = [];
  if (bentuk.produk.wajib && !item.produkNama) kurang.push(bentuk.produk.label);
  for (const d of bentuk.dimensi) if (d.wajib && !(Number(item[d.key]) > 0)) kurang.push(d.label);
  if (item.perluDikirim === null || item.perluDikirim === undefined) kurang.push("Dikirim atau diambil sendiri");
  return kurang;
}

const angka = (n) => String(Number(n)).replace(".", ",");

/** Ukuran siap tampil per bentuk, mis. "200 × 160 × 20 cm", "160 × 200 cm · tinggi 30 cm", "lebar 160 × tinggi 120 cm". "" bila belum ada angka. */
export function ukuranLabel(item) {
  const ada = (k) => Number(item[k]) > 0;
  switch (item.bentuk) {
    case "DIVAN": {
      const dasar = [item.panjang, item.lebar].filter((v) => Number(v) > 0).map(angka).join(" × ");
      return dasar ? `${dasar} cm${ada("tinggi") ? ` · tinggi ${angka(item.tinggi)} cm` : ""}` : (ada("tinggi") ? `tinggi ${angka(item.tinggi)} cm` : "");
    }
    case "SANDARAN": {
      const bagian = [ada("lebar") && `lebar ${angka(item.lebar)}`, ada("tinggi") && `tinggi ${angka(item.tinggi)}`, ada("tebal") && `tebal ${angka(item.tebal)}`].filter(Boolean);
      return bagian.length ? `${bagian.join(" × ")} cm` : "";
    }
    default: {
      const urut = item.bentuk === "CUSTOM" ? ["panjang", "lebar", "tebal", "tinggi"] : ["panjang", "lebar", "tebal"];
      const bagian = urut.filter(ada).map((k) => angka(item[k]));
      return bagian.length ? `${bagian.join(" × ")} cm` : "";
    }
  }
}

/** Deskripsi unit yang dilahirkan item: merk = produk (atau nama kategori), ukuran = label ukuran. */
export function deskripsiUnit(item) {
  return { merk: item.produkNama || item.kategoriNama, ukuran: item.ukuranLabel || ukuranLabel(item) || null };
}

/** Kunci perbandingan duplikat: dua item dengan kunci sama persis = kemungkinan salah ketik (gabungkan lewat Jumlah). Jumlah sengaja tidak ikut. */
export function kunciDuplikat(item) {
  return JSON.stringify([
    item.kategoriCode, item.produkId ?? String(item.produkNama || "").toLowerCase(),
    item.panjang ?? null, item.lebar ?? null, item.tebal ?? null, item.tinggi ?? null,
    String(item.spesifikasi || "").toLowerCase(), item.perluDikirim ?? null, item.bundleNo != null ? "set" : "",
  ]);
}

/**
 * Validasi himpunan item: tidak kosong, maks MAKS_ITEM, total unit <= MAKS_UNIT_ORDER, tidak ada duplikat persis. Melempar ItemPkrError.
 * @returns {{ totalUnit: number }}
 */
export function validasiHimpunan(items) {
  if (!Array.isArray(items) || items.length === 0) throw gagal("Tambahkan minimal satu item produksi", "ITEM_KOSONG");
  if (items.length > MAKS_ITEM) throw gagal(`Maksimal ${MAKS_ITEM} item produksi per penjualan`, "ITEM_TERLALU_BANYAK");
  const total = items.reduce((a, i) => a + i.jumlah, 0);
  if (total > MAKS_UNIT_ORDER) throw gagal(`Total jumlah unit ${total} melebihi batas ${MAKS_UNIT_ORDER} per order`, "UNIT_TERLALU_BANYAK");
  const lihat = new Map();
  for (const i of items) {
    const k = kunciDuplikat(i);
    if (lihat.has(k)) {
      const bundel = i.bundleNo != null;
      throw gagal(bundel
        ? `Item ${i.no} (komponen Set ${i.bundleNo}) sama persis dengan Item ${lihat.get(k)} — gabungkan lewat kolom Jumlah pada Set supaya tidak tercatat ganda`
        : `Item ${i.no} sama persis dengan Item ${lihat.get(k)} — gabungkan lewat kolom Jumlah supaya tidak tercatat ganda`, "ITEM_DUPLIKAT", { item: i.no, sama: lihat.get(k) });
    }
    lihat.set(k, i.no);
  }
  return { totalUnit: total };
}

/**
 * Kategori order (OrderCategory) turunan (keputusan Owner): semua LAYANAN -> LAYANAN; semua BARU -> BARU; campuran -> CAMPURAN. Order campuran TIDAK diubah menjadi LAYANAN:
 * rute, kelengkapan, dan status tiap unit dihitung menurut itemnya sendiri (Unit.workCategory).
 */
export function kategoriOrderDariItems(items) {
  const layanan = items.filter((i) => i.jenisKerja === JENIS_KERJA.LAYANAN).length;
  if (layanan === 0) return "BARU";
  return layanan === items.length ? "LAYANAN" : "CAMPURAN";
}

/** Nilai Order.pkrPerluDikirim turunan: ada yang dikirim -> true; semuanya diambil -> false; selain itu belum ditentukan (null). */
export function perluDikirimDariItems(items) {
  if (!items.length) return null;
  if (items.some((i) => i.perluDikirim === true)) return true;
  if (items.every((i) => i.perluDikirim === false)) return false;
  return null;
}

/** Peringatan yang tidak memblokir (ditampilkan di pratinjau). */
export function peringatanHimpunan(items) {
  const w = [];
  const layanan = items.filter((i) => i.jenisKerja === JENIS_KERJA.LAYANAN);
  const baru = items.filter((i) => i.jenisKerja === JENIS_KERJA.BARU);
  if (layanan.length && baru.length) {
    w.push({
      kode: "CAMPURAN_PER_ITEM",
      pesan: "Order ini CAMPURAN: Service/Upgrade (barang lama diambil dulu) dan produk baru. Tiap item berjalan sendiri — item produk baru langsung di workshop tanpa menunggu pengambilan item service; Delivery menunggu seluruh unit yang dikirim siap lalu membuat SATU job.",
    });
  }
  return w;
}

// ── Cerminan di Order.notes (pkrItems) ─────────────────────────────────────────────────────────────────

/** Bentuk ringkas yang disimpan di Order.notes.pkrItems. Dibaca kembali oleh bacaItemsDariNotes. */
export function cerminanItem(i) {
  return {
    no: i.no, kategori: i.kategoriCode, kategoriNama: i.kategoriNama, bentuk: i.bentuk, jenisKerja: i.jenisKerja, produk: i.produkNama ?? null, jumlah: i.jumlah,
    panjang: i.panjang ?? null, lebar: i.lebar ?? null, tebal: i.tebal ?? null, tinggi: i.tinggi ?? null, spesifikasi: i.spesifikasi ?? null, kirim: i.perluDikirim ?? null,
    ...(i.bundleNo != null && { bundel: i.bundleNo }),
  };
}

/** Item dari Order.notes (cerminan). null bila order tidak memakai multi-item. Tidak pernah melempar. */
export function bacaItemsDariNotes(notes) {
  let info = null;
  if (notes && typeof notes === "string") { try { info = JSON.parse(notes); } catch { info = null; } }
  const arr = info && typeof info === "object" ? info.pkrItems : null;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr.map((m, idx) => {
    const item = {
      no: Number(m.no) || idx + 1, kategoriCode: m.kategori ?? null, kategoriNama: m.kategoriNama ?? m.kategori ?? "Item", bentuk: m.bentuk ?? "CUSTOM", jenisKerja: m.jenisKerja ?? "BARU",
      produkNama: m.produk ?? null, jumlah: Number(m.jumlah) || 1, panjang: m.panjang ?? null, lebar: m.lebar ?? null, tebal: m.tebal ?? null, tinggi: m.tinggi ?? null,
      spesifikasi: m.spesifikasi ?? null, perluDikirim: m.kirim === true ? true : m.kirim === false ? false : null,
      bundleNo: Number.isInteger(m.bundel) ? m.bundel : null,
    };
    item.kurang = kurangItem(item);
    item.ukuranLabel = ukuranLabel(item);
    return item;
  });
}

/** Ringkasan kelengkapan untuk gerbang Produksi: { lengkap, kurang[], perluDikirim } dari himpunan item + ada/tidaknya alamat. */
export function kelengkapanItems(items, { alamat = null } = {}) {
  const kurang = [];
  const banyak = items.length > 1;
  for (const i of items) {
    const awal = banyak ? `Item ${i.no} (${i.produkNama || i.kategoriNama}): ` : "";
    for (const k of i.kurang ?? kurangItem(i)) kurang.push(`${awal}${k}`);
  }
  const perluDikirim = perluDikirimDariItems(items);
  if (items.some((i) => i.perluDikirim === true) && !alamat) kurang.push("Alamat pengiriman");
  return { lengkap: kurang.length === 0, kurang, perluDikirim };
}

/**
 * Kelengkapan SATU item (kelengkapan kontekstual per kategori). Alamat pengiriman hanya dituntut bila item ini dikirim. Dipakai gerbang Produksi per UNIT:
 * item yang belum lengkap tidak menahan unit milik item lain yang sudah lengkap.
 */
export function kelengkapanItem(items, no, { alamat = null } = {}) {
  const item = (items || []).find((i) => i.no === no);
  if (!item) return null;
  const awal = (items || []).length > 1 ? `Item ${item.no} (${item.produkNama || item.kategoriNama}): ` : "";
  const kurang = (item.kurang ?? kurangItem(item)).map((k) => `${awal}${k}`);
  if (item.perluDikirim === true && !alamat) kurang.push(`${awal}Alamat pengiriman`);
  return { lengkap: kurang.length === 0, kurang, perluDikirim: item.perluDikirim ?? null };
}

// ── Bundel katalog (Set Kasur Lengkap) ─────────────────────────────────────────────────────────────

/**
 * Pecah SATU masukan bundel menjadi masukan item komponen sesuai komposisi katalog.
 * @param {object} raw  { jumlah (jumlah set), perluDikirim, spesifikasi, komponen?: [{ produkId, produkNama, panjang, lebar, tebal, tinggi, spesifikasi, perluDikirim }] }
 *                      `komponen[i]` bersesuaian dengan komposisi[i] (urutan yang sama seperti ditampilkan katalog). Dihilangkan = semua komponen kosong ("perlu dilengkapi").
 * @param {{kategoriId:string, kategoriCode:string, produkId:string|null, qty:number}[]} komposisi komposisi aktif (urut)
 * @returns {object[]} masukan item mentah per komponen (siap siapkanItems), membawa __bundel { kode, nama, jumlah }
 */
export function pecahBundel(raw, komposisi, { nama = null, kode = null } = {}) {
  if (!Array.isArray(komposisi) || komposisi.length === 0) {
    throw gagal(`Set "${nama || kode || "?"}" belum punya komposisi komponen. Minta Admin mengisinya di Katalog Item PKR.`, "BUNDEL_TANPA_KOMPOSISI");
  }
  const q = raw.jumlah === undefined || raw.jumlah === null || raw.jumlah === "" ? 1 : Number(raw.jumlah);
  if (!Number.isInteger(q) || q < 1 || q > MAKS_UNIT_ORDER) throw gagal(`Jumlah set harus bilangan bulat 1–${MAKS_UNIT_ORDER}`);
  const masuk = raw.komponen;
  if (masuk !== undefined && masuk !== null) {
    if (!Array.isArray(masuk) || masuk.length !== komposisi.length) {
      throw gagal(`Set ini terdiri dari ${komposisi.length} komponen; isian komponen yang dikirim tidak sesuai komposisi katalog. Muat ulang katalog lalu isi ulang.`, "KOMPONEN_BUNDEL_TIDAK_SESUAI");
    }
  }
  return komposisi.map((k, idx) => {
    const m = (masuk && masuk[idx]) || {};
    if (m.kategori && m.kategori !== k.kategoriCode) {
      throw gagal(`Komponen ${idx + 1} seharusnya kategori ${k.kategoriCode}, bukan ${m.kategori}. Muat ulang katalog lalu isi ulang.`, "KOMPONEN_BUNDEL_TIDAK_SESUAI");
    }
    return {
      kategoriId: k.kategoriId, kategori: k.kategoriCode,
      produkId: m.produkId ?? k.produkId ?? undefined, produkNama: m.produkNama,
      jumlah: k.qty * q,
      panjang: m.panjang, lebar: m.lebar, tebal: m.tebal, tinggi: m.tinggi,
      spesifikasi: m.spesifikasi ?? raw.spesifikasi,
      perluDikirim: m.perluDikirim !== undefined && m.perluDikirim !== null && m.perluDikirim !== "" ? m.perluDikirim : raw.perluDikirim,
      __bundel: { kode, nama, jumlah: q },
    };
  });
}

// ── Pemetaan rute Produksi ──────────────────────────────────────────────────────────────────────────

const ALUR_LABEL = Object.freeze({ KASUR: "Alur kasur (uji tekstur & berat badan)", NON_KASUR: "Alur non-kasur (divan/sofa, tanpa uji kasur)" });

/**
 * Pemetaan rute Produksi untuk SATU item: produk menimpa kategori. BARU -> jenis produk (productLine/productType) harus membentuk alur yang jelas; LAYANAN -> layanan produksi harus ada.
 * Tidak pernah menebak: tanpa pemetaan hasilnya ok:false + pesan Indonesia + arah tindakan.
 * @param {{ kategori: {code,name,productLine,productType,productionServiceId}, produk?: {id,name,productLine,productType,productionServiceId}|null, jenisKerja: "BARU"|"LAYANAN" }} x
 * @param {(a:{productLine:string|null,productType:string|null})=>{flow:string,family:string|null,problem:string|null}} klasifikasi  classifyProduct (diinjeksi agar modul ini murni)
 */
export function pemetaanRute({ kategori, produk = null, jenisKerja }, klasifikasi) {
  const line = produk?.productLine ?? kategori.productLine ?? null;
  const type = produk?.productType ?? kategori.productType ?? null;
  const serviceId = produk?.productionServiceId ?? kategori.productionServiceId ?? null;
  const sumber = produk ? `produk "${produk.name}"` : `kategori "${kategori.name}"`;
  const arah = "Buka Pengaturan Produksi › Katalog Item PKR, petakan rute Produksinya, lalu buat ulang pratinjau.";
  if (jenisKerja === JENIS_KERJA.LAYANAN) {
    if (!serviceId) return { ok: false, kode: "RUTE_LAYANAN_BELUM_DIPETAKAN", pesan: `Rute Produksi belum dipetakan untuk ${sumber}: layanan produksinya (Service/Upgrade) belum dipilih. ${arah}`, productLine: line, productType: type, serviceId: null };
    return { ok: true, productLine: line, productType: type, serviceId, alur: null };
  }
  const k = klasifikasi({ productLine: line, productType: type });
  if (k.flow === "UNCONFIRMED") {
    // Rincian yang bisa ditindaklanjuti Admin (bukan teks klasifikasi untuk Sales di order).
    const rincian = !line && !type ? "lini dan jenis produk belum dipilih"
      : line === "KASUR" && !type ? "jenis kasur belum dipilih (lini Kasur saja belum cukup untuk menentukan alur)"
        : line && type ? `lini ${line} tidak sesuai jenis produk ${type}` : "jenis produk belum jelas";
    return {
      ok: false, kode: "RUTE_PRODUK_BELUM_DIPETAKAN", productLine: line, productType: type, serviceId: null,
      pesan: `Rute Produksi belum dipetakan untuk ${sumber}: ${rincian}. ${arah}`,
    };
  }
  return { ok: true, productLine: line, productType: type, serviceId: null, alur: k.flow, alurLabel: ALUR_LABEL[k.flow] ?? k.flow, family: k.family };
}

/** Item virtual untuk order PKR LAMA (tanpa baris pkr_order_items): dibentuk dari kategori/merk/ukuran/jumlah unit yang sudah ada. Hanya untuk tampilan; tidak disimpan. */
export function itemVirtualLama({ kategori, merk, ukuran, jumlahUnit, perluDikirim }) {
  const layanan = kategori === "LAYANAN";
  return [{
    no: 1, kategoriCode: layanan ? "SERVICE_UPGRADE" : "KASUR_BARU", kategoriNama: layanan ? "Service/Upgrade Kasur" : "Kasur Baru", bentuk: layanan ? "SERVICE" : "KASUR",
    jenisKerja: layanan ? "LAYANAN" : "BARU", produkNama: merk ?? null, jumlah: Math.max(1, Number(jumlahUnit) || 1), panjang: null, lebar: null, tebal: null, tinggi: null,
    spesifikasi: null, perluDikirim: perluDikirim ?? null, ukuranLabel: ukuran ?? "", kurang: [], virtual: true,
  }];
}
