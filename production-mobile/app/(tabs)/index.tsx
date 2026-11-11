import React from "react";
import { Redirect } from "expo-router";
import { useLayout } from "@/api/production";

// Rute awal: Admin/QC/Dokumentasi ke Papan, PIC Meja/Corner ke Kerja.
export default function Index() {
  const l = useLayout();
  return <Redirect href={l.admin || !l.lane ? "/papan" : "/kerja"} />;
}
