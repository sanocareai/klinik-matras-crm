import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, Ruler } from "lucide-react-native";
import { useAntreanUji } from "@/api/komponen";
import { BAGIAN_KOMPONEN, type KunciBagian } from "@/features/komponen";
import { useQcQueue } from "@/api/qc";
import { pesanUntukPengguna } from "@/api/errors";
import { kodePendek } from "@/features/model";
import { Baris, Chip, KepalaJudul, KeteranganPanel, PilLive, QueueNumber, Screen, Section, StateView, TeksBaris } from "@/design/ui";
import { C, TONE } from "@/design/tokens";

// QC — (1) PENGUJIAN yang ditunggu kartu (Catatan Komponen PIC QC: QC sebelum bongkar, uji fondasi awal/baru, uji kasur jadi —
//          GET /production-v2/component-notes/qc-queue) dan (2) antrean putusan Uji Berat Badan (GET /production-planning/qc/queue). Live 20 detik.
// Tampilan mengikuti mockup "Antrean uji": panel kaca, baris putih bernomor (nomor 1 = bola biru).
export default function Qc() {
  const router = useRouter();
  const q = useQcQueue();
  const items = q.data?.items ?? [];
  const uji = useAntreanUji();
  const ujiItems = (uji.data?.items ?? []).filter((x) => x.section !== "QC_DECISION");
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); void uji.refetch(); }}>
      <KepalaJudul keterangan={`${items.length} menunggu putusan`} judul="QC" kanan={<View style={{ paddingBottom: 8 }}><PilLive putus={!!q.error} /></View>} />

      {ujiItems.length ? (
        <Section title="Pengujian ditunggu" right={<KeteranganPanel>{ujiItems.length} unit</KeteranganPanel>}>
          {ujiItems.map((it) => (
            <Baris key={`${it.runId}-${it.section}`} onPress={() => router.push({ pathname: "/komponen/[unitId]", params: { unitId: it.unitId, bagian: it.section, runId: it.runId } })}>
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: TONE.blue.tint, alignItems: "center", justifyContent: "center" }}>
                <Ruler color={TONE.blue.text} size={18} strokeWidth={2.2} />
              </View>
              <TeksBaris judul={`${kodePendek(it.unitCode)}${it.station ? ` · ${it.station}` : ""}`} sub={BAGIAN_KOMPONEN[it.section as KunciBagian]?.label ?? it.section} />
              <ChevronRight color={C.ink3} size={18} />
            </Baris>
          ))}
        </Section>
      ) : null}

      {q.isLoading ? <StateView kind="loading" title="Memuat antrean QC…" /> : null}
      {q.error ? <StateView kind="error" title="Antrean QC tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} /> : null}
      {!q.isLoading && !q.error ? (
        <Section title="Antrean uji" right={<KeteranganPanel>urut terlama</KeteranganPanel>}>
          {items.length ? items.map((it, i) => (
            <Baris key={it.runId} accessibilityLabel={`Putuskan QC ${it.unit.unitCode}`} onPress={() => router.push({ pathname: "/qc/[runId]", params: { runId: it.runId } })}>
              <QueueNumber n={i + 1} solid={i === 0} />
              <TeksBaris judul={kodePendek(it.unit.unitCode)} sub={it.unit.orderNumber ?? it.unit.unitCode} />
              {it.conflict ? <Chip label="Konflik" tone="orange" /> : <Chip label="Siap diuji" />}
            </Baris>
          )) : (
            <StateView kind="empty" title="Tidak ada yang menunggu QC" text="Unit muncul di sini begitu Meja menyelesaikan lapisan & uji kasur jadi." />
          )}
        </Section>
      ) : null}
    </Screen>
  );
}
