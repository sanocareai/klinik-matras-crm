import React, { useMemo } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check } from "lucide-react-native";
import { useReport, useRunCard } from "@/api/production";
import { pesanUntukPengguna } from "@/api/errors";
import type { StepStatus } from "@/api/types";
import { beratPemakai, formatMenit, grupMedia, kartuDariV2, kodePendek } from "@/features/model";
import { Thumb } from "@/features/Galeri";
import { BarAksi } from "@/features/BarAksi";
import { PanelKomponen, PanelPengerjaan } from "@/features/PanelPengerjaan";
import { NavBar } from "@/design/NavBar";
import { Card, Chip, KeteranganPanel, Screen, Section, StateView, T } from "@/design/ui";
import { C, F, TONE, type ToneKey } from "@/design/tokens";
import { jamWib } from "@/lib/waktu";

// DETAIL UNIT — kartu kerja V2 (GET /production-v2/runs/:runId/card) + media laporan, live 20 detik.
// Batang aksi bawah (BarAksi): satu tombol sesuai `next` server + Tunda; formulir tahap di /langkah/[runId].
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
  const berat = v ? beratPemakai(v.customer) : [];
  const pelaku = useMemo(() => {
    const m = new Map<number, { actor: string | null; at: string }>();
    for (const e of v?.evidence ?? []) m.set(e.stepNo, { actor: e.actor, at: e.createdAt });
    return m;
  }, [v]);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen header={<NavBar judul="Detail unit" />} refreshing={card.isRefetching} onRefresh={() => { void card.refetch(); void report.refetch(); }} bottomPad={170}>
        {card.isLoading ? <StateView kind="loading" title="Memuat unit…" /> : null}
        {card.error ? <StateView kind="error" title="Unit tidak bisa dimuat" text={pesanUntukPengguna(card.error)} onRetry={() => void card.refetch()} /> : null}

        {v && k ? (
          <>
            {/* mockup Detail Unit: chip → kode 26/800 → keterangan 14 → dua kartu kaca (Berat badan · Keluhan) */}
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {v.plan?.stationLabel ? <Chip label={`${v.plan.stationLabel}${v.plan.operator?.name ? ` · ${v.plan.operator.name}` : ""}`} tone="blue" /> : null}
                {v.plan?.cornerOperator?.name ? <Chip label={`Corner · ${v.plan.cornerOperator.name}`} tone="blue" /> : null}
                {k.layanan ? <Chip label={k.layanan} tone="green" /> : null}
                {k.prioritas ? <Chip label={k.prioritas.label} tone={k.prioritas.tone} /> : null}
                {v.plan?.targetDate || v.plan?.productionDate ? <Chip label={`Target ${v.plan?.targetDate ?? v.plan?.productionDate}`} tone={v.plan?.targetMissed ? "orange" : "gray"} /> : null}
              </View>
              <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1.2} style={{ fontFamily: F.heavy, fontSize: 26, letterSpacing: -0.5, color: C.white }}>{v.unit.unitCode}</Text>
              <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ fontFamily: F.medium, fontSize: 14, color: "#DCEBFF" }}>
                {[k.kasur, `${k.customer}${v.customer.city ? ` (${v.customer.city})` : ""}`].filter(Boolean).join(" · ") || "Detail kasur belum dicatat"}
              </Text>
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Card style={{ flex: 1, borderRadius: 20, gap: 4 }}>
                <T.RowSub style={{ fontFamily: F.medium }}>Berat badan</T.RowSub>
                {berat.length ? berat.map((b) => <T.Row key={b.label} style={{ fontSize: 15 }}>{b.label} {b.kg} kg</T.Row>) : <T.Row style={{ fontSize: 14, color: TONE.orange.text }}>Belum diisi Sales</T.Row>}
              </Card>
              <Card style={{ flex: 1, borderRadius: 20, gap: 4 }}>
                <T.RowSub style={{ fontFamily: F.medium }}>Keluhan</T.RowSub>
                <T.Row style={{ fontSize: 14, lineHeight: 19, fontFamily: F.semibold }}>{v.customer.complaints.length ? v.customer.complaints.join(", ") : "Tidak ada catatan keluhan"}</T.Row>
              </Card>
            </View>
            {k.catatan ? (
              <Card style={{ borderRadius: 20, gap: 4 }}>
                <T.RowSub style={{ fontFamily: F.medium }}>Catatan Sales</T.RowSub>
                <T.Row style={{ fontSize: 14, lineHeight: 19, fontFamily: F.semibold }}>{k.catatan}</T.Row>
              </Card>
            ) : null}

            <Section
              title={`Media unit${media.length ? ` · ${media.length}` : ""}`}
              right={media.length ? (
                <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: "/media/[runId]", params: { runId, judul: `${kodePendek(v.unit.unitCode)} · ${k.customer}` } })} style={{ minHeight: 32, justifyContent: "center" }}>
                  <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.bold, fontSize: 13, color: TONE.blue.text }}>Lihat semua</Text>
                </Pressable>
              ) : undefined}
            >
              {media.length ? (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {media.slice(0, 4).map((m, i) => (
                    <Thumb key={i} m={m} sisi={(width - 40 - 30 - 24) / 4} onPress={() => router.push({ pathname: "/media/[runId]", params: { runId, judul: `${kodePendek(v.unit.unitCode)} · ${k.customer}` } })} />
                  ))}
                </View>
              ) : (
                <StateView kind="empty" text={report.isLoading ? "Memuat media…" : "Belum ada foto/video untuk unit ini."} />
              )}
            </Section>

            <PanelPengerjaan card={v} />

            {steps.length ? (
              <Section title="Perjalanan unit" right={<KeteranganPanel>{steps.filter((x) => x.status === "DONE" || x.status === "SKIPPED").length} / {steps.length}{k.menit != null ? ` · ${formatMenit(k.menit)}` : ""}</KeteranganPanel>}>
                <Card style={{ paddingTop: 14, paddingBottom: 2, paddingHorizontal: 14 }}>
                  {v.shortage ? <T.RowSub style={{ color: TONE.orange.text, fontSize: 13, marginBottom: 10 }}>Bahan kurang: {v.shortage.items.map((i) => i.name).join(", ")}</T.RowSub> : null}
                  {steps.map((x, i) => <BarisTahap key={x.no} s={x} oleh={pelaku.get(x.no)} akhir={i === steps.length - 1} />)}
                </Card>
              </Section>
            ) : null}

            <PanelKomponen card={v} />
          </>
        ) : null}
      </Screen>
      {v ? <BarAksi card={v} onBerubah={() => { void card.refetch(); void report.refetch(); }} /> : null}
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

