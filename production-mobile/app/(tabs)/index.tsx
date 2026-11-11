import React from "react";
import { Redirect } from "expo-router";
import { useLayout } from "@/api/production";

// Rute awal: Admin ke Papan, QC ke antrean QC, PIC Meja/Corner ke Kerja, lainnya ke Papan.
export default function Index() {
  const l = useLayout();
  return <Redirect href={l.admin ? "/papan" : l.qc ? "/qc" : l.lane ? "/kerja" : "/papan"} />;
}
