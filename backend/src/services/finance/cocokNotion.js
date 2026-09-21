// PENCOCOKAN LANJUTAN arsip Notion ("Pembayaran <nama>") ↔ order sistem. MURNI (tanpa database, tanpa efek samping).
//
// Tujuan: audit dedup/double counting, BUKAN mengubah data. Hasil hanya laporan. Tidak ada keluaran yang boleh dipakai untuk mengubah produksi.
// Kepercayaan:
//   TINGGI  — nama cocok kuat + nominal cocok TEPAT (order penuh / kombinasi cicilan / satu pembayaran untuk beberapa order) + tanggal dalam jendela + penjelasan UNIK.
//   SEDANG  — nominal cocok tetapi ada lebih dari satu penjelasan, tanggal di luar jendela, atau nama agak berbeda; ATAU nama kuat dengan nominal sebagian (DP/cicilan belum lengkap).
//   RENDAH  — hanya nama (nominal tidak cocok) atau hanya nominal (nama lemah).
//   TIDAK ADA — tidak ada kandidat.
// Hanya TINGGI + unik yang boleh dianggap "terjelaskan"; sisanya Perlu Ditinjau.

import { toMoney } from "./money.js";

const GELAR = new Set(["ibu", "bu", "bapak", "pak", "bpk", "mba", "mbak", "mas", "kak", "kakak", "om", "tante", "dr", "drg", "ir", "hj", "hjh", "haji", "h", "ustadz", "ustadzah", "an", "atas", "nama", "pt", "cv", "toko", "sdr", "sdri", "bro", "sis"]);
const SINGKATAN = new Map([["m", "muhammad"], ["moh", "muhammad"], ["muh", "muhammad"], ["mohammad", "muhammad"], ["mohamad", "muhammad"], ["muhamad", "muhammad"], ["mochamad", "muhammad"], ["md", "muhammad"], ["siti", "siti"], ["st", "siti"], ["nur", "nur"], ["nurul", "nurul"]]);
const KATA_TRANSAKSI = /^(?:(?:pembayaran|pelunasan|pembayarn|pemb|bayar|dp|d\.p|down\s*payment|cicilan|cicil|termin|lunas|sisa|tf|transfer|trf|pelunasn|uang\s*muka)\b[\s.:/-]*)+/i;

const tanpaAksen = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Ambil bagian nama dari deskripsi Notion: "Pembayaran Ibu Erni (cash)" → "Ibu Erni". */
export function ekstrakNama(deskripsi) {
  let s = String(deskripsi ?? "").trim();
  s = s.replace(KATA_TRANSAKSI, "");
  s = s.replace(/[[(].*?[\])]/g, " "); // tag: (cash), [Cs Vina], (INSTAGRAM BANDUNG)
  return s.replace(/\s+/g, " ").trim();
}

/** Token nama ternormalisasi: huruf kecil, tanpa aksen/emoji/tanda baca, tanpa gelar, singkatan diseragamkan. */
export function tokenNama(nama) {
  const s = tanpaAksen(nama).toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return [];
  return s.split(" ").map((t) => SINGKATAN.get(t) ?? t).filter((t) => t && !GELAR.has(t));
}
export const normalisasiNama = (nama) => tokenNama(nama).join(" ");

function levenshtein(a, b) {
  const m = a.length; const n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const mirip = (a, b) => (a === b ? 1 : 1 - levenshtein(a, b) / Math.max(a.length, b.length));

/** Skor kemiripan nama 0..1. 1 = sama setelah normalisasi; 0.9 = himpunan token saling memuat; ~0.85 = typo ringan; selain itu rendah. */
export function skorNama(a, b) {
  const ta = tokenNama(a); const tb = tokenNama(b);
  if (!ta.length || !tb.length) return 0;
  const ja = ta.join(" "); const jb = tb.join(" ");
  if (ja === jb) return 1;
  if ([...ta].sort().join(" ") === [...tb].sort().join(" ")) return 0.98; // urutan kata berbeda
  const [kecil, besar] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const sub = kecil.every((t) => besar.includes(t));
  if (sub && kecil.join("").length >= 4) return kecil.length === 1 && besar.length > 2 ? 0.86 : 0.92; // satu kata di antara banyak kata = kurang tegas
  // typo ringan per token (≥4 huruf) + semua token kecil terpetakan
  const cocokToken = kecil.filter((t) => besar.some((u) => t === u || (t.length >= 4 && u.length >= 4 && mirip(t, u) >= 0.8)));
  if (cocokToken.length === kecil.length && kecil.join("").length >= 4) return 0.85;
  const r = mirip(ja, jb);
  return r >= 0.88 ? 0.84 : Math.min(0.6, r * 0.7);
}

const hari = (iso) => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 86400000);

