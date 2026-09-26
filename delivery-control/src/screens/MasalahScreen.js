import React, { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ISSUE_STATUS, JOB_TYPE, issueStatusInfo, jobStatusInfo } from "@sano/delivery-shared";
import { operasionalApi } from "../client";
import { useMuat } from "../useMuat";
import { tanggalWIB, waktuWIB } from "../format";
import { elevation, radius, type, useTheme } from "../theme";
import { Icon } from "../icons";
import { Btn, Chip, IconBox, StateView } from "../ui";

// Masalah: GET /armada/issues?status=OPEN|RESCHEDULED (job gagal & riwayat jadwal ulang). Baca di sini;
// penjadwalan ulang di layar detail (job:write, hanya job berstatus Gagal — ditegakkan server).
const TAB = Object.keys(ISSUE_STATUS);

export default function MasalahScreen({ navigation }) {
  const t = useTheme();
  const [tab, setTab] = useState("OPEN");
  const q = useMuat(() => operasionalApi.masalah(tab), [tab], navigation);
  const jobs = q.data?.jobs || [];

  return (
    <SafeAreaView style={[s.root, { backgroundColor: t.bg }]} edges={["bottom"]}>
      <FlatList
        data={q.status === "siap" ? jobs : []}
        keyExtractor={(j) => j.id}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={q.segar} onRefresh={q.segarkan} tintColor={t.accent} colors={[t.accent]} />}
        ListHeaderComponent={
          <View style={s.tabs}>
            {TAB.map((k) => {
              const aktif = tab === k;
              return (
                <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: aktif }}
                  style={[s.tab, { backgroundColor: aktif ? t.tabActive : t.surface, borderColor: aktif ? t.tabActive : t.border }]}>
                  <Text style={{ color: aktif ? t.tabActiveInk : t.ink2, fontWeight: "700", fontSize: 13 }}>{ISSUE_STATUS[k].label}</Text>
                </Pressable>
              );
            })}
          </View>
        }
        ListEmptyComponent={q.status === "memuat" ? <StateView loading title="Memuat masalah…" /> : q.status === "gagal" ? (
          <StateView icon="alert" tone="red" title="Masalah belum dapat dimuat" message={q.error} action={<Btn title="Coba lagi" icon="refresh" kind="secondary" onPress={() => q.muat()} />} />
        ) : <StateView icon="checkCircle" tone="green" title={tab === "OPEN" ? "Tidak ada job gagal" : "Belum ada riwayat jadwal ulang"} />}
        renderItem={({ item: j }) => {
          const is = issueStatusInfo(j.issueStatus);
          const js = jobStatusInfo(j.status);
          return (
            <Pressable onPress={() => navigation.navigate("MasalahDetail", { job: j })} accessibilityRole="button"
              style={({ pressed }) => [s.item, { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.9 : 1 }, elevation(t, 1)]}>
              <IconBox name={j.status === "FAILED" ? "alert" : "calendar"} tone={is.tone} size={42} />
              <View style={{ flex: 1, gap: 3 }}>
                <View style={s.row}>
                  <Text style={[type.label, { color: t.ink, fontSize: 15, flex: 1 }]} numberOfLines={1}>{j.order?.customer?.name || j.order?.orderNumber || "Job"}</Text>
                  <Chip label={js.label} tone={js.tone} size="sm" />
                </View>
                <Text style={{ color: t.ink2, fontSize: 12 }} numberOfLines={1}>{JOB_TYPE[j.type] || j.type} · {j.order?.orderNumber || "-"} · {j.driver?.name || "tanpa driver"}</Text>
                {!!j.failureReason && <Text style={{ color: t.red, fontSize: 12 }} numberOfLines={2}>Gagal: {j.failureReason}</Text>}
                {!!j.rescheduleReason && <Text style={{ color: t.orange, fontSize: 12 }} numberOfLines={2}>Jadwal ulang ke {tanggalWIB(j.scheduledDate)}: {j.rescheduleReason}</Text>}
                <Text style={{ color: t.ink3, fontSize: 11 }}>Diperbarui {waktuWIB(j.updatedAt)}</Text>
              </View>
              <Icon name="chevronRight" size={18} color={t.ink3} />
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  list: { padding: 18, gap: 10, paddingBottom: 32 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 4 },
  tab: { borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 9, borderWidth: 1 },
  item: { flexDirection: "row", gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
});
