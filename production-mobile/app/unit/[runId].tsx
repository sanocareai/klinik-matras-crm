import React, { useMemo } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check } from "lucide-react-native";
import { useReport, useRunCard } from "@/api/production";
import { pesanUntukPengguna } from "@/api/errors";
import type { StepStatus } from "@/api/types";
import { formatMenit, grupMedia, kartuDariV2, kodePendek } from "@/features/model";
import { Thumb } from "@/features/Galeri";
import { NavBar } from "@/design/NavBar";
import { Card, Chip, ProgressBar, Screen, Section, StateView, T } from "@/design/ui";
import { C, TONE, type ToneKey } from "@/design/tokens";
import { jamWib } from "@/lib/waktu";

// DETAIL UNIT — kartu kerja V2 (GET /production-v2/runs/:runId/card) + media laporan, live 20 detik.
// Tahap ini BACA-SAJA: tombol Mulai/Jeda/Terhambat/Selesai Tahap menyusul di slice berikutnya.
export default function UnitDetail() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const card = useRunCard(runId);
  const report = useReport(runId);
  const v = card.data;
  const k = useMemo(() => (v ? kartuDariV2(v) : null), [v]);
  const media = useMemo(() => grupMedia(report.data).flatMap((g) => g.items), [report.data]);
  const steps = (v?.steps ?? []).filter((s) => s.status !== "NA");
  const pelaku = useMemo(() => {
    const m = new Map<number, { actor: string | null; at: string }>();
    for (const e of v?.evidence ?? []) m.set(e.stepNo, { actor: e.actor, at: e.createdAt });
    return m;
  }, [v]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen header={<NavBar judul={k ? k.kodePendek : "Unit"} />} refreshing={card.isRefetching} onRefresh={() => { void card.refetch(); void report.refetch(); }} bottomPad={40}>
        {card.isLoading ? <StateView kind="loading" title="Memuat unit…" /> : null}
        {card.error ? <StateView kind="error" title="Unit tidak bisa dimuat" text={pesanUntukPengguna(card.error)} onRetry={() => void card.refetch()} /> : null}

        {v && k ? (
          <>
            <Card style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <T.Title>{k.customer}{v.customer.city ? ` · ${v.customer.city}` : ""}</T.Title>
                  <T.Sub>{[k.kasur, k.layanan].filter(Boolean).join(" · ") || "Detail kasur belum dicatat"}</T.Sub>
                </View>
                {k.prioritas ? <Chip label={k.prioritas.label.toUpperCase()} tone={k.prioritas.tone} /> : null}
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {v.plan?.stationLabel ? <Chip label={`${v.plan.stationLabel}${v.plan.operator?.name ? ` · ${v.plan.operator.name}` : ""}`} tone="indigo" /> : null}
                {v.plan?.cornerOperator?.name ? <Chip label={`Corner · ${v.plan.cornerOperator.name}`} tone="teal" /> : null}
                {v.plan?.targetDate || v.plan?.productionDate ? <Chip label={`Target ${v.plan?.targetDate ?? v.plan?.productionDate}`} tone={v.plan?.targetMissed ? "red" : "gray"} /> : null}
                {v.customer.weightKg ? <Chip label={`Berat pemakai ${v.customer.weightKg} kg`} tone="purple" /> : null}
              </View>
              {k.catatan ? (
                <View style={{ backgroundColor: "#FFF8E6", borderRadius: 12, padding: 10 }}>
                  <T.Sub style={{ color: "#6B4A00" }}>Catatan Sales: {k.catatan}</T.Sub>
                </View>
              ) : null}
              {v.customer.complaints.length ? <T.Sub style={{ color: TONE.red.text }}>Keluhan: {v.customer.complaints.join(", ")}</T.Sub> : null}
            </Card>

            <Card style={{ gap: 10, backgroundColor: TONE[k.tone].tint }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <T.Headline style={{ color: TONE[k.tone].text, flex: 1 }}>{k.tahap}</T.Headline>
                {k.menit != null ? <T.Headline style={{ color: TONE[k.tone].text }}>{formatMenit(k.menit)}</T.Headline> : null}
              </View>
              {k.progres ? <ProgressBar value={k.progres.done / k.progres.total} tone={k.tone} /> : null}
              {v.shortage ? <T.Sub style={{ color: TONE.red.text }}>Bahan kurang: {v.shortage.items.map((i) => i.name).join(", ")}</T.Sub> : null}
            </Card>

            <Section
              title={`Media unit${media.length ? ` · ${media.length}` : ""}`}
              right={media.length ? (
                <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/media/[runId]", params: { runId, judul: `${kodePendek(v.unit.unitCode)} · ${k.customer}` } })} style={{ minHeight: 32, justifyContent: "center" }}>
                  <T.Caption style={{ color: TONE.blue.text }}>Lihat semua</T.Caption>
                </Pressable>
              ) : undefined}
            >
              {media.length ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {media.slice(0, 4).map((m, i) => (
                    <Thumb key={i} m={m} sisi={(width - 32 - 24) / 4} onPress={() => router.push({ pathname: "/media/[runId]", params: { runId, judul: `${kodePendek(v.unit.unitCode)} · ${k.customer}` } })} />
                  ))}
                </View>
              ) : (
                <StateView kind="empty" text={report.isLoading ? "Memuat media…" : "Belum ada foto/video untuk unit ini."} />
              )}
            </Section>

            {steps.length ? (
              <Section title={`Tahapan · ${steps.filter((s) => s.status === "DONE" || s.status === "SKIPPED").length} dari ${steps.length}`}>
                <Card style={{ paddingVertical: 8 }}>
                  {steps.map((s) => <BarisTahap key={s.no} s={s} oleh={pelaku.get(s.no)} />)}
                </Card>
              </Section>
            ) : null}

            <Card style={{ backgroundColor: TONE.blue.tint }}>
              <T.Sub style={{ color: TONE.blue.text }}>Versi ini untuk memantau. Mulai/selesai tahap dan unggah foto/video masih lewat Aplikasi Meja di SANSS Web sampai versi berikutnya.</T.Sub>
            </Card>
          </>
        ) : null}
      </Screen>
    </View>
  );
}

