import React, { useMemo, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, Image as ImageIcon } from "lucide-react-native";
import { useAndon } from "@/api/production";
import { pesanUntukPengguna } from "@/api/errors";
import { kodePendek } from "@/features/model";
import { Baris, KepalaJudul, KeteranganPanel, KolomCari, Screen, Section, StateView, TeksBaris } from "@/design/ui";
import { C, TONE } from "@/design/tokens";

// MEDIA — pilih unit (yang ada di papan hari ini), lalu buka galeri foto/video Sebelum · Proses · Sesudah.
export default function Media() {
  const router = useRouter();
  const q = useAndon();
  const [cari, setCari] = useState("");
  const units = useMemo(() => {
    const all = (q.data?.stations ?? []).flatMap((s) => s.items.map((i) => ({ ...i, meja: s.label })));
    const k = cari.trim().toLowerCase();
    return k ? all.filter((u) => `${u.unitCode} ${u.customerName ?? ""}`.toLowerCase().includes(k)) : all;
  }, [q.data, cari]);

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <KepalaJudul keterangan="Foto & video per unit" judul="Media" />
      <KolomCari accessibilityLabel="Cari unit atau customer" placeholder="Cari unit / customer" value={cari} onChangeText={setCari} />

      {q.isLoading ? <StateView kind="loading" title="Memuat unit…" /> : null}
      {q.error ? <StateView kind="error" title="Unit tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} /> : null}
      {!q.isLoading && !q.error && units.length === 0 ? <StateView kind="empty" title="Tidak ada unit" text={cari ? "Tidak ada yang cocok dengan pencarian." : "Belum ada unit di papan hari ini."} /> : null}

      {units.length ? (
        <Section title="Unit di papan hari ini" right={<KeteranganPanel>{units.length} unit</KeteranganPanel>}>
          {units.map((u) => (
            <Baris key={u.runId} accessibilityLabel={`Media ${u.unitCode}`}
              onPress={() => router.push({ pathname: "/media/[runId]", params: { runId: u.runId, judul: `${kodePendek(u.unitCode)} · ${u.customerName ?? ""}` } })}>
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: TONE.blue.tint, alignItems: "center", justifyContent: "center" }}>
                <ImageIcon color={TONE.blue.text} size={18} strokeWidth={2.2} />
              </View>
              <TeksBaris judul={`${kodePendek(u.unitCode)} · ${u.customerName || "—"}`} sub={`${u.meja} · ${u.bucketLabel}`} />
              <ChevronRight color={C.ink3} size={18} />
            </Baris>
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}