/** Satu titik di garis waktu (mockup "Perjalanan unit"): bulatan 22 + garis penghubung 2px, judul 14/600, keterangan 12. */
function BarisTahap({ s, oleh, akhir }: { s: StepStatus; oleh?: { actor: string | null; at: string }; akhir?: boolean }) {
  const g = GAYA[s.status];
  const selesai = s.status === "DONE";
  const sekarang = s.status === "CURRENT" || s.status === "WAITING";
  const ket = selesai || s.status === "SKIPPED"
    ? [s.status === "SKIPPED" ? "Dilewati" : null, oleh?.actor, oleh ? jamWib(oleh.at) : null].filter(Boolean).join(" · ")
    : sekarang ? (s.status === "WAITING" ? "Menunggu" : "Sedang dikerjakan") : "";
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ alignItems: "center" }}>
        <View style={[{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
          selesai ? { backgroundColor: "#34C759" } : sekarang ? { backgroundColor: C.white, borderWidth: 2, borderColor: TONE[g.tone].fill } : { backgroundColor: "#E6EEF8" }]}>
          {selesai ? <Check color="#fff" size={13} strokeWidth={3} /> : sekarang ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: TONE[g.tone].fill }} /> : null}
        </View>
        {akhir ? null : <View style={{ width: 2, flex: 1, minHeight: 10, backgroundColor: "#D5E2F2" }} />}
      </View>
      <View style={{ flex: 1, paddingBottom: 12 }}>
        <T.Row style={{ fontFamily: F.semibold, color: sekarang ? TONE[g.tone].text : selesai ? C.ink : C.ink3 }}>{s.label}</T.Row>
        {ket ? <T.RowSub style={{ fontFamily: F.medium }}>{ket}</T.RowSub> : null}
      </View>
    </View>
  );
}
