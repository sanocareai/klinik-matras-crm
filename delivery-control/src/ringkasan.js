import { useCallback, useEffect, useRef, useState } from "react";
import { statusesForStage } from "@sano/delivery-shared";
import { biayaArmadaApi } from "./client";

// Ringkasan jumlah pengajuan per tahap untuk kartu ringkasan (Beranda & Biaya Armada).
// HANYA MEMBACA endpoint daftar yang sudah ada (?status=…&limit=…) — tidak ada endpoint baru.
// Bila satu tahap melebihi batas, ditampilkan "99+" (jumlah pasti tidak dihitung di klien).
export const RINGKASAN_TAHAP = ["DRAF", "DIAJUKAN", "PERLU_REVISI", "DISETUJUI"];
const BATAS = 99;

export function labelJumlah(v) {
  if (!v) return "–";
  return v.lebih ? `${BATAS}+` : String(v.n);
}

export function useRingkasanBiaya(navigation) {
  const [data, setData] = useState({});
  const [status, setStatus] = useState("memuat"); // memuat | siap | gagal
  const urut = useRef(0);

  const muat = useCallback(async () => {
    const id = ++urut.current;
    try {
      const hasil = await Promise.all(RINGKASAN_TAHAP.map((tahap) =>
        biayaArmadaApi.list({ status: statusesForStage(tahap).join(","), limit: BATAS, offset: 0 })
          .then((r) => [tahap, { n: (r.submissions || []).length, lebih: !!r.adaLagi }])));
      if (id !== urut.current) return;
      setData(Object.fromEntries(hasil));
      setStatus("siap");
    } catch {
      if (id === urut.current) setStatus("gagal");
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);
  useEffect(() => (navigation ? navigation.addListener("focus", muat) : undefined), [navigation, muat]);
  return { data, status, muat };
}