const GAYA: Record<StepStatus["status"], { tone: ToneKey; teks: string }> = {
  DONE: { tone: "green", teks: "Selesai" },
  SKIPPED: { tone: "gray", teks: "Dilewati" },
  CURRENT: { tone: "blue", teks: "Sekarang" },
  WAITING: { tone: "orange", teks: "Menunggu" },
  PENDING: { tone: "gray", teks: "" },
  NA: { tone: "gray", teks: "" },
};

function BarisTahap({ s, oleh }: { s: StepStatus; oleh?: { actor: string | null; at: string } }) {
  const g = GAYA[s.status];
  const t = TONE[g.tone];
  const selesai = s.status === "DONE";
  const sekarang = s.status === "CURRENT" || s.status === "WAITING";
  return (
    <View style={[{ flexDirection: "row", gap: 12, alignItems: "center", paddingVertical: 8 }, sekarang && { backgroundColor: t.tint, marginHorizontal: -10, paddingHorizontal: 10, borderRadius: 12 }]}>
      <View style={[{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" }, selesai ? { backgroundColor: t.fill } : sekarang ? { backgroundColor: t.fill } : { borderWidth: 2, borderColor: "#C7C7CC" }]}>
        {selesai ? <Check color="#fff" size={13} strokeWidth={3.5} /> : sekarang ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" }} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <T.Headline style={{ fontSize: 15, color: sekarang ? t.text : selesai ? C.ink : C.ink2 }}>{s.label}</T.Headline>
        {oleh && (selesai || s.status === "SKIPPED") ? <T.Sub style={{ fontSize: 12.5 }}>{[oleh.actor, jamWib(oleh.at)].filter(Boolean).join(" · ")}</T.Sub> : null}
      </View>
      {g.teks && !selesai ? <Chip label={g.teks} tone={g.tone} /> : null}
    </View>
  );
}
