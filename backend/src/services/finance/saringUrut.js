// SARING & URUT mutasi rekening (Mutasi Buku & Mutasi Bank) — satu sumber untuk layar dan Export Excel, supaya baris yang tampil = baris yang diekspor.
// Saring/urut dilakukan SETELAH saldo berjalan dihitung: kolom Saldo tetap saldo berjalan seluruh periode (urutan kronologis), bukan dihitung ulang mengikuti urutan tampil.
import { toMoney, ZERO } from "./money.js";

export const ARAH = Object.freeze(["MASUK", "KELUAR"]);
export const KUNCI_URUT = Object.freeze(["tanggal", "nominal", "saldo"]);

export class OpsiError extends Error {
  constructor(message) { super(message); this.name = "OpsiError"; this.statusCode = 400; }
}

const angka = (v, nama) => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  try { const m = toMoney(String(v).replace(/\./g, "").replace(",", "."), { field: nama }); if (m.isNegative()) throw new Error("negatif"); return m; } catch { throw new OpsiError(`${nama} bukan angka yang sah`); }
};

/** Opsi dari query string → objek bersih (nilai tidak dikenal = 400, bukan diam-diam diabaikan). */
export function opsiDari(q = {}) {
  const arah = q.arah ? String(q.arah).toUpperCase() : null;
  if (arah && !ARAH.includes(arah)) throw new OpsiError("Arah harus MASUK atau KELUAR");
  const urut = q.urut ? String(q.urut) : "tanggal";
  if (!KUNCI_URUT.includes(urut)) throw new OpsiError(`Urutan harus salah satu dari: ${KUNCI_URUT.join(", ")}`);
  const arahUrut = q.arahUrut ? String(q.arahUrut).toLowerCase() : "asc";
  if (!["asc", "desc"].includes(arahUrut)) throw new OpsiError("Arah urutan harus asc atau desc");
  const min = angka(q.nominalMin, "Nominal minimum"), maks = angka(q.nominalMaks, "Nominal maksimum");
  if (min && maks && min.greaterThan(maks)) throw new OpsiError("Nominal minimum tidak boleh lebih besar dari maksimum");
  return { arah, urut, arahUrut, min, maks };
}

const nominalBaris = (b) => toMoney(b.masuk ?? b.keluar ?? 0);

/** Terapkan arah + rentang nominal. Baris `masuk`/`keluar` berbentuk string uang atau null (bentuk yang sama untuk buku & bank). */
export function saring(baris, o) {
  return baris.filter((b) => {
    if (o.arah === "MASUK" && !b.masuk) return false;
    if (o.arah === "KELUAR" && !b.keluar) return false;
    const n = nominalBaris(b);
    if (o.min && n.lessThan(o.min)) return false;
    if (o.maks && n.greaterThan(o.maks)) return false;
    return true;
  });
}

/** Urut stabil. `tanggal` = urutan kronologis asli (desc = dibalik); nominal = nilai mutasi; saldo = saldo berjalan. */
export function urutkan(baris, o) {
  const dasar = baris.map((b, i) => ({ b, i }));
  const kunci = { tanggal: (x) => x.i, nominal: (x) => Number(nominalBaris(x.b).toFixed(2)), saldo: (x) => (x.b.saldo == null ? Number.NEGATIVE_INFINITY : Number(x.b.saldo)) }[o.urut];
  const arah = o.arahUrut === "desc" ? -1 : 1;
  dasar.sort((x, y) => (kunci(x) - kunci(y)) * arah || (x.i - y.i) * arah);
  return dasar.map((x) => x.b);
}

/** Ringkasan baris yang tampil setelah disaring (bukan total periode). */
export function ringkasTersaring(baris) {
  let masuk = ZERO, keluar = ZERO;
  for (const b of baris) { if (b.masuk) masuk = masuk.plus(toMoney(b.masuk)); if (b.keluar) keluar = keluar.plus(toMoney(b.keluar)); }
  return { jumlah: baris.length, masuk: masuk.toFixed(2), keluar: keluar.toFixed(2) };
}

export const adaSaringan = (o) => !!(o.arah || o.min || o.maks);
