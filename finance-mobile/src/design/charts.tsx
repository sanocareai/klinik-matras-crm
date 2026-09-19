import React from "react";
import { Text, View } from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { useTheme } from "./theme";
import { font } from "./tokens";
import { rasio, terbesar, type Money } from "@/lib/money";
import { bulanSingkat } from "@/lib/dates";
import type { Ember, TrenBulan } from "@/api/types";

// CHART — hanya menggambar angka yang SUDAH dihitung server. Rasio dihitung dengan BigInt
// dari nilai server (bagian ÷ total server / maksimum), tidak ada penjumlahan uang di klien.

/** Batang berpasangan pendapatan vs beban per bulan (referensi Nexora). */
export function BarTren({ data, tinggi = 120 }: { data: TrenBulan[]; tinggi?: number }) {
  const { colors } = useTheme();
  const maks = terbesar(data.flatMap((d) => [d.pendapatanBersih, d.beban]));
  return (
    <View accessibilityLabel="Grafik pendapatan dan beban enam bulan terakhir">
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: tinggi }}>
        {data.map((d) => (
          <View key={d.bulan} style={{ flex: 1, alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: tinggi }}>
              <View style={{ width: 10, height: Math.max(4, rasio(d.pendapatanBersih, maks) * tinggi), borderRadius: 5, backgroundColor: colors.primary }} />
              <View style={{ width: 10, height: Math.max(4, rasio(d.beban, maks) * tinggi), borderRadius: 5, backgroundColor: colors.warning, opacity: 0.75 }} />
            </View>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
        {data.map((d) => (
          <Text key={d.bulan} style={{ flex: 1, textAlign: "center", color: colors.textMuted, fontFamily: font.regular, fontSize: 11 }}>{bulanSingkat(d.bulan)}</Text>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
        <Legenda warna={colors.primary} label="Pendapatan bersih" />
        <Legenda warna={colors.warning} label="Beban" />
      </View>
    </View>
  );
}

export function Legenda({ warna, label }: { warna: string; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: warna }} />
      <Text style={{ color: colors.textMuted, fontFamily: font.regular, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

/** Donat komposisi (mis. umur piutang). Total = angka SERVER, bukan hasil penjumlahan klien. */
export function DonatEmber({ ember, totalServer, ukuran = 132, tengah }: { ember: Ember[]; totalServer: Money; ukuran?: number; tengah?: React.ReactNode }) {
  const { colors } = useTheme();
  const warna = [colors.success, colors.info, colors.warning, "#F97316", colors.danger];
  const stroke = 16;
  const r = (ukuran - stroke) / 2;
  const keliling = 2 * Math.PI * r;
  // Panjang & posisi awal tiap segmen dihitung di depan (rasio dari angka SERVER; geometri saja).
  const segmen = ember.reduce<{ label: string; panjang: number; mulai: number; i: number }[]>((acc, e, i) => {
    const bagian = rasio(e.total, totalServer);
    const sebelumnya = acc[acc.length - 1];
    const mulai = sebelumnya ? sebelumnya.mulai + sebelumnya.panjang + 2 : 0;
    const panjang = bagian <= 0 ? 0 : Math.max(2, keliling * bagian - 2);
    return [...acc, { label: e.label, panjang, mulai, i }];
  }, []);
  return (
    <View style={{ width: ukuran, height: ukuran, alignItems: "center", justifyContent: "center" }} accessibilityLabel="Grafik donat umur piutang">
      <Svg width={ukuran} height={ukuran}>
        <G rotation={-90} origin={`${ukuran / 2}, ${ukuran / 2}`}>
          <Circle cx={ukuran / 2} cy={ukuran / 2} r={r} stroke={colors.neutralSoft} strokeWidth={stroke} fill="none" />
          {segmen.map((g) => (g.panjang <= 0 ? null : (
            <Circle
              key={g.label}
              cx={ukuran / 2} cy={ukuran / 2} r={r} fill="none" stroke={warna[g.i % warna.length]} strokeWidth={stroke}
              strokeDasharray={`${g.panjang} ${keliling}`} strokeDashoffset={-g.mulai} strokeLinecap="round"
            />
          )))}
        </G>
      </Svg>
      <View style={{ position: "absolute", alignItems: "center" }}>{tengah}</View>
    </View>
  );
}

export const WARNA_EMBER = (c: ReturnType<typeof useTheme>["colors"]) => [c.success, c.info, c.warning, "#F97316", c.danger];
