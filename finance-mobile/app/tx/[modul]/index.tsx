import React from "react";
import { useLocalSearchParams } from "expo-router";
import { denganAkses } from "@/features/guard/RequireCapability";
import { DaftarTx } from "@/features/transaksi/DaftarTx";
import { modulValid } from "@/features/transaksi/modul";

function Layar() {
  const { modul, supplierId } = useLocalSearchParams<{ modul: string; supplierId?: string }>();
  return <DaftarTx modul={modulValid(modul) ? modul : "pengeluaran"} supplierId={typeof supplierId === "string" && supplierId ? supplierId : null} />;
}

export default denganAkses(Layar, "financeRead");
