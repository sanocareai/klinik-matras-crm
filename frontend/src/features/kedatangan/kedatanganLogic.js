// Logika murni layar "Barang Akan Datang" + Catat Barang Tiba (tanpa React) — dipakai Gudang dan Finance (satu aturan, dua pintu).
// Angka (dipesan, datang, baik, ditolak, masuk stok, sisa, pendamping) SELALU dari server; di sini hanya pemformatan, isian formulir, dan pemeriksaan dini (server tetap memutuskan).

export const STATUS_AKAN_DATANG = {
  MENUNGGU_KEDATANGAN: { label: "Menunggu Kedatangan", variant: "neutral" },
  DITERIMA_SEBAGIAN: { label: "Diterima Sebagian", variant: "orange" },
  TERLAMBAT: { label: "Terlambat", variant: "red" },
  PERLU_DIPERIKSA: { label: "Perlu Diperiksa", variant: "accent" },
  SIAP_DISIMPAN: { label: "Siap Disimpan", variant: "accent" },
  SELESAI: { label: "Selesai", variant: "green" },
  DIBATALKAN: { label: "Dibatalkan", variant: "red" },
};
export const TAB_AKAN_DATANG = [{ key: "", label: "Semua" }, ...Object.entries(STATUS_AKAN_DATANG).map(([key, v]) => ({ key, label: v.label }))];

export const LABEL_PENERIMAAN = {
  DRAFT: "Draf", SCHEDULED: "Terjadwal", ARRIVED: "Tiba — menunggu pemeriksaan", INSPECTION: "Sedang diperiksa",
  READY_FOR_PUTAWAY: "Siap disimpan", COMPLETED: "Sudah masuk stok", REJECTED: "Ditolak",
};
export const VARIAN_PENERIMAAN = { DRAFT: "neutral", SCHEDULED: "neutral", ARRIVED: "accent", INSPECTION: "accent", READY_FOR_PUTAWAY: "accent", COMPLETED: "green", REJECTED: "red" };
export const LABEL_WORKSPACE = { FINANCE: "Finance", GUDANG: "Gudang" };

export const jumlahTeks = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString("id-ID", { maximumFractionDigits: 3 }) : "—";
};
export const hariIniISO = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
export const tanggalTeks = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
export const waktuTeks = (iso) => (iso ? new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) : "—");

const k3 = (v) => Math.round(Number(v) * 1000);
const tigaDesimal = (v) => Math.abs(Number(v) * 1000 - Math.round(Number(v) * 1000)) <= 1e-6;

/** Teks jumlah pendamping satu item: "1 lembar" / "setara 24 kaleng" / null. */
export function teksPendampingAktual(l) {
  const p = l?.pendamping;
  if (!p) return null;
  const sat = String(p.satuan ?? "").toLowerCase();
  if (p.aktual === null || p.aktual === undefined) return p.mode === "AKTUAL" ? `${sat} belum diisi` : null;
  return `${jumlahTeks(p.aktual)} ${sat}`;
}

// ── Formulir catat barang tiba ───────────────────────────────────────────

/** Isian awal: tiap item PO yang masih boleh datang (sisaDatang > 0); jumlah dikosongkan supaya petugas mengisi angka nyata. */
export function formKedatanganAwal(po, receipt = null) {
  const lines = po.lines
    .filter((l) => (receipt ? receipt.lines.some((x) => x.purchaseOrderLineId === l.id) : Number(l.sisaDatang) > 0))
    .map((l) => ({ purchaseOrderLineId: l.id, kode: l.kode, nama: l.nama, satuan: l.satuan, sisaDatang: Number(l.sisaDatang), dipesan: Number(l.dipesan), pendamping: l.pendamping ? { satuan: l.pendamping.satuan, mode: l.pendamping.mode, rasio: l.pendamping.rasio ?? null } : null, jumlahDatang: "", jumlahPendamping: "" }));
  return { tanggalTiba: hariIniISO(), penerima: "", catatan: "", suratJalan: "", bukti: [], lines };
}

