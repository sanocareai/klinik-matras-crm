// Menempelkan `manifest` ke SETIAP objek job pada payload API Armada (satu titik, supaya web, rute, driver app, dan pesan grup memakai angka yang SAMA).
// Dikenali sebagai job: objek dengan `type` PICKUP/DELIVERY dan array `units` berisi { unit }. Manifest TIDAK memuat harga/nilai/pembayaran.
import { bangunManifest } from "../lib/domain/deliveryManifest.js";
import { parseOrderNotesForInvoice } from "./invoice.js";

const ALAT = { ukuranDariNotes: (notes) => parseOrderNotesForInvoice(notes) };

export const adalahJob = (o) => Boolean(o) && typeof o === "object" && !Array.isArray(o)
  && (o.type === "PICKUP" || o.type === "DELIVERY") && Array.isArray(o.units) && o.units.every((ju) => ju && typeof ju === "object" && "unit" in ju);

export const manifestJob = (job) => bangunManifest(job, ALAT);

/** Telusuri payload (objek/array bersarang) dan tempelkan `manifest` pada tiap job. Mengembalikan body yang sama (dimutasi). */
export function tempelManifest(body, { kedalaman = 0 } = {}) {
  if (!body || typeof body !== "object" || kedalaman > 8) return body;
  if (Array.isArray(body)) { for (const x of body) tempelManifest(x, { kedalaman: kedalaman + 1 }); return body; }
  if (adalahJob(body) && body.manifest === undefined) {
    try { body.manifest = manifestJob(body); } catch { /* manifest tidak boleh menggagalkan respons */ }
  }
  for (const [k, v] of Object.entries(body)) {
    if (v && typeof v === "object" && k !== "manifest") tempelManifest(v, { kedalaman: kedalaman + 1 });
  }
  return body;
}
