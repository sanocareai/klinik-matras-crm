// Fase 5 — Corner: ringkasan permintaan Sales (kain/motif/warna/permintaan khusus), status Corner yang jujur, dan kontrak catatan PIC Corner. MURNI (tanpa DB).
//
// Prinsip: sistem TIDAK menebak motif atau warna. Sumber permintaan hanya (a) nama item pesanan (mis. "Ganti Kain Pinggir") dan (b) catatan pesanan apa adanya.
// Bila permintaan ganti kain ada tetapi motif dan/atau warna tidak tertulis, statusnya "Perlu konfirmasi Sales" — PIC Corner tidak boleh memasang kain baru tanpa
// mencatat hasil konfirmasi Sales (teks bebas milik PIC Corner, bukan hasil tebakan sistem).

export const CORNER_FABRIC_MODES = Object.freeze({ OLD_REUSED: "Kain lama dipakai kembali", NEW_INSTALLED: "Kain baru dipasang" });
export const CORNER_REQUEST_MATCH = Object.freeze({ SESUAI: "Sesuai permintaan Sales", ADA_PERBEDAAN: "Ada perbedaan dari permintaan Sales" });
export const SALES_CONFIRM_LABEL = "Perlu konfirmasi Sales";

const FABRIC_ITEM = /\bkain\b|\bsarung\b|\bcover\b|\bquilting\b/i;
const FABRIC_NOTE = /ganti\s+(kain|sarung|cover)|kain\s+baru|(sarung|cover)\s+baru/i;
const MOTIF = /motif|corak|\bpola\b|\bpolos\b/i;
const COLOR = /warna|colou?r|\b(abu|hitam|putih|coklat|cokelat|krem|cream|biru|hijau|merah|navy|beige|biege|kuning|hijau|ungu|pink|silver|gold|grey|gray)\b/i;

const clean = (v, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Ringkasan permintaan Sales untuk PIC Corner. items: [{ layananName }]; orderNotes: catatan pesanan apa adanya. */
export function buildCornerRequest({ items = [], orderNotes = null } = {}) {
  const notes = clean(orderNotes, 1000) || null;
  const fabricItems = (items || []).map((i) => clean(i?.layananName, 200)).filter((n) => n && FABRIC_ITEM.test(n));
  const fabricInNotes = !!notes && FABRIC_NOTE.test(notes);
  const fabricChangeRequested = fabricItems.length > 0 || fabricInNotes;
  const motifMentioned = !!notes && MOTIF.test(notes);
  const colorMentioned = !!notes && COLOR.test(notes);
  const missing = fabricChangeRequested ? [...(motifMentioned ? [] : ["motif"]), ...(colorMentioned ? [] : ["warna"])] : [];
  const needsSalesConfirmation = fabricChangeRequested && missing.length > 0;
  const status = !fabricChangeRequested ? "TIDAK_ADA_PERMINTAAN_KAIN" : needsSalesConfirmation ? "PERLU_KONFIRMASI_SALES" : "JELAS";
  const statusLabel = status === "PERLU_KONFIRMASI_SALES" ? SALES_CONFIRM_LABEL : status === "JELAS" ? "Permintaan kain tertulis" : "Tidak ada permintaan ganti kain";
  return {
    fabricChangeRequested, fabricItems, notes, motifMentioned, colorMentioned, missing, needsSalesConfirmation, status, statusLabel,
    hint: needsSalesConfirmation
      ? `Permintaan ganti kain ada, tetapi ${missing.join(" dan ")} belum tertulis di pesanan. Hubungi Sales — jangan menebak.`
      : null,
  };
}

/**
 * Status Corner untuk satu Run (satu sumber untuk Meja, Corner, Dokumentasi, Unit 360, Status Produksi, dan laporan).
 * input: { cornerApplies, cornerRequiredDecision (true|false|null), cornerReason, steps: Set<number> (bukti tahap tercatat, bukan SKIPPED), runStatus, hasQcPass }
 */
export function cornerStatusOf({ cornerApplies, decision = null, reason = null, steps = new Set(), runStatus = "ACTIVE", qcPassed = false, adaptation = false } = {}) {
  if (decision === false || (!cornerApplies && decision !== true)) {
    return {
      status: "TIDAK_BERLAKU", label: "Corner tidak berlaku", applies: false,
      reason: reason || (adaptation ? "Mode adaptasi: tahap Corner dilewati sesuai kebijakan" : "Jalur pesanan tanpa tahap Corner"),
      note: "Penyelesaian dikerjakan PIC Meja. Tidak ada aktivitas atau bukti Corner.",
    };
  }
  if (steps.has(12) || runStatus === "COMPLETED") return { status: "SELESAI", label: "Corner selesai", applies: true, reason: null };
  if (steps.has(11)) return { status: "JAHIT_SELESAI", label: "Jahit selesai — menunggu konfirmasi", applies: true, reason: null };
  if (steps.has(10)) return { status: "DIKERJAKAN", label: "Sedang di Corner", applies: true, reason: null };
  if (steps.has(9) || qcPassed) return { status: "MENUNGGU_CORNER", label: "Menunggu dikerjakan Corner", applies: true, reason: null };
  return { status: "BELUM_SAMPAI", label: "Belum sampai Corner", applies: true, reason: null };
}

const text = (value, min, label, invalid, max = 600) => {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.length < min) throw invalid(`${label} wajib diisi (minimal ${min} karakter)`);
  if (s.length > max) throw invalid(`${label} terlalu panjang (maksimal ${max} karakter)`);
  return s;
};
const optional = (value, label, invalid, max = 600) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw invalid(`${label} tidak valid`);
  const s = value.trim();
  if (s.length > max) throw invalid(`${label} terlalu panjang (maksimal ${max} karakter)`);
  return s || null;
};

