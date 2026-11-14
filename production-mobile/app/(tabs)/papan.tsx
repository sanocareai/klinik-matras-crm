import React, { useMemo } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { AlertTriangle, ChevronRight } from "lucide-react-native";
import { useAndon } from "@/api/production";
import { pesanUntukPengguna } from "@/api/errors";
import { formatMenit, ringkasPapan } from "@/features/model";
import { perluPerhatian, ringkasMeja } from "@/features/papan";
import { Card, Chip, Divider, Screen, Section, StateView, T } from "@/design/ui";
import { C, TONE } from "@/design/tokens";
import { Denyut } from "@/design/gerak";
import { jamWib } from "@/lib/waktu";

// PAPAN — live per meja hari ini (sumber sama dengan Andon TV: GET /production-v2/andon), diperbarui tiap 20 detik.
export default function Papan() {
  const router = useRouter();
  const q = useAndon();
  const b = q.data;
  const kpi = ringkasPapan(b);
  const meja = useMemo(() => (b?.stations ?? []).map(ringkasMeja), [b]);
  const perhatian = useMemo(() => perluPerhatian(b?.stations ?? []), [b]);
  const buka = (runId: string) => router.push({ pathname: "/unit/[runId]", params: { runId } });

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <View style={{ paddingHorizontal: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {q.error ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: TONE.red.fill }} /> : <Denyut warna={TONE.green.fill} />}
          <T.Caption style={{ color: q.error ? TONE.red.text : TONE.green.text }}>
            {q.error ? "TERPUTUS — menampilkan data terakhir" : `LIVE · diperbarui ${jamWib(b?.generatedAt)}`}
          </T.Caption>
        </View>
        <T.LargeTitle accessibilityRole="header">Papan Produksi</T.LargeTitle>
      </View>

      {q.isLoading ? <StateView kind="loading" title="Memuat papan…" /> : null}
      {q.error && !b ? <StateView kind="error" title="Papan tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} /> : null}
      {b?.readerMode === "OFF" ? <StateView kind="empty" title="Produksi V2 belum aktif" text="Papan live tampil setelah unit masuk Produksi V2 di SANSS Web." /> : null}

      {b && b.readerMode !== "OFF" ? (
        <>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Kpi n={kpi.target} label="Target" />
            <Kpi n={kpi.selesai} label="Selesai" tone="green" />
            <Kpi n={kpi.dikerjakan} label="Dikerjakan" tone="blue" />
            <Kpi n={kpi.terhambat} label="Terhambat" tone="red" />
          </View>

          {perhatian.length ? (
            <Section title="Butuh perhatian">
              <Card padded={false} style={{ borderWidth: 1.5, borderColor: "#FFB3B8" }}>
                {perhatian.map((p, i) => (
                  <View key={p.runId}>
                    {i > 0 ? <Divider inset={62} /> : null}
                    <Pressable accessibilityRole="button" onPress={() => buka(p.runId)} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, minHeight: 64 }}>
                      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: TONE[p.tone].fill, alignItems: "center", justifyContent: "center" }}>
                        <AlertTriangle color="#fff" size={20} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <T.Headline numberOfLines={1}>{p.kode} · {p.customer}</T.Headline>
                        <T.Sub numberOfLines={1}>{p.alasan} · {p.meja}</T.Sub>
                      </View>
                      <ChevronRight color={C.ink3} size={20} />
                    </Pressable>
                  </View>
                ))}
              </Card>
            </Section>
          ) : null}

          <Section title="Per meja · sekarang">
            <Card padded={false}>
              {meja.map((m, i) => (
                <View key={m.code}>
                  {i > 0 ? <Divider inset={64} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    disabled={!m.sekarang}
                    onPress={m.sekarang ? () => buka(m.sekarang!.runId) : undefined}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, minHeight: 64 }}
                  >
                    <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: m.code.toUpperCase().includes("CORNER") ? TONE.teal.fill : TONE.indigo.fill, alignItems: "center", justifyContent: "center" }}>
                      <T.Headline style={{ color: "#fff", fontSize: 13 }}>{m.jumlah}</T.Headline>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T.Headline numberOfLines={1}>{m.label} · {m.pic}</T.Headline>
                      <T.Sub numberOfLines={1}>{m.sekarang ? `${m.sekarang.kode} · ${m.sekarang.tahap}` : "Tidak ada yang sedang dikerjakan"}</T.Sub>
                    </View>
                    {m.status === "kosong" ? <Chip label="Kosong" /> : m.status === "terhambat" ? <Chip label="Terhambat" tone="red" /> : <Chip label={formatMenit(m.sekarang?.menit)} tone={m.sekarang?.tone ?? "blue"} />}
                  </Pressable>
                </View>
              ))}
            </Card>
          </Section>
        </>
      ) : null}
    </Screen>
  );
}

function Kpi({ n, label, tone }: { n: number; label: string; tone?: "green" | "blue" | "red" }) {
  return (
    <Card style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 12 }}>
      <T.Title style={{ fontSize: 26, color: tone ? TONE[tone].text : C.ink, fontVariant: ["tabular-nums"] }}>{n}</T.Title>
      <T.Caption style={{ color: C.ink2, fontSize: 12 }}>{label}</T.Caption>
    </Card>
  );
}
