import React from "react";
import { Text, View } from "react-native";
import { ArrowUpRight, Camera, ChevronRight, Clock, Pause } from "lucide-react-native";
import type { Kartu } from "./model";
import { formatMenit } from "./model";
import { C, F, TONE } from "@/design/tokens";
import { Baris, Chip, GlassOnBlue, HeroCard, IconOrb, PilKaca, QueueNumber, TeksBaris, TombolBulat, TombolPutih } from "@/design/ui";

/**
 * Kartu kaca besar "Sedang dikerjakan" — susunan PERSIS mockup "Beranda PIC Meja": label + jam berjalan, kode 26/800,
 * panel kaca berisi tahap + batang langkah bersegmen, lalu tombol putih "Buka unit" + dua tombol bulat (foto/video, tunda).
 */
export function KartuAktif({ k, onPress, onMedia, onTunda }: { k: Kartu & { no: number }; onPress?: () => void; onMedia?: () => void; onTunda?: () => void }) {
  const total = k.progres?.total ?? 0;
  const done = k.progres?.done ?? 0;
  return (
    <HeroCard radius={32}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.bold, fontSize: 13, color: C.white }}>Sedang dikerjakan</Text>
        {k.menit != null ? (
          <PilKaca style={[{ borderRadius: 14 }, k.terlambat ? { backgroundColor: C.white } : null]}>
            <Clock size={14} color={k.terlambat ? TONE.orange.text : C.white} strokeWidth={2.6} />
            <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: F.heavy, fontSize: 13, color: k.terlambat ? TONE.orange.text : C.white, fontVariant: ["tabular-nums"] }}>{formatMenit(k.menit)}</Text>
          </PilKaca>
        ) : null}
      </View>
      <View>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontFamily: F.heavy, fontSize: 26, letterSpacing: -0.6, color: C.white }}>{k.kodePendek} · {k.customer}</Text>
        {k.kasur || k.layanan ? <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontFamily: F.semibold, fontSize: 14, color: "#EAF3FF" }}>{[k.kasur, k.layanan].filter(Boolean).join(" · ")}</Text> : null}
      </View>
      <GlassOnBlue style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ flex: 1, fontFamily: F.heavy, fontSize: 13, color: C.white }}>{total ? `Langkah ${Math.min(done + 1, total)}/${total} · ${k.tahap}` : k.tahap}</Text>
          {k.prioritas ? <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.semibold, fontSize: 13, color: C.white }}>{k.prioritas.label}</Text> : null}
        </View>
        {total ? (
          // mockup: satu segmen per langkah — selesai putih, yang sedang dikerjakan biru muda, sisanya putih 25%
          <View style={{ flexDirection: "row", gap: 4 }}>
            {Array.from({ length: total }, (_, i) => (
              <View key={i} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: i < done ? C.white : i === done ? "#9FE7FF" : "rgba(255,255,255,0.25)" }} />
            ))}
          </View>
        ) : null}
      </GlassOnBlue>
      {onPress ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TombolPutih label="Buka unit" tinggi={56} onPress={onPress} accessibilityLabel={`Buka pekerjaan ${k.kodePendek}`}>
            <IconOrb size={42}><ArrowUpRight color={C.white} size={18} strokeWidth={2.6} /></IconOrb>
          </TombolPutih>
          {onMedia ? <TombolBulat size={56} accessibilityLabel="Foto atau video" onPress={onMedia}><Camera size={22} color={C.white} strokeWidth={2.2} /></TombolBulat> : null}
          {onTunda ? <TombolBulat size={56} accessibilityLabel="Tunda" onPress={onTunda}><Pause size={22} color={C.white} strokeWidth={2.6} /></TombolBulat> : null}
        </View>
      ) : null}
    </HeroCard>
  );
}

/** Baris antrean berikutnya (mockup): baris putih, nomor bulat 38 (nomor pertama = bola biru), kode 14/800, sub 12/600, chip. */
export function BarisAntrean({ k, onPress, pertama }: { k: Kartu & { no: number }; onPress?: () => void; pertama?: boolean }) {
  return (
    <Baris onPress={onPress} accessibilityLabel={`Antrean ${k.no}, ${k.kodePendek}`}>
      <QueueNumber n={k.no} solid={pertama} />
      <TeksBaris judul={`${k.kodePendek} · ${k.customer}`} sub={`${k.kasur ? `${k.kasur} · ` : ""}${k.tahap}`} />
      {k.prioritas ? <Chip label={k.prioritas.label} tone={k.prioritas.tone} /> : k.terlambat ? <Chip label="Lewat target" tone="orange" /> : onPress ? <ChevronRight color={C.ink3} size={18} /> : null}
    </Baris>
  );
}

export const gayaFontAngka = { fontFamily: F.heavy, fontVariant: ["tabular-nums" as const] };