/**
 * Subset (ukuran ≤ maks) dari `items` [{id,nilai}] yang jumlahnya persis `target`. Mengembalikan semua solusi (dibatasi 50).
 */
export function subsetJumlah(items, target, maks = 4) {
  const hasil = [];
  const t = toMoney(target);
  const cari = (mulai, dipilih, jumlah) => {
    if (hasil.length >= 50) return;
    if (dipilih.length > 0 && jumlah.equals(t)) hasil.push(dipilih.map((x) => x.id));
    if (dipilih.length >= maks) return;
    for (let i = mulai; i < items.length; i++) {
      const j = jumlah.plus(toMoney(items[i].nilai));
      if (j.greaterThan(t)) continue;
      cari(i + 1, [...dipilih, items[i]], j);
    }
  };
  cari(0, [], toMoney(0));
  return hasil;
}

/**
 * baris: [{id, deskripsi, nominal, tanggal 'YYYY-MM-DD', rekening}] — penerimaan Notion.
 * orders: [{id, nomor, nama, dibuat, kirim: [tgl], nilai, status}] — order sistem (non-batal).
 * opsi: { jendelaSebelum: hari sebelum order dibuat yang masih wajar (default 3), jendelaSesudah: hari setelah selesai/dibuat (default 45) }
 * Keluaran per baris: { id, nama, kepercayaan: 'TINGGI'|'SEDANG'|'RENDAH'|'TIDAK_ADA', jenis, orderIds, alasan[] }.
 */