/** Galat dini (null = siap kirim). Aturan sama dengan server: tanggal tidak di masa depan, PIC, catatan, minimal satu jumlah, tidak melebihi sisa. */
export function galatKedatangan(f, { tanggalPO = null } = {}) {
  if (!f.tanggalTiba) return "Isi tanggal barang tiba";
  if (f.tanggalTiba > hariIniISO()) return "Tanggal barang tiba tidak boleh di masa depan";
  if (tanggalPO && f.tanggalTiba < String(tanggalPO).slice(0, 10)) return `Tanggal barang tiba tidak boleh sebelum tanggal PO (${tanggalTeks(tanggalPO)})`;
  if (String(f.penerima).trim().length < 2) return "Isi PIC/penerima barang";
  if (!String(f.catatan).trim()) return "Isi catatan kedatangan (mis. kondisi dus, kekurangan, atau nama pengirim)";
  const terisi = f.lines.filter((l) => l.jumlahDatang !== "" && Number(l.jumlahDatang) !== 0);
  if (terisi.length === 0) return "Isi jumlah datang minimal satu item";
  for (const l of terisi) {
    const n = Number(l.jumlahDatang);
    if (!(n > 0)) return `${l.kode}: jumlah datang harus lebih dari 0`;
    if (!tigaDesimal(n)) return `${l.kode}: jumlah datang maksimal 3 angka di belakang koma`;
    if (k3(n) > k3(l.sisaDatang)) return `${l.kode}: jumlah datang (${jumlahTeks(n)} ${l.satuan}) melebihi sisa PO (${jumlahTeks(l.sisaDatang)} ${l.satuan}). Minta Finance merevisi jumlah PO bila memang dikirim lebih.`;
    if (l.jumlahPendamping !== "" && l.pendamping?.mode === "AKTUAL" && !(Number(l.jumlahPendamping) >= 0)) return `${l.kode}: jumlah ${String(l.pendamping.satuan).toLowerCase()} tidak boleh negatif`;
  }
  return null;
}

/** Kekurangan yang akan terlihat setelah disimpan (surat jalan/bukti opsional): daftar peringatan lunak. */
export function kekuranganIsian(f) {
  const d = [];
  if (!String(f.suratJalan).trim()) d.push("Surat jalan belum diisi");
  if (!f.bukti.length) d.push("Bukti kedatangan belum diunggah");
  for (const l of f.lines.filter((x) => x.jumlahDatang !== "" && Number(x.jumlahDatang) > 0)) {
    if (l.pendamping?.mode === "AKTUAL" && l.jumlahPendamping === "") d.push(`Jumlah ${String(l.pendamping.satuan).toLowerCase()} aktual ${l.kode} belum diisi`);
  }
  return d;
}

export function bodyKedatangan(f, receiptId = null) {
  return {
    ...(receiptId && { receiptId }),
    tanggalTiba: f.tanggalTiba, penerima: f.penerima.trim(), catatan: f.catatan.trim(),
    ...(String(f.suratJalan).trim() && { suratJalan: f.suratJalan.trim() }),
    ...(f.bukti.length && { bukti: f.bukti }),
    lines: f.lines.filter((l) => l.jumlahDatang !== "" && Number(l.jumlahDatang) !== 0).map((l) => ({
      purchaseOrderLineId: l.purchaseOrderLineId, jumlahDatang: Number(l.jumlahDatang),
      ...(l.pendamping?.mode === "AKTUAL" && l.jumlahPendamping !== "" && { jumlahPendamping: Number(l.jumlahPendamping) }),
    })),
  };
}

// ── Formulir koreksi ─────────────────────────────────────────────────────

export function formKoreksiAwal(r) {
  return {
    tanggalTiba: r.tanggalTiba || hariIniISO(), penerima: r.penerima || "", catatan: r.catatan || "", suratJalan: r.suratJalan || "", bukti: [...(r.bukti || [])], alasan: "",
    bolehUbahJumlah: r.status === "ARRIVED",
    lines: r.lines.filter((l) => l.datang !== null && l.datang !== undefined).map((l) => ({ purchaseOrderLineId: l.purchaseOrderLineId, kode: l.kode, satuan: l.satuan, asli: Number(l.datang), jumlahDatang: String(l.datang), pendamping: l.pendamping, jumlahPendamping: l.pendamping?.aktual === null || l.pendamping?.aktual === undefined ? "" : String(l.pendamping.aktual), pendampingAsli: l.pendamping?.aktual ?? null })),
  };
}

