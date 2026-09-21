import { useCallback, useRef, useState } from "react";
import { ApiError } from "@/api/errors";
import { bikinKunci, izinBerubah } from "@/api/approvals";
import { cocokkanBaris, lepasBaris } from "@/api/buku";
import { haptic } from "@/design/haptics";
import { useMuatUlangBuku } from "@/hooks/buku";
import { klasifikasiKeputusan, type InfoGalatKeputusan } from "@/features/persetujuan/galat";
import type { AksiTx } from "@/api/types";

export type HasilRekon = { ok: true } | { ok: false; info: InfoGalatKeputusan };
const BATAL: HasilRekon = { ok: false, info: { jenis: "batal", pesan: "", muatUlang: false, segarkanIzin: false, simpanKunci: true } };

/**
 * Cocokkan / lepas satu baris koran. Pola sama dengan useAksiTx: kunci sibuk sinkron (double-tap tidak mengirim dua kali),
 * satu Idempotency-Key per niat (dipakai ulang bila hasil tidak pasti), data diambil ulang dari server setelah sukses atau galat yang mengubah status.
 */
export function useAksiRekon() {
  const [sibuk, setSibuk] = useState(false);
  const kunci = useRef<{ niat: string; nilai: string } | null>(null);
  const kunciSibuk = useRef(false);
  const muatUlang = useMuatUlangBuku();

  const jalankan = useCallback(async (niat: string, kerja: (k: string) => Promise<void>): Promise<HasilRekon> => {
    if (kunciSibuk.current) return BATAL;
    kunciSibuk.current = true;
    setSibuk(true);
    if (!kunci.current || kunci.current.niat !== niat) kunci.current = { niat, nilai: bikinKunci() };
    try {
      await kerja(kunci.current.nilai);
      kunci.current = null;
      haptic.sukses();
      await muatUlang();
      return { ok: true };
    } catch (e) {
      const dasar = klasifikasiKeputusan(e);
      const info = dasar.jenis === "konflik" && e instanceof ApiError && e.status === 409 && e.message ? { ...dasar, pesan: `${e.message} Status terbaru dimuat ulang.` } : dasar;
      if (!info.simpanKunci) kunci.current = null;
      if (info.jenis !== "batal") haptic.galat();
      if (info.segarkanIzin) izinBerubah();
      if (info.muatUlang) await muatUlang().catch(() => undefined);
      return { ok: false, info };
    } finally {
      kunciSibuk.current = false;
      setSibuk(false);
    }
  }, [muatUlang]);

  const cocokkan = useCallback((barisId: string, aksi: AksiTx, journalLineId: string) => jalankan(`cocok:${barisId}:${journalLineId}`, (k) => cocokkanBaris({ aksi, journalLineId, kunci: k })), [jalankan]);
  const lepas = useCallback((barisId: string, aksi: AksiTx) => jalankan(`lepas:${barisId}`, (k) => lepasBaris({ aksi, kunci: k })), [jalankan]);
  return { cocokkan, lepas, sibuk };
}
