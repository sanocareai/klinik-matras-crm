import type { AndonItem, AndonStation, Bucket } from "@/api/types";
import type { ToneKey } from "@/design/tokens";
import { BUCKET_TONE, kodePendek } from "./model";

// MODEL MURNI Papan & Target — dari GET /production-v2/andon (urutan item per meja = urutan server/Admin).

const KERJA: Bucket[] = ["BONGKAR", "DIAGNOSA", "FONDASI", "LAPISAN", "QC", "CORNER"];

export type RingkasMeja = {
  code: string;
  label: string;
  pic: string;
  sekarang: { kode: string; customer: string; tahap: string; tone: ToneKey; menit: number | null; runId: string } | null;
  status: "kerja" | "terhambat" | "kosong";
  jumlah: number;
};

/** Item yang sedang ditangani meja: yang pertama berstatus kerja/terhambat, menurut urutan server. */
export function itemSekarang(items: AndonItem[]): AndonItem | null {
  return items.find((i) => KERJA.includes(i.bucket) || i.bucket === "MENUNGGU_BAHAN") ?? null;
}

export function ringkasMeja(s: AndonStation): RingkasMeja {
  const now = itemSekarang(s.items);
  const terhambat = now?.bucket === "MENUNGGU_BAHAN";
  return {
    code: s.code,
    label: s.label,
    pic: s.operatorNames.join(", ") || "Belum ada PIC",
    sekarang: now
      ? {
          kode: kodePendek(now.unitCode),
          customer: now.customerName || "—",
          tahap: terhambat ? (now.shortage?.length ? `Bahan kurang: ${now.shortage.join(", ")}` : now.bucketLabel) : now.stepLabel || now.bucketLabel,
          tone: BUCKET_TONE[now.bucket],
          menit: now.timer?.stepElapsedMinutes ?? null,
          runId: now.runId,
        }
      : null,
    status: !now ? "kosong" : terhambat ? "terhambat" : "kerja",
    jumlah: s.items.length,
  };
}

/** Unit yang butuh perhatian Admin: komplain/prioritas tinggi, lewat target, atau menunggu bahan. */
export function perluPerhatian(stations: AndonStation[]) {
  return stations
    .flatMap((s) => s.items.map((i) => ({ i, meja: s.label })))
    .filter(({ i }) => i.priority >= 3 || i.timer?.late || i.bucket === "MENUNGGU_BAHAN")
    .map(({ i, meja }) => ({
      runId: i.runId,
      kode: kodePendek(i.unitCode),
      customer: i.customerName || "—",
      meja,
      alasan: i.priority >= 3 ? `${i.priorityLabel} — prioritaskan` : i.bucket === "MENUNGGU_BAHAN" ? "Menunggu bahan" : "Lewat target waktu",
      tone: (i.priority >= 3 || i.bucket === "MENUNGGU_BAHAN" ? "red" : "orange") as ToneKey,
    }));
}
