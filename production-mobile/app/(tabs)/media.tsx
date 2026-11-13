import React, { useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, Image as ImageIcon, Search } from "lucide-react-native";
import { useAndon } from "@/api/production";
import { pesanUntukPengguna } from "@/api/errors";
import { kodePendek } from "@/features/model";
import { Card, Divider, Screen, StateView, T } from "@/design/ui";
import { C, F, TONE } from "@/design/tokens";

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
      <T.LargeTitle accessibilityRole="header" style={{ marginHorizontal: 4 }}>Media</T.LargeTitle>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 44, borderRadius: 12, backgroundColor: C.fill, paddingHorizontal: 12 }}>
        <Search color={C.ink3} size={18} />
        <TextInput
          accessibilityLabel="Cari unit atau customer"
          placeholder="Cari unit / customer"
          placeholderTextColor={C.ink3}
          value={cari}
          onChangeText={setCari}
          style={{ flex: 1, fontFamily: F.regular, fontSize: 16, color: C.ink }}
        />
      </View>

      {q.isLoading ? <StateView kind="loading" title="Memuat unit…" /> : null}
      {q.error ? <StateView kind="error" title="Unit tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} /> : null}
      {!q.isLoading && !q.error && units.length === 0 ? <StateView kind="empty" title="Tidak ada unit" text={cari ? "Tidak ada yang cocok dengan pencarian." : "Belum ada unit di papan hari ini."} /> : null}

      {units.length ? (
        <Card padded={false}>
          {units.map((u, i) => (
            <View key={u.runId}>
              {i > 0 ? <Divider inset={68} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Media ${u.unitCode}`}
                onPress={() => router.push({ pathname: "/media/[runId]", params: { runId: u.runId, judul: `${kodePendek(u.unitCode)} · ${u.customerName ?? ""}` } })}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, minHeight: 64 }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: TONE.purple.tint, alignItems: "center", justifyContent: "center" }}>
                  <ImageIcon color={TONE.purple.text} size={22} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T.Headline numberOfLines={1}>{kodePendek(u.unitCode)} · {u.customerName || "—"}</T.Headline>
                  <T.Sub numberOfLines={1} style={{ fontSize: 12.5, color: C.ink2 }}>{u.meja} · {u.bucketLabel}</T.Sub>
                </View>
                <ChevronRight color={C.ink3} size={20} />
              </Pressable>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
