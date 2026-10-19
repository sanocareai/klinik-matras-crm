// Logika murni Pusat Kerja Gudang (UX Gudang Tahap 4): ke mana sebuah item/hasil pencarian dibuka. Dipakai Beranda, Perlu Perhatian, dan pencarian; diuji dengan node --test.

/** Jenis dokumen yang punya JENDELA FOKUS di atas Beranda / Perlu Perhatian (rute /<halaman>/:jenis/:id). */
export const JENIS_FOKUS = Object.freeze(["penerimaan", "po", "pengeluaran-material", "transfer", "opname", "restok", "rusak", "retur", "penyesuaian", "koreksi"]);
export const bisaFokus = (jenis) => JENIS_FOKUS.includes(jenis);

/**
 * URL tujuan sebuah item. `basePath` = halaman tempat jendela dibuka (mis. "/warehouse/dashboard").
 *  - jenis ber-jendela: `${basePath}/${jenis}/${id}` (+ `?aksi=KODE` bila tombol tindakan ditekan; aksi hanya dibuka/disorot di dokumen, tidak dijalankan di sini);
 *  - Retur Supplier: rute daftarnya sendiri (/warehouse/retur-supplier/:id);
 *  - selain itu: tautan dari server (daftar pemilik) atau null.
 */
export function urlItem(basePath, item, kodeAksi = null) {
  if (!item) return null;
  if (bisaFokus(item.jenis) && item.id) return `${basePath}/${item.jenis}/${item.id}${kodeAksi ? `?aksi=${encodeURIComponent(kodeAksi)}` : ""}`;
  if (item.jenis === "retur-supplier" && item.id) return `/warehouse/retur-supplier/${item.id}`;
  return item.tautan || null;
}

/** Tautan di dalam halaman yang sama (jendela fokus) mendorong riwayat satu langkah; selainnya pindah halaman biasa. */
export const dalamHalaman = (basePath, url) => typeof url === "string" && url.startsWith(`${basePath}/`);

export const LABEL_CAKUPAN = Object.freeze({ BAHAN: "Satu/beberapa bahan", DOKUMEN: "Satu dokumen", FITUR: "Satu fitur", PROSES: "Seluruh proses" });
export const WARNA_CAKUPAN = Object.freeze({ PROSES: "red", DOKUMEN: "orange", BAHAN: "accent", FITUR: "neutral" });
export const WARNA_PEMILIK = Object.freeze({ GUDANG: "accent", FINANCE: "orange", PRODUKSI: "neutral", OWNER: "red" });

/** Baris definisi antrean untuk tombol "Definisi" (apa yang dihitung, dari tabel mana, kapan masuk/keluar, siapa yang boleh bertindak). */
export function barisDefinisi(d) {
  if (!d) return [];
  return [["Sumber data", d.tabel], ["Masuk antrean bila", d.masuk], ["Keluar antrean bila", d.keluar], ["Yang boleh bertindak", d.pemilik], ["Dihitung per", d.satuan], ["Catatan", d.catatan]].filter(([, v]) => v);
}
