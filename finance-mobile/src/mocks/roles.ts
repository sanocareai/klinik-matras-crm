import type { Capabilities, Preset, SessionUser } from "@/api/types";

// PERAN CONTOH (mode contoh saja) — supaya semua tata letak berbasis capability bisa diuji tanpa backend.
// Pilih lewat isi email di layar login: "owner@…", "akuntan@…" / "accountant@…", "approver@…", "penyetuju@…".
// "tanpaakses@…" mensimulasikan akun yang tidak berizin. Angka izin mengikuti backend (constants/permissions.js).

const dasar: Capabilities = {
  financeRead: false, financePost: false, financeApprove: false, financeAdmin: false,
  paymentRead: false, paymentWrite: false, expenseSubmit: false, financeApp: false, preset: "NONE",
};

const PRESET: Record<Exclude<Preset, "SUBMITTER" | "NONE">, Capabilities> = {
  FINANCE: { ...dasar, financeRead: true, financePost: true, financeApprove: true, paymentRead: true, paymentWrite: true, expenseSubmit: true, financeApp: true, preset: "FINANCE" },
  OWNER: { ...dasar, financeRead: true, financePost: true, financeApprove: true, financeAdmin: true, paymentRead: true, expenseSubmit: true, financeApp: true, preset: "OWNER" },
  ACCOUNTANT: { ...dasar, financeRead: true, financePost: true, paymentRead: true, financeApp: true, preset: "ACCOUNTANT" },
  APPROVER: { ...dasar, financeRead: true, financeApprove: true, paymentRead: true, financeApp: true, preset: "APPROVER" },
};

const ROLE: Record<keyof typeof PRESET, string> = { FINANCE: "FINANCE", OWNER: "OWNER", ACCOUNTANT: "ACCOUNTANT", APPROVER: "APPROVER" };
const NAMA: Record<keyof typeof PRESET, string> = {
  FINANCE: "Natasha (contoh)", OWNER: "Gilang (contoh)", ACCOUNTANT: "Akuntan (contoh)", APPROVER: "Penyetuju (contoh)",
};

export type PeranContoh = { user: SessionUser; capabilities: Capabilities } | { tanpaAkses: true };

export function peranContoh(email: string): PeranContoh {
  const e = email.trim().toLowerCase();
  if (e.startsWith("tanpaakses")) return { tanpaAkses: true };
  const preset: keyof typeof PRESET =
    e.startsWith("owner") ? "OWNER"
    : e.startsWith("akuntan") || e.startsWith("accountant") ? "ACCOUNTANT"
    : e.startsWith("approver") || e.startsWith("penyetuju") ? "APPROVER"
    : "FINANCE";
  return {
    user: { id: `contoh-${preset.toLowerCase()}`, name: NAMA[preset], role: ROLE[preset], roles: [ROLE[preset]] },
    capabilities: PRESET[preset],
  };
}
