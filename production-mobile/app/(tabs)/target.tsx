import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useAndon } from "@/api/production";
import { pesanUntukPengguna } from "@/api/errors";
import { kodePendek, prioritasDari } from "@/features/model";
import { Card, Chip, Divider, QueueNumber, Screen, Section, StateView, T } from "@/design/ui";
import { C, F, TONE } from "@/design/tokens";
import { deretHari, kunciTanggalWib } from "@/lib/waktu";

// TARGET — rencana produksi per tanggal & per meja, urutan persis dari server (sumber sama dengan HP tim & Andon TV).
// Tahap ini BACA-SAJA: mengubah urutan/PIC/menambah unit dilakukan di SANSS Web (Rencana Produksi) dan
// langsung terlihat di sini. Mengedit dari app menyusul di tahap berikutnya.
export default function Target() {
  const router = useRouter();
  const hari = useMemo(() => deretHari(6, -1), []);
  const [tgl, setTgl] = useState(kunciTanggalWib());
  const q = useAndon(tgl);
  const stations = q.data?.stations ?? [];
  const total = stations.reduce((n, s) => n + s.items.length, 0);

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 4 }}>
        <T.LargeTitle accessibilityRole="header">Target</T.LargeTitle>
        <T.Caption>{total} kasur</T.Caption>
      </View>

      <View style={{ flexDirection: "row", gap: 6 }}>
        {hari.map((h) => {
          const on = h.kunci === tgl;
          return (
            <Pressable
              key={h.kunci}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${h.hari3} ${h.tgl}`}
              onPress={() => setTgl(h.kunci)}
              style={{ flex: 1, height: 58, borderRadius: 14, backgroundColor: on ? TONE.blue.fill : C.card, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ fontFamily: F.semibold, fontSize: 12, color: on ? "#fff" : C.ink2 }}>{h.hari3}</Text>
              <Text style={{ fontFamily: F.heavy, fontSize: 19, color: on ? "#fff" : C.ink }}>{h.tgl}</Text>
            </Pressable>
          );
        })}
      </View>

      {q.isLoading ? <StateView kind="loading" title="Memuat target…" /> : null}
      {q.error ? <StateView kind="error" title="Target tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} /> : null}

      {stations.map((s) => (
        <Section key={s.code} title={`${s.label} · ${s.operatorNames.join(", ") || "PIC belum diatur"}`}>
          {s.items.length ? (
            <Card padded={false}>
              {s.items.map((i, idx) => {
                const p = prioritasDari(null, i.priorityLabel, i.priority);
                return (
                  <View key={i.runId}>
                    {idx > 0 ? <Divider inset={68} /> : null}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => router.push({ pathname: "/unit/[runId]", params: { runId: i.runId } })}
                      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 14, minHeight: 64 }}
                    >
                      <QueueNumber n={idx + 1} tone={p?.tone === "red" ? "red" : "indigo"} solid={p?.tone === "red"} size={32} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T.Headline numberOfLines={1}>{kodePendek(i.unitCode)} · {i.customerName || "—"}</T.Headline>
                        <T.Sub numberOfLines={1} style={{ fontSize: 12.5 }}>{i.bucketLabel}{i.operatorName ? ` · ${i.operatorName}` : ""}</T.Sub>
                      </View>
                      {p ? <Chip label={p.label} tone={p.tone} /> : null}
                    </Pressable>
                  </View>
                );
              })}
            </Card>
          ) : (
            <StateView kind="empty" text="Belum ada unit di meja ini." />
          )}
        </Section>
      ))}

      <Card style={{ backgroundColor: TONE.blue.tint }}>
        <T.Sub style={{ color: TONE.blue.text }}>Atur urutan, PIC, dan tambah unit lewat SANSS Web → Rencana Produksi. Perubahan langsung muncul di sini, di HP tim, dan di Andon TV.</T.Sub>
      </Card>
    </Screen>
  );
}
