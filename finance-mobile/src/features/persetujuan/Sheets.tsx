import React, { useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useTinggiKeyboard } from "@/hooks/useKeyboard";
import { Check } from "lucide-react-native";
import { Sheet } from "@/design/Sheet";
import { Button, Chip, PressableScale } from "@/design/ui";
import { font, radius } from "@/design/tokens";
import { useTheme } from "@/design/theme";
import { haptic } from "@/design/haptics";
import { periodePreset } from "@/lib/periode";
import type { FilterApproval, JenisApproval } from "@/api/types";

const JENIS: { id: JenisApproval; label: string }[] = [
  { id: "expense", label: "Pengeluaran" }, { id: "purchase", label: "Pembelian" }, { id: "bill", label: "Tagihan" }, { id: "refund", label: "Refund" },
];

// ─── Filter ────────────────────────────────────────────────────────────────────────────────
export type DraftFilter = { jenis: JenisApproval[]; periodeId: string | null; pemohonId: string | null };

export function periodeKeRentang(id: string | null): { from: string | null; to: string | null } {
  if (!id) return { from: null, to: null };
  const p = periodePreset().find((x) => x.id === id);
  return p ? { from: p.from, to: p.to } : { from: null, to: null };
}

export function jumlahFilterAktif(f: Pick<FilterApproval, "jenis" | "from" | "pemohonId">): number {
  return (f.jenis.length > 0 ? 1 : 0) + (f.from ? 1 : 0) + (f.pemohonId ? 1 : 0);
}

export function FilterSheet({
  visible, awal, pemohon, onTutup, onTerapkan,
}: { visible: boolean; awal: DraftFilter; pemohon: { id: string; name: string }[]; onTutup: () => void; onTerapkan: (d: DraftFilter) => void }) {
  return (
    <Sheet visible={visible} onClose={onTutup} judul="Filter pengajuan">
      {/* Isi dipasang ulang tiap sheet dibuka (Modal melepas isinya saat tertutup) sehingga draf selalu mulai dari filter aktif. */}
      <IsiFilter awal={awal} pemohon={pemohon} onTerapkan={onTerapkan} />
    </Sheet>
  );
}

function IsiFilter({ awal, pemohon, onTerapkan }: { awal: DraftFilter; pemohon: { id: string; name: string }[]; onTerapkan: (d: DraftFilter) => void }) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState<DraftFilter>(awal);
  const preset = periodePreset();
  const bagian = (judul: string) => (
    <Text accessibilityRole="header" style={{ color: colors.textMuted, fontFamily: font.medium, fontSize: 12, marginTop: 14, marginBottom: 8 }}>{judul}</Text>
  );
  return (
    <>
      <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
        {bagian("Jenis dokumen")}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Chip label="Semua" aktif={draft.jenis.length === 0} onPress={() => setDraft({ ...draft, jenis: [] })} />
          {JENIS.map((j) => (
            <Chip
              key={j.id} label={j.label} aktif={draft.jenis.includes(j.id)}
              onPress={() => setDraft({ ...draft, jenis: draft.jenis.includes(j.id) ? draft.jenis.filter((x) => x !== j.id) : [...draft.jenis, j.id] })}
            />
          ))}
        </View>

        {bagian("Periode (tanggal dokumen)")}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Chip label="Semua tanggal" aktif={draft.periodeId == null} onPress={() => setDraft({ ...draft, periodeId: null })} />
          {preset.map((p) => <Chip key={p.id} label={p.judul ?? p.label} aktif={draft.periodeId === p.id} onPress={() => setDraft({ ...draft, periodeId: p.id })} />)}
        </View>

        {bagian("Pemohon")}
        <PilihanPemohon label="Semua pemohon" aktif={draft.pemohonId == null} onPress={() => setDraft({ ...draft, pemohonId: null })} />
        {pemohon.map((p) => <PilihanPemohon key={p.id} label={p.name} aktif={draft.pemohonId === p.id} onPress={() => setDraft({ ...draft, pemohonId: p.id })} />)}
      </ScrollView>
      <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
        <Button label="Atur ulang" variant="ghost" onPress={() => setDraft({ jenis: [], periodeId: null, pemohonId: null })} style={{ flex: 1 }} />
        <Button label="Terapkan" onPress={() => { onTerapkan(draft); }} style={{ flex: 1 }} />
      </View>
    </>
  );
}

function PilihanPemohon({ label, aktif, onPress }: { label: string; aktif: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={() => { haptic.tick(); onPress(); }} accessibilityLabel={`${label}${aktif ? ", dipilih" : ""}`} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.hairline }}>
      <Text maxFontSizeMultiplier={1.4} style={{ color: colors.text, fontFamily: aktif ? font.semibold : font.regular, fontSize: 15, flexShrink: 1 }}>{label}</Text>
      {aktif ? <Check size={18} color={colors.primary} strokeWidth={2} /> : null}
    </PressableScale>
  );
}

// ─── Alasan penolakan ──────────────────────────────────────────────────────────────────────
export const ALASAN_MIN = 3;

export function AlasanSheet({
  visible, sibuk, nomor, alasan, onUbah, onTutup, onKirim,
}: { visible: boolean; sibuk: boolean; nomor: string; alasan: string; onUbah: (t: string) => void; onTutup: () => void; onKirim: () => void }) {
  const { colors } = useTheme();
  const keyboard = useTinggiKeyboard();
  const cukup = alasan.trim().length >= ALASAN_MIN;
  return (
    <Sheet visible={visible} onClose={() => { if (!sibuk) onTutup(); }} judul="Tolak pengajuan" sub={`Tulis alasan penolakan untuk ${nomor}. Pemohon akan melihat alasan ini.`}>
      <View style={{ paddingBottom: keyboard > 0 ? keyboard - 8 : 0 }}>
        <TextInput
          value={alasan} onChangeText={onUbah} multiline maxLength={300} editable={!sibuk}
          placeholder="Contoh: nota tidak terbaca, mohon unggah ulang" placeholderTextColor={colors.textFaint}
          accessibilityLabel="Alasan penolakan"
          style={{ minHeight: 96, textAlignVertical: "top", color: colors.text, fontFamily: font.regular, fontSize: 15, padding: 12, borderRadius: radius.button, backgroundColor: colors.solidAlt, borderWidth: 1, borderColor: colors.hairline }}
        />
        <Text accessibilityLiveRegion="polite" style={{ color: cukup || alasan.length === 0 ? colors.textMuted : colors.warning, fontFamily: font.regular, fontSize: 12, marginTop: 6 }}>
          {alasan.length === 0 ? `Alasan wajib diisi (minimal ${ALASAN_MIN} huruf).` : cukup ? `${alasan.trim().length}/300` : `Tulis minimal ${ALASAN_MIN} huruf.`}
        </Text>
        <Button label="Tolak pengajuan" variant="danger" loading={sibuk} disabled={!cukup || sibuk} style={{ marginTop: 14 }} onPress={onKirim} />
      </View>
    </Sheet>
  );
}
