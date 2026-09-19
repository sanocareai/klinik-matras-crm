import { Banknote, BadgeCheck, Camera, HandCoins, Receipt, RefreshCw, ShoppingCart, ArrowLeftRight, type LucideIcon } from "lucide-react-native";
import type { Capabilities } from "@/api/types";
import { has, type Need } from "@/auth/capabilities";
import { S } from "@/lib/strings";

// AKSI CEPAT — daftar tindakan yang boleh muncul (Beranda + FAB) berdasarkan capabilities.
//   catat (post)     butuh FINANCE_POST — TIDAK jadi aksi cepat untuk tata letak OWNER (PRD §12.4)
//   verifikasi       butuh PAYMENT_WRITE — khusus peran Keuangan
export type Aksi = { id: string; label: string; Icon: LucideIcon; need: Need };

export const AKSI: Aksi[] = [
  { id: "foto", label: S.aksi.fotoNota, Icon: Camera, need: "financePost" },
  { id: "pengeluaran", label: S.aksi.pengeluaran, Icon: Receipt, need: "financePost" },
  { id: "pembelian", label: S.aksi.pembelian, Icon: ShoppingCart, need: "financePost" },
  { id: "kasbon", label: S.aksi.kasbon, Icon: HandCoins, need: "financePost" },
  { id: "transfer", label: S.aksi.transfer, Icon: ArrowLeftRight, need: "financePost" },
  { id: "pemasukan", label: S.aksi.pemasukan, Icon: Banknote, need: "financePost" },
  { id: "verifikasi", label: S.aksi.verifikasi, Icon: BadgeCheck, need: "paymentWrite" },
  { id: "refund", label: S.aksi.refund, Icon: RefreshCw, need: "financePost" },
];

export function aksiUntuk(caps: Capabilities | null | undefined): Aksi[] {
  return AKSI.filter((a) => has(caps, a.need) && !(a.need === "financePost" && caps?.preset === "OWNER"));
}
