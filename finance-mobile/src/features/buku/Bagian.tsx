import React from "react";
import { Text, View } from "react-native";
import { CircleCheck, ShieldAlert } from "lucide-react-native";
import { GlassCard } from "@/design/GlassCard";
import { MoneyText } from "@/design/MoneyText";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { periodePreset, type Periode } from "@/lib/periode";
import { wibParts } from "@/lib/dates";
import type { DokumenJurnal } from "@/api/types";
import type { Money } from "@/lib/money";

/** Baris label–nilai (nilai teks). Label tidak menyusut di font besar. */
export function BarisTeks({ label, isi }: { label: string; isi: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 16, paddingVertical: 7 }}>
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 13, flexShrink: 0, maxWidth: "44%" }}>{label}</Text>
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.text, fontFamily: font.medium, fontSize: 13, flexShrink: 1, textAlign: "right" }}>{isi}</Text>
    </View>
  );
}

export function BarisUang({ label, nilai, tebal = false, warna }: { label: string; nilai: Money; tebal?: boolean; warna?: string }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel={label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 16, paddingVertical: 7 }}>
      <Text maxFontSizeMultiplier={1.3} style={{ color: warna ?? colors.textMuted, fontFamily: tebal ? font.semibold : font.regular, fontSize: 13, flexShrink: 1 }}>{label}</Text>
      <View style={{ flexShrink: 0, maxWidth: "58%" }}><MoneyText value={nilai} size="sm" autoNegatif /></View>
    </View>
  );
}

/** Indikator seimbang — nilai `seimbang` & `selisih` dari server; klien tidak membandingkan debit dan kredit. */
export function IndikatorSeimbang({ seimbang, selisih }: { seimbang: boolean; selisih: Money }) {
  const { colors } = useTheme();
  const I = seimbang ? CircleCheck : ShieldAlert;
  const warna = seimbang ? colors.success : colors.danger;
  return (
    <View accessible accessibilityLabel={seimbang ? "Seimbang: total debit sama dengan total kredit" : "TIDAK seimbang: total debit tidak sama dengan total kredit"} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <I size={16} color={warna} strokeWidth={1.75} />
      <Text maxFontSizeMultiplier={1.3} style={{ color: warna, fontFamily: font.semibold, fontSize: 12 }}>{seimbang ? "Seimbang" : "Tidak seimbang"}</Text>
      {!seimbang ? <MoneyText value={selisih} size="sm" color={warna} autoNegatif /> : null}
    </View>
  );
}

export function KartuPeringatan({ judul, isi, nada = "danger" }: { judul: string; isi: string; nada?: "danger" | "warning" }) {
  const { colors } = useTheme();
  const warna = nada === "danger" ? colors.danger : colors.warning;
  return (
    <GlassCard variant="flat" style={{ marginBottom: 12, borderColor: warna }}>
      <View accessible accessibilityRole="alert" accessibilityLabel={`${judul}. ${isi}`} style={{ flexDirection: "row", gap: 10 }}>
        <ShieldAlert size={20} color={warna} strokeWidth={1.75} />
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.3} style={{ color: warna, fontFamily: font.semibold, fontSize: 13 }}>{judul}</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12, lineHeight: 17, marginTop: 2 }}>{isi}</Text>
        </View>
      </View>
    </GlassCard>
  );
}

/** Pilihan periode untuk daftar & buku besar: preset + Tahun lalu (lintas tahun). */
export function periodeBuku(): Periode[] {
  const y = wibParts(new Date()).y;
  return [...periodePreset(), { id: "tahun-lalu", label: `Tahun ${y - 1}`, from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, judul: "Tahun lalu" }];
}

/** Bulan dari tanggal jurnal (YYYY-MM-DD) → rentang bulan itu (untuk drill-down ke buku besar). */
export function rentangBulan(tanggal: string): { from: string; to: string } {
  const [y = "1970", m = "01"] = tanggal.split("-");
  const akhir = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(akhir).padStart(2, "0")}` };
}

/** Tujuan navigasi dokumen sumber jurnal: pembayaran order → S5; lainnya → modul S6–S8. */
export function tujuanDokumen(d: DokumenJurnal): { pathname: "/pembayaran/[id]"; params: { id: string } } | { pathname: "/tx/[modul]/[id]"; params: { modul: string; id: string } } {
  return d.modul === "pembayaran" ? { pathname: "/pembayaran/[id]", params: { id: d.id } } : { pathname: "/tx/[modul]/[id]", params: { modul: d.modul, id: d.id } };
}