/** Hanya field yang BERUBAH dikirim (server menolak "tanpa perubahan"). */
export function bodyKoreksi(f, r) {
  const perubahan = {};
  if (f.tanggalTiba !== r.tanggalTiba) perubahan.tanggalTiba = f.tanggalTiba;
  if (f.penerima.trim() !== (r.penerima || "")) perubahan.penerima = f.penerima.trim();
  if (f.catatan.trim() !== (r.catatan || "")) perubahan.catatan = f.catatan.trim();
  if (f.suratJalan.trim() !== (r.suratJalan || "")) perubahan.suratJalan = f.suratJalan.trim() || null;
  if (JSON.stringify(f.bukti) !== JSON.stringify(r.bukti || [])) perubahan.bukti = f.bukti;
  const lines = [];
  for (const l of f.lines) {
    const o = { purchaseOrderLineId: l.purchaseOrderLineId };
    if (f.bolehUbahJumlah && l.jumlahDatang !== "" && Number(l.jumlahDatang) !== l.asli) o.jumlahDatang = Number(l.jumlahDatang);
    if (l.pendamping?.mode === "AKTUAL" && l.jumlahPendamping !== "" && Number(l.jumlahPendamping) !== l.pendampingAsli) o.jumlahPendamping = Number(l.jumlahPendamping);
    if (Object.keys(o).length > 1) lines.push(o);
  }
  if (lines.length) perubahan.lines = lines;
  return { revisi: r.revisi, alasan: f.alasan.trim(), perubahan };
}

export function galatKoreksi(f, r, { tanggalPO = null } = {}) {
  if (f.alasan.trim().length < 5) return "Alasan koreksi wajib diisi (minimal 5 karakter)";
  const { perubahan } = bodyKoreksi(f, r);
  if (Object.keys(perubahan).length === 0) return "Belum ada yang diubah";
  if (f.tanggalTiba > hariIniISO()) return "Tanggal barang tiba tidak boleh di masa depan";
  if (tanggalPO && f.tanggalTiba < String(tanggalPO).slice(0, 10)) return `Tanggal barang tiba tidak boleh sebelum tanggal PO (${tanggalTeks(tanggalPO)})`;
  if (String(f.penerima).trim().length < 2) return "PIC/penerima wajib diisi";
  if (!String(f.catatan).trim()) return "Catatan kedatangan wajib diisi";
  return null;
}

/** Kalimat riwayat satu kejadian kedatangan (sebelum–sesudah). */
export function kalimatRiwayat(e) {
  const dari = LABEL_WORKSPACE[e.workspace] ?? e.workspace ?? "";
  if (e.jenis === "KEDATANGAN_DICATAT") return `${e.oleh ?? "Sistem"}${dari ? ` (${dari})` : ""} mencatat barang tiba${e.sesudah?.tanggalTiba ? ` pada ${tanggalTeks(e.sesudah.tanggalTiba)}` : ""}`;
  const ubah = [];
  const s = e.sebelum ?? {}; const t = e.sesudah ?? {};
  if (t.tanggalTiba !== undefined) ubah.push(`tanggal tiba ${tanggalTeks(s.tanggalTiba)} → ${tanggalTeks(t.tanggalTiba)}`);
  if (t.penerima !== undefined) ubah.push(`PIC ${s.penerima || "—"} → ${t.penerima || "—"}`);
  if (t.catatan !== undefined) ubah.push("catatan diubah");
  if (t.suratJalan !== undefined) ubah.push(`surat jalan ${s.suratJalan || "—"} → ${t.suratJalan || "—"}`);
  if (t.bukti !== undefined) ubah.push("bukti diubah");
  for (const b of t.lines ?? []) {
    const a = (s.lines ?? []).find((x) => x.purchaseOrderLineId === b.purchaseOrderLineId);
    if (a && b.datang !== a.datang) ubah.push(`${b.kode}: datang ${jumlahTeks(a.datang)} → ${jumlahTeks(b.datang)}`);
    else if (a && b.pendamping !== a.pendamping) ubah.push(`${b.kode}: pendamping ${a.pendamping ?? "—"} → ${b.pendamping ?? "—"}`);
  }
  return `${e.oleh ?? "Sistem"}${dari ? ` (${dari})` : ""} mengoreksi kedatangan — ${ubah.join("; ") || "data"}. Alasan: ${e.alasan}`;
}