/** Tahap 10 (mulai Corner), kontrak Fase 5. Mengembalikan bagian payload tambahan. invalid(message) = pembuat galat 400 milik pemanggil. */
export function validateCornerStart(p, { brief, mediaCount, label }, invalid) {
  if (p.requestChecked !== true) throw invalid(`${label}: centang bahwa Anda sudah memeriksa permintaan Sales sebelum mulai`);
  if (!Object.keys(CORNER_FABRIC_MODES).includes(p.fabricMode)) throw invalid(`${label}: pilih "Kain lama dipakai kembali" atau "Kain baru dipasang"`);
  if (!Object.keys(CORNER_REQUEST_MATCH).includes(p.requestMatch)) throw invalid(`${label}: pilih apakah pekerjaan sesuai permintaan Sales atau ada perbedaan`);
  if (mediaCount < 1) throw invalid(`${label}: wajib melampirkan minimal 1 foto/video proses`);
  const requestNote = p.requestMatch === "ADA_PERBEDAAN" ? text(p.requestNote, 3, "Catatan perbedaan dari permintaan Sales", invalid) : optional(p.requestNote, "Catatan permintaan", invalid);
  if (brief?.fabricChangeRequested && p.fabricMode === "OLD_REUSED" && p.requestMatch !== "ADA_PERBEDAAN") {
    throw invalid(`${label}: Sales meminta ganti kain tetapi kain lama dipakai kembali — pilih "Ada perbedaan" dan jelaskan alasannya`);
  }
  let salesConfirmation = null;
  if (brief?.needsSalesConfirmation && p.fabricMode === "NEW_INSTALLED") {
    salesConfirmation = text(p.salesConfirmation, 3, `Hasil konfirmasi Sales (${SALES_CONFIRM_LABEL}: ${brief.missing.join(" & ")} belum tertulis)`, invalid);
  } else salesConfirmation = optional(p.salesConfirmation, "Hasil konfirmasi Sales", invalid);
  return {
    requestChecked: true, fabricMode: p.fabricMode, requestMatch: p.requestMatch, requestNote, salesConfirmation,
    requestStatusAtStart: brief?.status ?? null,
  };
}

/** Tahap 11 (jahit selesai), kontrak Fase 5. */
export function validateCornerDone(p, { label }, invalid) {
  const cornerWork = text(p.cornerWork, 3, "Pekerjaan Corner yang dilakukan", invalid);
  const noDifference = p.noDifference === true;
  const differenceNote = optional(p.differenceNote, "Catatan perbedaan", invalid);
  if (!noDifference && !differenceNote) throw invalid(`${label}: isi catatan perbedaan, atau centang "Tidak ada perbedaan dari rencana/permintaan"`);
  return { cornerWork, noDifference, differenceNote: noDifference ? null : differenceNote };
}