export function cocokkan(baris, orders, opsi = {}) {
  const sebelum = opsi.jendelaSebelum ?? 3; const sesudah = opsi.jendelaSesudah ?? 45;
  const aktif = orders.filter((o) => o.status !== "CANCELLED" && Number(o.nilai) > 0);
  const hasil = new Map();
  const info = baris.map((b) => ({ ...b, nama: ekstrakNama(b.deskripsi) }));

  const jendela = (o, tgl) => {
    const d = hari(tgl); const awal = hari(o.dibuat) - sebelum;
    const akhir = Math.max(hari(o.dibuat), ...(o.kirim ?? []).map(hari)) + sesudah;
    return d >= awal && d <= akhir;
  };
  // kandidat order per baris (nama ≥ 0.84 sebagai calon; kekuatan dicatat)
  const kandidat = new Map();
  for (const b of info) {
    const c = [];
    for (const o of aktif) { const s = skorNama(b.nama, o.nama); if (s >= 0.84) c.push({ o, s }); }
    kandidat.set(b.id, c);
  }

  // 1) penjelasan: order penuh / beberapa order sekaligus, per baris
  const penjelasan = new Map(); // id → [{jenis, orderIds, skor, dalamJendela}]
  for (const b of info) {
    const c = kandidat.get(b.id); const sol = [];
    const perNama = new Map(); for (const k of c) (perNama.get(normalisasiNama(k.o.nama)) ?? perNama.set(normalisasiNama(k.o.nama), []).get(normalisasiNama(k.o.nama))).push(k);
    for (const [, grup] of perNama) {
      const items = grup.map((k) => ({ id: k.o.id, nilai: k.o.nilai }));
      for (const ids of subsetJumlah(items, b.nominal, 3)) {
        const os = ids.map((id) => grup.find((k) => k.o.id === id));
        sol.push({ jenis: ids.length === 1 ? "PENUH" : "GABUNGAN_ORDER", orderIds: ids, skor: Math.min(...os.map((k) => k.s)), dalamJendela: os.every((k) => jendela(k.o, b.tanggal)) });
      }
    }
    penjelasan.set(b.id, sol);
  }

  // 2) cicilan: beberapa baris (nama sama) yang jumlahnya persis satu order
  const cicilan = new Map(); // id baris → {orderId, barisIds}
  const perNamaBaris = new Map();
  for (const b of info) { const k = normalisasiNama(b.nama); if (!k) continue; (perNamaBaris.get(k) ?? perNamaBaris.set(k, []).get(k)).push(b); }
  for (const [, grup] of perNamaBaris) {
    if (grup.length < 2) continue;
    const ordersNama = aktif.filter((o) => grup.some((b) => skorNama(b.nama, o.nama) >= 0.9));
    for (const o of ordersNama) {
      const items = grup.filter((b) => jendela(o, b.tanggal) && toMoney(b.nominal).lessThan(toMoney(o.nilai))).map((b) => ({ id: b.id, nilai: b.nominal }));
      const sol = subsetJumlah(items, o.nilai, 4).filter((s) => s.length >= 2);
      if (sol.length === 1) for (const id of sol[0]) { if (!cicilan.has(id)) cicilan.set(id, { orderId: o.id, barisIds: sol[0], ganda: false }); else cicilan.get(id).ganda = true; }
      else if (sol.length > 1) for (const id of new Set(sol.flat())) { const x = cicilan.get(id) ?? { orderId: o.id, barisIds: sol[0] }; x.ganda = true; cicilan.set(id, x); }
    }
  }

  // klaim order oleh penerimaan PENUH: order yang dijelaskan penuh oleh >1 baris = ambigu
  const klaimPenuh = new Map();
  for (const b of info) for (const s of penjelasan.get(b.id)) if (s.jenis === "PENUH") (klaimPenuh.get(s.orderIds[0]) ?? klaimPenuh.set(s.orderIds[0], []).get(s.orderIds[0])).push(b.id);

  for (const b of info) {
    const alasan = []; const sol = penjelasan.get(b.id); const c = kandidat.get(b.id); const cic = cicilan.get(b.id);
    let kepercayaan = "TIDAK_ADA"; let jenis = null; let orderIds = [];
    const kuat = sol.filter((s) => s.skor >= 0.9 && s.dalamJendela);
    if (kuat.length === 1 && !cic) {
      const s = kuat[0];
      const rebutan = s.orderIds.some((id) => (klaimPenuh.get(id) ?? []).length > 1);
      if (rebutan) { kepercayaan = "SEDANG"; alasan.push("Order yang sama dijelaskan penuh oleh lebih dari satu penerimaan (kemungkinan dobel/berulang)"); } else { kepercayaan = "TINGGI"; alasan.push("Nama kuat + nominal tepat + tanggal dalam jendela + penjelasan unik"); }
      jenis = s.jenis; orderIds = s.orderIds;
    } else if (cic && !cic.ganda) {
      const o = aktif.find((x) => x.id === cic.orderId); const kuatNama = o && skorNama(b.nama, o.nama) >= 0.9;
      kepercayaan = kuatNama ? "TINGGI" : "SEDANG"; jenis = "CICILAN"; orderIds = [cic.orderId]; alasan.push(`Bagian dari ${cic.barisIds.length} penerimaan yang jumlahnya tepat sama dengan satu order`);
    } else if (sol.length > 0) {
      kepercayaan = "SEDANG"; jenis = sol[0].jenis; orderIds = [...new Set(sol.flatMap((s) => s.orderIds))];
      alasan.push(kuat.length > 1 || (cic && cic.ganda) ? "Lebih dari satu penjelasan yang mungkin (tidak unik)" : sol.some((s) => !s.dalamJendela) ? "Nominal tepat tetapi tanggal di luar jendela order" : "Nominal tepat tetapi nama tidak cukup kuat");
    } else if (c.length > 0) {
      const kuatNama = c.filter((k) => k.s >= 0.9);
      const total = kuatNama.reduce((t, k) => t + Number(k.o.nilai), 0);
      if (kuatNama.length > 0 && Number(b.nominal) < total) { kepercayaan = "SEDANG"; jenis = "SEBAGIAN"; orderIds = kuatNama.map((k) => k.o.id); alasan.push("Nama kuat, nominal lebih kecil dari nilai order (DP/cicilan belum lengkap)"); }
      else { kepercayaan = "RENDAH"; jenis = "NAMA_SAJA"; orderIds = c.map((k) => k.o.id); alasan.push("Hanya nama yang cocok; nominal tidak cocok"); }
    } else {
      const nom = aktif.filter((o) => toMoney(o.nilai).equals(toMoney(b.nominal)) && jendela(o, b.tanggal));
      if (nom.length > 0) { kepercayaan = "RENDAH"; jenis = "NOMINAL_SAJA"; orderIds = nom.map((o) => o.id); alasan.push("Hanya nominal+tanggal yang cocok; nama tidak cocok"); }
    }
    hasil.set(b.id, { id: b.id, nama: b.nama, kepercayaan, jenis, orderIds, alasan });
  }
  return hasil;
}
