import { useMemo } from "react";
import { hariIniWIB } from "@/lib/dates";
import { periodeDariId, type Periode } from "@/lib/periode";
import { usePeriode } from "./periodeStore";

/** Periode aktif sebagai rentang tanggal konkret (mengikuti pergantian bulan/hari menurut WIB). */
export function usePeriodeAktif(): Periode {
  const id = usePeriode((s) => s.id);
  const hari = hariIniWIB();
  return useMemo(() => periodeDariId(id, new Date(`${hari}T12:00:00+07:00`)), [id, hari]);
}
