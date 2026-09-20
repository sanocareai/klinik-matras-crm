import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { Sheet } from "@/design/Sheet";
import { Button, Chip, PressableScale } from "@/design/ui";
import { font } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { haptic } from "@/design/haptics";
import { periodePreset } from "@/lib/periode";
import type { FilterPembayaran, MetodeBayar, OpsiBayar } from "@/api/types";

export type DraftBayar = { metode: MetodeBayar | null; rekeningId: string | null; periodeId: string | null };
export const DRAFT_KOSONG: DraftBayar = { metode: null, rekeningId: null, periodeId: null };

export function jumlahFilterBayar(f: Pick<FilterPembayaran, "metode" | "rekeningId" | "from">): number {
  return (f.metode ? 1 : 0) + (f.rekeningId ? 1 : 0) + (f.from ? 1 : 0);
}

export function FilterBayarSheet({
  visible, awal, opsi, onTutup, onTerapkan,
}: { visible: boolean; awal: DraftBayar; opsi: OpsiBayar | undefined; onTutup: () => void; onTerapkan: (d: DraftBayar) => void }) {
  return (
    <Sheet visible={visible} onClose={onTutup} judul="Filter pembayaran">
      {/* Isi dipasang ulang tiap sheet dibuka (Modal melepas isinya saat tertutup) sehingga draf selalu mulai dari filter aktif. */}
      <IsiFilter awal={awal} opsi={opsi} onTerapkan={onTerapkan} />
    </Sheet>
  );
}

function IsiFilter({ awal, opsi, onTerapkan }: { awal: DraftBayar; opsi: OpsiBayar | undefined; onTerapkan: (d: DraftBayar) => void }) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState<DraftBayar>(awal);
  const preset = periodePreset();
  const bagian = (judul: string) => (
    <Text accessibilityRole="header" style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 12, marginTop: 14, marginBottom: 8 }}>{judul}</Text>
  );
  return (
    <>
      <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
        {bagian("Cara bayar")}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Chip label="Semua" aktif={draft.metode == null} onPress={() => setDraft({ ...draft, metode: null })} />
          {(opsi?.metode ?? []).map((m) => (
            <Chip key={m.id} label={m.label} aktif={draft.metode === m.id} onPress={() => setDraft({ ...draft, metode: m.id as MetodeBayar })} />
          ))}
        </View>

        {bagian("Periode (tanggal pembayaran dicatat)")}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Chip label="Semua tanggal" aktif={draft.periodeId == null} onPress={() => setDraft({ ...draft, periodeId: null })} />
          {preset.map((p) => <Chip key={p.id} label={p.judul ?? p.label} aktif={draft.periodeId === p.id} onPress={() => setDraft({ ...draft, periodeId: p.id })} />)}
        </View>

        {bagian("Rekening tujuan")}
        <PilihanBaris label="Semua rekening" aktif={draft.rekeningId == null} onPress={() => setDraft({ ...draft, rekeningId: null })} />
        {(opsi?.rekening ?? []).map((r) => <PilihanBaris key={r.id} label={r.name} aktif={draft.rekeningId === r.id} onPress={() => setDraft({ ...draft, rekeningId: r.id })} />)}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
        <Button label="Atur ulang" variant="ghost" onPress={() => setDraft(DRAFT_KOSONG)} style={{ flex: 1 }} />
        <Button label="Terapkan" onPress={() => onTerapkan(draft)} style={{ flex: 1 }} />
      </View>
    </>
  );
}

function PilihanBaris({ label, aktif, onPress }: { label: string; aktif: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={() => { haptic.tick(); onPress(); }} accessibilityLabel={`${label}${aktif ? ", dipilih" : ""}`} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.hairline }}>
      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.text, fontFamily: aktif ? font.semibold : font.regular, fontSize: 15, flexShrink: 1 }}>{label}</Text>
      {aktif ? <Check size={18} color={colors.primary} strokeWidth={2} /> : null}
    </PressableScale>
  );
}