/** Ringkas jumlah pada daftar: "datang 5 / 10 KG" untuk PO satu satuan; selain itu hitungan item. */
export function ringkasKuantitas(po) {
  const satuan = new Set(po.lines.map((l) => l.satuan));
  if (satuan.size !== 1) return { teks: `${po.lines.filter((l) => l.sisa <= 0).length}/${po.lines.length} item terpenuhi`, persen: 0 };
  const dipesan = po.lines.reduce((s, l) => s + l.dipesan, 0);
  const masuk = po.lines.reduce((s, l) => s + Math.min(l.masukStok, l.dipesan), 0);
  const datang = po.lines.reduce((s, l) => s + Math.min(l.datang, l.dipesan), 0);
  return { teks: `${jumlahTeks(datang)} datang · ${jumlahTeks(masuk)} masuk stok / ${jumlahTeks(dipesan)} ${[...satuan][0]}`, persen: dipesan > 0 ? Math.min(100, Math.round((masuk / dipesan) * 100)) : 0 };
}

// ── Pendamping pada formulir PO ──────────────────────────────────────────

export const MODE_PENDAMPING_OPSI = [
  { key: "AKTUAL", label: "Jumlah aktual (tanpa rasio tetap)", hint: "Mis. busa 10 KG, perkiraan 2 lembar. 1 lembar tidak dianggap berat tetap; jumlah lembar dicatat saat barang tiba." },
  { key: "TETAP", label: "Konversi tetap", hint: "Mis. 1 DUS = 12 KALENG. Jumlah pendamping dihitung otomatis dari jumlah yang datang." },
];
export const pendamping0 = () => ({ satuan: "", mode: "", rasio: "", estimasi: "" });
export const adaPendamping = (p) => !!p && (String(p.satuan ?? "").trim() !== "" || !!p.mode || (p.rasio !== "" && p.rasio != null) || (p.estimasi !== "" && p.estimasi != null));

export function galatPendamping(p, { adaKonversi = false } = {}) {
  if (!adaPendamping(p)) return null;
  if (adaKonversi) return "Jumlah fisik pendamping tidak bisa digabung dengan konversi satuan beli → stok. Pilih salah satu.";
  if (!String(p.satuan).trim()) return "Isi satuan pendamping (mis. LEMBAR)";
  if (String(p.satuan).trim().length > 20) return "Satuan pendamping maksimal 20 karakter";
  if (!p.mode) return "Pilih mode pendamping";
  if (p.mode === "TETAP") { const r = Number(p.rasio); if (!(r > 0)) return "Isi rasio konversi tetap (mis. 1 DUS = 12 KALENG → 12)"; }
  if (p.mode === "AKTUAL" && p.estimasi !== "" && p.estimasi != null) { const e = Number(p.estimasi); if (!(e >= 0) || !tigaDesimal(e)) return "Perkiraan pendamping harus angka ≥ 0, maksimal 3 desimal"; }
  return null;
}

export function bodyPendamping(p) {
  if (!adaPendamping(p)) return undefined;
  return { satuan: String(p.satuan).trim(), mode: p.mode, ...(p.mode === "TETAP" && { rasio: Number(p.rasio) }), ...(p.mode === "AKTUAL" && p.estimasi !== "" && p.estimasi != null && { estimasi: Number(p.estimasi) }) };
}

export function pendampingDariPO(l) {
  const p = l.pendamping;
  if (!p) return pendamping0();
  return { satuan: p.satuan, mode: p.mode, rasio: p.mode === "TETAP" ? String(p.rasio) : "", estimasi: p.mode === "AKTUAL" && p.estimasi != null ? String(p.estimasi) : "" };
}

/** Pratinjau teks pendamping pada formulir PO. */
export function teksPratinjauPendamping(p, qty, satuanUtama) {
  if (!adaPendamping(p) || galatPendamping(p)) return null;
  const sat = String(p.satuan).trim().toLowerCase();
  const dasar = `${jumlahTeks(qty || 0)} ${satuanUtama ?? ""}`.trim();
  if (p.mode === "TETAP") return `${dasar} — setara ${jumlahTeks((Number(qty) || 0) * Number(p.rasio))} ${sat}`;
  return p.estimasi !== "" && p.estimasi != null ? `${dasar} — perkiraan ${jumlahTeks(p.estimasi)} ${sat}` : `${dasar} — jumlah ${sat} dicatat saat barang tiba`;
}
