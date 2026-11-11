import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { simpanUrutan, useBoard, type BoardStation } from "@/api/production";
import { ApiError, pesanUntukPengguna } from "@/api/errors";
import type { RunView } from "@/api/types";
import { geser, kodePendek, prioritasDari } from "@/features/model";
import { Button, Card, Chip, Divider, QueueNumber, Screen, Section, StateView, T } from "@/design/ui";
import { C, F, TONE } from "@/design/tokens";
import { deretHari, kunciTanggalWib } from "@/lib/waktu";

// TARGET — rencana per tanggal & per meja (GET /production-v2/board), urutan persis dari server.
// Admin Produksi bisa MENGATUR URUTAN satu meja (POST /production-v2/stations/reorder, daftar lengkap plan id);
// hasilnya langsung tampil di HP tim, SANSS Web, dan Andon TV. Menambah unit / mengganti PIC tetap di SANSS Web (Rencana Produksi).
export default function Target() {
  const router = useRouter();
  const hari = useMemo(() => deretHari(6, -1), []);
  const [tgl, setTgl] = useState(kunciTanggalWib());
  const q = useBoard(tgl);
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
            <Pressable key={h.kunci} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${h.hari3} ${h.tgl}`} onPress={() => setTgl(h.kunci)}
              style={{ flex: 1, height: 58, borderRadius: 14, backgroundColor: on ? TONE.blue.fill : C.card, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: F.semibold, fontSize: 12, color: on ? "#fff" : C.ink2 }}>{h.hari3}</Text>
              <Text style={{ fontFamily: F.heavy, fontSize: 19, color: on ? "#fff" : C.ink }}>{h.tgl}</Text>
            </Pressable>
          );
        })}
      </View>

      {q.isLoading ? <StateView kind="loading" title="Memuat target…" /> : null}
      {q.error ? <StateView kind="error" title="Target tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} /> : null}
      {q.data?.readerMode === "OFF" ? <StateView kind="empty" title="Produksi V2 belum aktif" /> : null}

      {stations.map((s) => <Meja key={`${tgl}-${s.code}`} s={s} tgl={tgl} buka={(runId) => router.push({ pathname: "/unit/[runId]", params: { runId } })} />)}

      <Card style={{ backgroundColor: TONE.blue.tint }}>
        <T.Sub style={{ color: TONE.blue.text }}>Tambah unit, pindah meja, dan ganti PIC lewat SANSS Web → Rencana Produksi. Perubahan dari mana pun langsung muncul di sini, di HP tim, dan di Andon TV.</T.Sub>
      </Card>
    </Screen>
  );
}

function Meja({ s, tgl, buka }: { s: BoardStation; tgl: string; buka: (runId: string) => void }) {
  const qc = useQueryClient();
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const [atur, setAtur] = useState(false);
  const [urut, setUrut] = useState<RunView[]>(s.items);
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const list = atur ? urut : s.items;
  const berubah = atur && urut.some((v, i) => v.runId !== s.items[i]?.runId);
  const bisaAtur = s.items.length > 1 && s.items.every((v) => !!v.plan?.id);

  const mulai = () => { setUrut(s.items); setGalat(null); setAtur(true); };
  const simpan = async () => {
    setBusy(true); setGalat(null);
    try {
      await simpanUrutan(tgl, s.code, urut.map((v) => v.plan!.id!), `pm-urut-${randomUUID()}`);
      await qc.invalidateQueries();
      setAtur(false);
    } catch (e) {
      setGalat(e instanceof ApiError && e.code === "STATION_ORDER_STALE" ? "Isi meja berubah sejak dimuat (ada unit masuk/keluar). Urutan dimuat ulang — atur lagi." : pesanUntukPengguna(e));
      if (e instanceof ApiError && e.code === "STATION_ORDER_STALE") { await qc.invalidateQueries({ queryKey: ["board"] }); setAtur(false); }
    } finally { setBusy(false); }
  };

  return (
    <Section
      title={`${s.label} · ${s.operatorNames.join(", ") || "PIC belum diatur"}`}
      right={bisaAtur ? (
        <Pressable accessibilityRole="button" onPress={atur ? () => setAtur(false) : mulai} style={{ minHeight: 32, justifyContent: "center", paddingHorizontal: 4 }}>
          <T.Caption style={{ color: TONE.blue.text }}>{atur ? "Batal" : "Atur urutan"}</T.Caption>
        </Pressable>
      ) : undefined}
    >
      {list.length ? (
        <Card padded={false}>
          {list.map((v, idx) => {
            const p = prioritasDari(v.priority?.key, v.plan?.priorityLabel, v.plan?.priorityRank ?? 0);
            return (
              <View key={v.runId}>
                {idx > 0 ? <Divider inset={atur ? 16 : 68} /> : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 14, minHeight: 64 }}>
                  <QueueNumber n={idx + 1} tone={p?.tone === "red" ? "red" : "indigo"} solid={p?.tone === "red"} size={32} />
                  <Pressable accessibilityRole="button" disabled={atur} onPress={() => buka(v.runId)} style={{ flex: 1, minWidth: 0 }}>
                    <T.Headline numberOfLines={1}>{kodePendek(v.unit.unitCode)} · {v.customer.name || "—"}</T.Headline>
                    <T.Sub numberOfLines={1} style={{ fontSize: 12.5 }}>{v.bucketLabel}{v.plan?.operator?.name ? ` · ${v.plan.operator.name}` : ""}</T.Sub>
                  </Pressable>
                  {atur ? (
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <Panah arah="naik" disabled={idx === 0} onPress={() => setUrut((xs) => geser(xs, idx, -1))} />
                      <Panah arah="turun" disabled={idx === list.length - 1} onPress={() => setUrut((xs) => geser(xs, idx, 1))} />
                    </View>
                  ) : p ? <Chip label={p.label} tone={p.tone} /> : null}
                </View>
              </View>
            );
          })}
        </Card>
      ) : (
        <StateView kind="empty" text="Belum ada unit di meja ini." />
      )}
      {galat ? <T.Sub style={{ color: TONE.red.text, marginTop: 8, marginHorizontal: 4 }}>{galat}</T.Sub> : null}
      {atur ? (
        <Button label="Simpan urutan & kabari tim" onPress={() => void simpan()} busy={busy} disabled={!berubah || !online} style={{ marginTop: 10 }} />
      ) : null}
    </Section>
  );
}


function Panah({ arah, onPress, disabled }: { arah: "naik" | "turun"; onPress: () => void; disabled?: boolean }) {
  const Ikon = arah === "naik" ? ChevronUp : ChevronDown;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={arah === "naik" ? "Naikkan" : "Turunkan"} disabled={disabled} onPress={onPress}
      style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: TONE.blue.tint, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.3 : 1 }}>
      <Ikon color={TONE.blue.text} size={24} strokeWidth={2.6} />
    </Pressable>
  );
}
