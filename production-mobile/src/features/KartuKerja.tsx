import React from "react";
import { Pressable, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import type { Kartu } from "./model";
import { formatMenit } from "./model";
import { C, F, TONE } from "@/design/tokens";
import { Card, Chip, ProgressBar, QueueNumber, T } from "@/design/ui";

/** Kartu besar "Sedang dikerjakan" (kanvas Kerja). */
export function KartuAktif({ k, onPress }: { k: Kartu & { no: number }; onPress?: () => void }) {
  const t = TONE[k.tone];
  const pct = k.progres ? k.progres.done / k.progres.total : 0;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Buka pekerjaan ${k.kodePendek}`} onPress={onPress} disabled={!onPress}>
      <Card style={{ gap: 14, borderRadius: 22 }}>
        <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
          <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: TONE.indigo.fill, alignItems: "center", justifyContent: "center" }}>
            <T.Caption style={{ color: "#fff", fontSize: 11, opacity: 0.9 }}>ANTRE</T.Caption>
            <T.Title style={{ color: "#fff", fontSize: 30, lineHeight: 34 }}>{k.no}</T.Title>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            {k.prioritas ? <Chip label={k.prioritas.label.toUpperCase()} tone={k.prioritas.tone} /> : null}
            <T.Title numberOfLines={1}>{k.kodePendek} · {k.customer}</T.Title>
            {k.kasur || k.layanan ? <T.Sub numberOfLines={1}>{[k.kasur, k.layanan].filter(Boolean).join(" · ")}</T.Sub> : null}
          </View>
        </View>
        <View style={{ backgroundColor: t.tint, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.fill }} />
            <T.Headline style={{ color: t.text, fontSize: 15, flex: 1 }} numberOfLines={1}>
              {k.tahap}{k.progres ? ` · ${k.progres.done}/${k.progres.total}` : ""}
            </T.Headline>
          </View>
          {k.menit != null ? <T.Headline style={{ color: t.text, fontSize: 15, fontVariant: ["tabular-nums"] }}>{formatMenit(k.menit)}</T.Headline> : null}
        </View>
        {k.progres ? <ProgressBar value={pct} tone={k.tone} /> : null}
        {k.terlambat ? <Chip label="Lewat target" tone="red" /> : null}
      </Card>
    </Pressable>
  );
}

/** Baris antrean berikutnya (kanvas Kerja). */
export function BarisAntrean({ k, onPress }: { k: Kartu & { no: number }; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Antrean ${k.no}, ${k.kodePendek}`}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, minHeight: 68 }, pressed && { backgroundColor: "#F5F5F7" }]}
    >
      <QueueNumber n={k.no} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T.Headline numberOfLines={1}>{k.kodePendek} · {k.customer}</T.Headline>
        <T.Sub numberOfLines={1} style={{ fontSize: 13 }}>{k.tahap}{k.kasur ? ` · ${k.kasur}` : ""}</T.Sub>
      </View>
      {k.prioritas ? <Chip label={k.prioritas.label} tone={k.prioritas.tone} /> : k.terlambat ? <Chip label="Lewat target" tone="red" /> : null}
      {onPress ? <ChevronRight color={C.ink3} size={20} /> : null}
    </Pressable>
  );
}

export const gayaFontAngka = { fontFamily: F.heavy, fontVariant: ["tabular-nums" as const] };
