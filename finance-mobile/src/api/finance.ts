import { api } from "@/auth/session";
import type { DashboardData, Ember, KasBankItem, JurnalRingkas } from "./types";
import type { Money } from "@/lib/money";

// ENDPOINT FINANCE yang sudah tersambung ke backend SANSS (PRD §16). Endpoint lain
// (transaksi, persetujuan, laporan) masih memakai data contoh di scaffold ini dan akan
// disambungkan per slice (S3–S10). Angka SELALU dari server — di sini hanya pemetaan bentuk.

const KUNCI_EMBER = ["belum_jatuh_tempo", "1_30", "31_60", "61_90", "90_plus"] as const;
const LABEL_EMBER: Record<string, string> = {
  belum_jatuh_tempo: "Belum jatuh tempo",
  "1_30": "1–30 hari",
  "31_60": "31–60 hari",
  "61_90": "61–90 hari",
  "90_plus": "> 90 hari",
};

type RawEmberSummary = Record<string, Money>;

type RawDashboard = {
  periode: { from: string; to: string };
  kasBank: { id: string; name: string; kind: KasBankItem["kind"]; saldo: Money; bankName?: string | null; accountNumber?: string | null }[];
  totalKas: Money;
  labaRugi: DashboardData["labaRugi"];
  piutang: { total: Money; ringkasan: RawEmberSummary; menungguVerifikasi: { jumlah: number; total: Money } };
  utang: { total: Money; ringkasan: RawEmberSummary };
  antrean: DashboardData["antrean"] & { pembayaranBelumVerifikasi?: unknown[] };
  jurnalTerakhir: JurnalRingkas[];
  catatan: DashboardData["catatan"];
};

function ember(ringkasan: RawEmberSummary | undefined): Ember[] {
  return KUNCI_EMBER.map((k) => ({ label: LABEL_EMBER[k] ?? k, total: (ringkasan?.[k] ?? "0.00") as Money, jumlah: 0 }));
}

export function mapDashboard(raw: RawDashboard): DashboardData {
  return {
    periode: raw.periode,
    // Nomor rekening tidak dipakai di layar daftar (PRD §13: hanya 4 digit terakhir bila kelak ditampilkan).
    kasBank: raw.kasBank.map((k) => ({ id: k.id, name: k.name, kind: k.kind, saldo: k.saldo })),
    totalKas: raw.totalKas,
    labaRugi: raw.labaRugi,
    piutang: { total: raw.piutang.total, ember: ember(raw.piutang.ringkasan), menungguVerifikasi: raw.piutang.menungguVerifikasi },
    utang: { total: raw.utang.total, ember: ember(raw.utang.ringkasan) },
    antrean: {
      jumlahPembayaranBelumVerifikasi: raw.antrean.jumlahPembayaranBelumVerifikasi,
      lunasBelumDicatat: raw.antrean.lunasBelumDicatat,
      pengeluaranMenunggu: raw.antrean.pengeluaranMenunggu,
      pembelianMenunggu: raw.antrean.pembelianMenunggu,
      tagihanMenunggu: raw.antrean.tagihanMenunggu,
      refundMenunggu: raw.antrean.refundMenunggu,
    },
    jurnalTerakhir: raw.jurnalTerakhir,
    catatan: raw.catatan,
  };
}

/** GET /api/finance/dashboard (izin FINANCE_READ). */
export async function fetchDashboard(periode: { from: string; to: string }): Promise<DashboardData> {
  const raw = await api.get<RawDashboard>("/finance/dashboard", {
    query: periode,
    normalisasi: { uang: [...KUNCI_EMBER] },
  });
  return mapDashboard(raw);
}
