import { buildQuery } from "../api/client.js";
import { toCreateBody, WORKSPACE } from "./domain.js";

// Binding endpoint biaya armada di atas klien bersama. SEMUA memakai endpoint yang
// sudah ada (/api/finance/expense-submissions/* dan /api/finance/expenses/*).
// Aksi uang (ajukan, setujui, tolak, bayar, verifikasi) WAJIB membawa
// Idempotency-Key supaya retry tidak menggandakan dokumen.
const P = "/finance/expense-submissions";

function idem(key) {
  if (!key) throw new Error("Idempotency-Key wajib untuk aksi biaya armada");
  return { "Idempotency-Key": key };
}

export function createBiayaArmadaApi(client) {
  return {
    config: () => client.request(`${P}/config${buildQuery({ workspace: WORKSPACE })}`),
    // filters: { status: "A,B", limit, offset, q, from, to } — limit/offset = paginasi server (adaLagi).
    list: (filters = {}) => client.request(`${P}${buildQuery({ division: WORKSPACE, ...filters })}`),
    detail: (id) => client.request(`${P}/${id}`),
    duplicateCheck: (params) => client.request(`${P}/duplicate-check${buildQuery(params)}`),
    create: (draft, key) => client.request(P, { method: "POST", body: toCreateBody(draft), headers: idem(key) }),
    update: (id, patch, key) => client.request(`${P}/${id}`, { method: "PATCH", body: patch, headers: idem(key) }),
    ajukan: (id, key) => client.request(`${P}/${id}/ajukan`, { method: "POST", body: {}, headers: idem(key) }),
    tarik: (id, key) => client.request(`${P}/${id}/tarik`, { method: "POST", body: {}, headers: idem(key) }),
    batalkan: (id, reason, key) => client.request(`${P}/${id}/batalkan`, { method: "POST", body: { reason }, headers: idem(key) }),
    // Koreksi field setelah diajukan — backend mewajibkan alasan dan mencatat audit.
    // Reviewer (finance:approve) mengembalikan pengajuan ke pemilik — alasan wajib.
    mintaRevisi: (id, reason, key) => client.request(`${P}/${id}/minta-revisi`, { method: "POST", body: { reason }, headers: idem(key) }),
    ubahMetadata: (id, changes, reason, key) => client.request(`${P}/${id}/metadata`, { method: "POST", body: { changes, reason }, headers: idem(key) }),
    // URL foto struk bertanda-tangan berumur pendek (10 menit) — untuk <Image> tanpa header. Hanya foto milik
    // pengguna/izinnya yang diberi URL; server memutuskan (foto lain tidak muncul di `signed`).
    signMedia: (urls) => client.request("/finance/media/sign", { method: "POST", body: { urls } }),
    uploadBukti: (id, file) => client.upload(`${P}/${id}/bukti`, file, { fieldName: "bukti" }),
    // Aksi Finance pada FinExpense yang lahir dari pengajuan.
    verifikasiBukti: (finExpenseId, key) => client.request(`/finance/expenses/${finExpenseId}/verifikasi-bukti`, { method: "POST", body: {}, headers: idem(key) }),
    setujui: (finExpenseId, key) => client.request(`/finance/expenses/${finExpenseId}/approve`, { method: "POST", body: {}, headers: idem(key) }),
    tolak: (finExpenseId, reason, key) => client.request(`/finance/expenses/${finExpenseId}/reject`, { method: "POST", body: { reason }, headers: idem(key) }),
    bayar: (finExpenseId, body, key) => client.request(`/finance/expenses/${finExpenseId}/pay`, { method: "POST", body, headers: idem(key) }),
  };
}
