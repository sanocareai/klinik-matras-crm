// Logika MURNI form "Catat Pembayaran" (tanpa React/RN supaya bisa dites dengan node --test).
//
// Aturan (workflow TIDAK berubah — hanya state form yang dirapikan):
//  • Tunai tidak memilih rekening (backend: kas tunai tidak ikut daftar rekening, jurnal mengikuti pemetaan Tunai di
//    Finance > Pengaturan). Jadi cashAccountId TIDAK PERNAH dikirim untuk Tunai, walau sebelumnya ada rekening dipilih.
//  • Transfer/QRIS/Kartu boleh memilih rekening tujuan (opsional, seperti sebelumnya). Pilihan diingat PER METODE:
//    pindah metode lalu kembali tidak menghilangkan pilihan, dan pilihan satu metode tidak bocor ke metode lain.
//  • Rekening yang dipilih tapi sudah tidak ada di daftar aktif (mis. dinonaktifkan) dibuang saat menyimpan.

export const METHODS = ["CASH", "TRANSFER", "QRIS", "CARD"];
export const METHOD_LABEL = { CASH: "Tunai", TRANSFER: "Transfer", QRIS: "QRIS", CARD: "Kartu" };
export const METHOD_USES_ACCOUNT = { CASH: false, TRANSFER: true, QRIS: true, CARD: true };

const KIND_ORDER = { BANK: 0, EWALLET: 1 };

/** Daftar rekening dari API → item valid, unik per id, urut (bank dulu, lalu nama). Tidak pernah melempar. */
export function normalizeAccounts(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const id = typeof a.id === "string" ? a.id.trim() : "";
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    if (a.active === false) continue; // API sudah hanya mengirim yang aktif; jaga-jaga bila field ada
    seen.add(id);
    out.push({
      id,
      name,
      kind: a.kind || null,
      bankName: (typeof a.bankName === "string" && a.bankName.trim()) || null,
      holder: (typeof a.accountHolder === "string" && a.accountHolder.trim()) || null,
      masked: (typeof a.accountNumberMasked === "string" && a.accountNumberMasked.trim()) || null,
    });
  }
  return out.sort((x, y) => (KIND_ORDER[x.kind] ?? 9) - (KIND_ORDER[y.kind] ?? 9) || x.name.localeCompare(y.name, "id"));
}

export function initialDraft() {
  return { open: false, amount: "", method: "TRANSFER", accountByMethod: {}, photo: null };
}

export function draftReducer(d, action) {
  switch (action.type) {
    case "open": return { ...d, open: true };
    case "reset": return initialDraft();
    case "amount": return { ...d, amount: action.value };
    case "method": return METHODS.includes(action.value) ? { ...d, method: action.value } : d;
    case "pickAccount": {
      if (!METHOD_USES_ACCOUNT[d.method]) return d;
      const cur = d.accountByMethod[d.method] ?? null;
      const next = cur === action.id ? null : action.id; // ketuk lagi = lepas pilihan
      return { ...d, accountByMethod: { ...d.accountByMethod, [d.method]: next } };
    }
    case "photo": return { ...d, photo: action.value };
    default: return d;
  }
}

/** Rekening terpilih untuk metode AKTIF (null bila Tunai / belum dipilih / sudah tidak ada di daftar). */
export function selectedAccountId(d, accounts) {
  if (!METHOD_USES_ACCOUNT[d.method]) return null;
  const id = d.accountByMethod[d.method] ?? null;
  return id && accounts.some((a) => a.id === id) ? id : null;
}

/** Jumlah rupiah bulat dari input teks ("1.500.000", "Rp 1500000") — 0 bila tidak valid. */
export function parseAmount(text) {
  if (String(text ?? "").includes("-")) return 0; // nilai negatif tidak valid
  const digits = String(text ?? "").replace(/\D/g, "");
  if (!digits || digits.length > 12) return 0;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : 0;
}

/** Badan permintaan POST /orders/:id/payments — kontrak API tidak berubah. */
export function buildPaymentPayload(d, accounts, proofPhotoUrl) {
  const cashAccountId = selectedAccountId(d, accounts);
  return {
    amount: parseAmount(d.amount),
    method: d.method,
    ...(proofPhotoUrl ? { proofPhotoUrl } : {}),
    ...(cashAccountId ? { cashAccountId } : {}),
  };
}
