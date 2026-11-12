import React from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, Ruler, ShieldCheck } from "lucide-react-native";
import { useAntreanUji } from "@/api/komponen";
import { BAGIAN_KOMPONEN, type KunciBagian } from "@/features/komponen";
import { useQcQueue } from "@/api/qc";
import { pesanUntukPengguna } from "@/api/errors";
import { kodePendek } from "@/features/model";
import { Card, Chip, Divider, Screen, StateView, T } from "@/design/ui";
import { C, TONE } from "@/design/tokens";

// QC — (1) PENGUJIAN yang ditunggu kartu (Catatan Komponen PIC QC: QC sebelum bongkar, uji fondasi awal/baru, uji kasur jadi —
//          GET /production-v2/component-notes/qc-queue) dan (2) antrean putusan Uji Berat Badan (GET /production-planning/qc/queue). Live 20 detik.
export default function Qc() {
  const router = useRouter();
  const q = useQcQueue();
  const items = q.data?.items ?? [];
  const uji = useAntreanUji();
  const ujiItems = (uji.data?.items ?? []).filter((x) => x.section !== "QC_DECISION");
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); void uji.refetch(); }}>
      <View style={{ paddingHorizontal: 4 }}>
        <T.Eyebrow>{items.length} menunggu putusan</T.Eyebrow>
        <T.LargeTitle accessibilityRole="header">QC</T.LargeTitle>
      </View>
      {ujiItems.length ? (
        <>
          <T.Headline style={{ marginHorizontal: 6 }}>Pengujian ditunggu · {ujiItems.length}</T.Headline>
          <Card padded={false}>
            {ujiItems.map((it, i) => (
              <View key={`${it.runId}-${it.section}`}>
                {i > 0 ? <Divider inset={68} /> : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: "/komponen/[unitId]", params: { unitId: it.unitId, bagian: it.section, runId: it.runId } })}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, minHeight: 68 }}
                >
                  <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: TONE.teal.fill, alignItems: "center", justifyContent: "center" }}>
                    <Ruler color="#fff" size={22} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T.Headline numberOfLines={1}>{kodePendek(it.unitCode)}{it.station ? ` · ${it.station}` : ""}</T.Headline>
                    <T.Sub numberOfLines={1} style={{ fontSize: 12.5 }}>{BAGIAN_KOMPONEN[it.section as KunciBagian]?.label ?? it.section}</T.Sub>
                  </View>
                  <ChevronRight color={C.ink3} size={20} />
                </Pressable>
              </View>
            ))}
          </Card>
          <T.Headline style={{ marginHorizontal: 6, marginTop: 6 }}>Putusan QC</T.Headline>
        </>
      ) : null}
      {q.isLoading ? <StateView kind="loading" title="Memuat antrean QC…" /> : null}
      {q.error ? <StateView kind="error" title="Antrean QC tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} /> : null}
      {!q.isLoading && !q.error && items.length === 0 ? <StateView kind="empty" title="Tidak ada yang menunggu QC" text="Unit muncul di sini begitu Meja menyelesaikan lapisan & uji kasur jadi." /> : null}
      {items.length ? (
        <Card padded={false}>
          {items.map((it, i) => (
            <View key={it.runId}>
              {i > 0 ? <Divider inset={68} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Putuskan QC ${it.unit.unitCode}`}
                onPress={() => router.push({ pathname: "/qc/[runId]", params: { runId: it.runId } })}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, minHeight: 68 }}
              >
                <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: TONE.purple.fill, alignItems: "center", justifyContent: "center" }}>
                  <ShieldCheck color="#fff" size={24} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T.Headline numberOfLines={1}>{kodePendek(it.unit.unitCode)}</T.Headline>
                  <T.Sub numberOfLines={1} style={{ fontSize: 12.5 }}>{it.unit.orderNumber ?? it.unit.unitCode}</T.Sub>
                </View>
                {it.conflict ? <Chip label="Konflik" tone="red" /> : <Chip label="Siap diuji" tone="purple" />}
                <ChevronRight color={C.ink3} size={20} />
              </Pressable>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
