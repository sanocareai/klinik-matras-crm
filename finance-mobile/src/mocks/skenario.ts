import { ApiError } from "@/api/errors";
import { toMoney } from "@/lib/money";
import type { DashboardData } from "@/api/types";
import { dashboardContoh } from "./data";

// SKENARIO UJI TAMPILAN (mode contoh saja). Dipilih lewat tanda "+" pada email di layar login,
// mis. "finance+kosong@x" atau "owner+panjang@x". Tidak pernah aktif di build production (ENV.useMocks).
//   normal   data lengkap             kosong   belum ada data sama sekali
//   parsial  sebagian bagian hilang   panjang  angka sangat panjang + nama rekening panjang
//   negatif  kas & laba negatif       lambat   loading lama (5 dtk)
//   galat    server error 500         offline  tidak ada koneksi
//   sesi     sesi berakhir (401)      basi     muat pertama sukses, penyegaran berikutnya gagal
//   konflik  keputusan persetujuan ditolak 409 (sudah diputuskan orang lain)
//   izin     keputusan persetujuan ditolak 403 (izin dicabut di tengah sesi)
//   putus    bacaan normal, tetapi koneksi putus SETELAH keputusan terkirim (hasil tidak pasti)

export type Skenario = "normal" | "kosong" | "parsial" | "panjang" | "negatif" | "lambat" | "galat" | "offline" | "sesi" | "basi" | "konflik" | "izin" | "putus";
const DAFTAR: Skenario[] = ["normal", "kosong", "parsial", "panjang", "negatif", "lambat", "galat", "offline", "sesi", "basi", "konflik", "izin", "putus"];

let aktif: Skenario = "normal";
let pemanggilan = 0;

export function skenarioDariEmail(email: string): Skenario {
  const cocok = /\+([a-z]+)@/i.exec(email.trim());
  const nama = cocok?.[1]?.toLowerCase() as Skenario | undefined;
  return nama && DAFTAR.includes(nama) ? nama : "normal";
}
let versi = 0;
/** Naik setiap login contoh — data contoh lain (mis. persetujuan) dimuat ulang dari awal saat versi berubah. */
export function versiSkenario(): number { return versi; }
export function setSkenario(s: Skenario) { aktif = s; pemanggilan = 0; hitungBaca.clear(); versi += 1; }
export function getSkenario(): Skenario { return aktif; }

const m = toMoney;
const tunda = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));
const NOL = m("0.00");

function kosong(): DashboardData {
  return {
    ...dashboardContoh, kasBank: [], totalKas: NOL,
    labaRugi: { pendapatanBruto: NOL, retur: NOL, pendapatanBersih: NOL, bebanPokok: NOL, labaKotor: NOL, bebanOperasional: NOL, labaBersih: NOL, marginKotor: null, marginBersih: null },
    piutang: { total: NOL, ember: dashboardContoh.piutang?.ember.map((e) => ({ ...e, total: NOL })) ?? [], menungguVerifikasi: null },
    utang: { total: NOL, ember: dashboardContoh.utang?.ember.map((e) => ({ ...e, total: NOL })) ?? [] },
    antrean: { jumlahPembayaranBelumVerifikasi: 0, lunasBelumDicatat: { jumlah: 0, total: NOL, baru: null, lama: null }, pengeluaranMenunggu: 0, pembelianMenunggu: 0, tagihanMenunggu: 0, refundMenunggu: 0 },
    jurnalTerakhir: [],
    catatan: { gapTerbuka: 0, saldoAwalTerisi: false, mulaiPembukuan: null, periodeTerbuka: 0, pesan: ["Saldo awal belum pernah diinput."] },
  };
}

function parsial(): DashboardData {
  return { ...dashboardContoh, labaRugi: null, piutang: null, antrean: null, jurnalTerakhir: [], bagianHilang: ["labaRugi", "piutang", "antrean", "jurnal"] };
}

function panjang(): DashboardData {
  const d = dashboardContoh;
  return {
    ...d,
    kasBank: [
      { id: "p1", name: "Rekening Operasional Utama Perusahaan Cabang Jakarta Selatan (BCA Giro)", kind: "BANK", bankName: "Bank Central Asia", saldo: m("98765432109876.54") },
      { id: "p2", name: "Kas Besar", kind: "KAS", bankName: null, saldo: m("-1234567890123.45") },
      { id: "p3", name: "GoPay/OVO/QRIS gabungan", kind: "EWALLET", bankName: null, saldo: m("12345678.90") },
    ],
    totalKas: m("97530864219753.09"),
    labaRugi: d.labaRugi && {
      ...d.labaRugi, pendapatanBersih: m("123456789012345.67"), bebanPokok: m("98765432109876.54"), labaKotor: m("24691356902469.13"),
      bebanOperasional: m("30000000000000.00"), labaBersih: m("-5308643097530.87"), marginKotor: 20, marginBersih: -4.3,
    },
    piutang: d.piutang && { ...d.piutang, total: m("55555555555555.55") },
    utang: d.utang && { ...d.utang, total: m("77777777777777.77") },
  };
}

function negatif(): DashboardData {
  const d = dashboardContoh;
  return {
    ...d,
    kasBank: d.kasBank.map((k, i) => (i === 0 ? { ...k, saldo: m("-175967591.00") } : k)),
    totalKas: m("-288613431.00"),
    labaRugi: d.labaRugi && { ...d.labaRugi, labaKotor: m("-104893765.00"), labaBersih: m("-199887351.00"), marginKotor: -3496.46, marginBersih: -6662.91 },
  };
}

const GALAT_JARINGAN = () => new ApiError({ status: 0, code: "NETWORK", message: "Tidak bisa terhubung ke server. Periksa koneksi internet Anda." });

/** Mode contoh: hasil dashboard sesuai skenario aktif (bisa melempar ApiError). */
export async function dashboardSkenario(): Promise<DashboardData> {
  pemanggilan += 1;
  await tunda(aktif === "lambat" ? 5000 : 350);
  switch (aktif) {
    case "kosong": return kosong();
    case "parsial": return parsial();
    case "panjang": return panjang();
    case "negatif": return negatif();
    case "galat": throw new ApiError({ status: 500, code: "INTERNAL", message: "boom" });
    case "offline": throw GALAT_JARINGAN();
    case "sesi": throw new ApiError({ status: 401, code: "SESSION_EXPIRED", message: "Sesi berakhir" });
    case "basi":
      if (pemanggilan > 1) throw GALAT_JARINGAN();
      return dashboardContoh;
    default: return dashboardContoh;
  }
}

/** Skenario galat untuk BACAAN selain dashboard (persetujuan): melempar sesuai skenario, atau lolos. `nama` memisahkan hitungan "basi". */
const hitungBaca = new Map<string, number>();
export async function simulasiBaca(nama: string): Promise<void> {
  const n = (hitungBaca.get(nama) ?? 0) + 1;
  hitungBaca.set(nama, n);
  await tunda(aktif === "lambat" ? 5000 : 300);
  switch (aktif) {
    case "galat": throw new ApiError({ status: 500, code: "INTERNAL", message: "boom" });
    case "offline": throw GALAT_JARINGAN();
    case "sesi": throw new ApiError({ status: 401, code: "SESSION_EXPIRED", message: "Sesi berakhir" });
    case "basi": if (n > 2) throw GALAT_JARINGAN(); return;
    default: return;
  }
}
export function resetHitunganBaca() { hitungBaca.clear(); }
