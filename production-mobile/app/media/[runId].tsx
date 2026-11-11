import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useReport } from "@/api/production";
import { pesanUntukPengguna } from "@/api/errors";
import { grupMedia, type GrupMedia } from "@/features/model";
import { Galeri } from "@/features/Galeri";
import { NavBar } from "@/design/NavBar";
import { Segmented } from "@/design/Segmented";
import { Screen, StateView } from "@/design/ui";
import { C } from "@/design/tokens";

// GALERI UNIT — semua foto & video unit (laporan before–process–after server, termasuk dokumentasi QC & foto pickup).
export default function MediaUnit() {
  const { runId, judul } = useLocalSearchParams<{ runId: string; judul?: string }>();
  const q = useReport(runId);
  const grup = useMemo(() => grupMedia(q.data), [q.data]);
  const [filter, setFilter] = useState<"semua" | GrupMedia["key"]>("semua");
  const tampil = filter === "semua" ? grup : grup.filter((g) => g.key === filter);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen header={<NavBar judul={judul || "Media"} />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} bottomPad={40}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[{ key: "semua", label: "Semua" }, { key: "before", label: "Sebelum" }, { key: "process", label: "Proses" }, { key: "after", label: "Sesudah" }]}
        />
        {q.isLoading ? <StateView kind="loading" title="Memuat media…" /> : null}
        {q.error ? <StateView kind="error" title="Media tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} /> : null}
        {!q.isLoading && !q.error && tampil.length === 0 ? <StateView kind="empty" title="Belum ada media" text="Foto & video akan muncul begitu tim mengunggahnya." /> : null}
        <Galeri grup={tampil} />
      </Screen>
    </View>
  );
}
