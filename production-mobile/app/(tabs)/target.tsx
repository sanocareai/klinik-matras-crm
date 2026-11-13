import React, { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronUp, Search, UserRound } from "lucide-react-native";
import { simpanUrutan } from "@/api/production";
import { useBacklog, usePapan, useSasaranJadwal } from "@/api/jadwal";
import { ApiError, pesanUntukPengguna } from "@/api/errors";
import type { RunView } from "@/api/types";
import { perhatianAdmin, sasaranDariBacklog, sasaranDariView, type MejaPapan, type Sasaran } from "@/features/jadwal";
import { geser, kodePendek, prioritasDari } from "@/features/model";
import { Button, Card, Chip, Divider, QueueNumber, Screen, Section, StateView, T } from "@/design/ui";
import { C, F, TONE } from "@/design/tokens";
import { deretHari, kunciTanggalWib } from "@/lib/waktu";

// TARGET (Admin / Kepala Produksi) — rencana per tanggal & per meja (GET /production-v2/board), urutan persis dari server.
//   • Perlu perhatian: Komplain, lewat target, tertunda, Tinggi belum dijadwalkan (hanya memberi tahu — prioritas tetap manual)
//   • Per meja: PIC bawaan, atur urutan (naik/turun), ubah jadwal per kartu
//   • Belum dijadwalkan: cari & jadwalkan ke meja (POST /production-v2/plans)
// Semua perubahan langsung tampil di HP tim, SANSS Web, dan Andon TV.
export default function Target() {
  const router = useRouter();
  const hari = useMemo(() => deretHari(6, -1), []);
  const [tgl, setTgl] = useState(kunciTanggalWib());
  const q = usePapan(tgl);
  const [cari, setCari] = useState("");
  const backlog = useBacklog(cari.trim());
  const stations = useMemo(() => q.data?.stations ?? [], [q.data]);
  const total = stations.reduce((n, s) => n + s.items.length, 0);
  const belum = useMemo(() => backlog.data?.pages.flatMap((p) => p.items) ?? [], [backlog.data]);
  const totalBelum = backlog.data?.pages[0]?.total ?? 0;
  const perhatian = useMemo(() => perhatianAdmin(stations, cari.trim() ? [] : belum), [stations, belum, cari]);
  const pilih = useSasaranJadwal((s) => s.pilih);

  const bukaUnit = (runId: string) => router.push({ pathname: "/unit/[runId]", params: { runId } });
  const bukaJadwal = (s: Sasaran) => { pilih(s, tgl); router.push("/jadwal"); };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); void backlog.refetch(); }}>
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 4 }}>
        <T.LargeTitle accessibilityRole="header">Target</T.LargeTitle>
        <T.Caption>{total} kasur{q.data?.config?.dailyTarget ? ` / target ${q.data.config.dailyTarget}` : ""}</T.Caption>
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

      {perhatian.length ? (
        <Section title={`Perlu perhatian · ${perhatian.length}`}>
          <Card padded={false}>
            {perhatian.slice(0, 8).map((p, idx) => (
              <View key={p.key}>
                {idx > 0 ? <Divider inset={56} /> : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => (p.sasaran ? bukaJadwal(p.sasaran) : p.runId ? bukaUnit(p.runId) : undefined)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 60 }}
                >
                  <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: TONE[p.tone].tint, alignItems: "center", justifyContent: "center" }}>
                    <AlertTriangle color={TONE[p.tone].text} size={18} strokeWidth={2.4} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T.Headline numberOfLines={1}>{p.kode} · {p.customer}</T.Headline>
                    <T.Sub numberOfLines={1} style={{ fontSize: 12.5, color: TONE[p.tone].text }}>{p.alasan}</T.Sub>
                  </View>
                  {p.sasaran ? <Chip label="Jadwalkan" tone="blue" /> : null}
                </Pressable>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      {stations.map((s) => (
        <Meja key={`${tgl}-${s.code}`} s={s} tgl={tgl} buka={bukaUnit} jadwal={(v) => bukaJadwal(sasaranDariView(v))}
          pic={() => router.push({ pathname: "/pic-meja", params: { kode: s.code, tgl } })} />
      ))}

      <Section title={`Belum dijadwalkan${totalBelum ? ` · ${totalBelum}` : ""}`}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.fill, borderRadius: 12, paddingHorizontal: 12, height: 44, marginBottom: 10 }}>
          <Search color={C.ink3} size={18} />
          <TextInput accessibilityLabel="Cari unit atau order" value={cari} onChangeText={setCari} placeholder="Cari kode unit / order / nama" placeholderTextColor={C.ink3}
            style={{ flex: 1, fontFamily: F.regular, fontSize: 15.5, color: C.ink }} autoCapitalize="characters" />
        </View>
        {backlog.isLoading ? <StateView kind="loading" /> : null}
        {backlog.error ? <StateView kind="error" title="Daftar tidak bisa dimuat" text={pesanUntukPengguna(backlog.error)} onRetry={() => void backlog.refetch()} /> : null}
        {backlog.data && !belum.length ? <StateView kind="empty" text={cari ? "Tidak ada yang cocok." : "Semua unit sudah dijadwalkan."} /> : null}
        {belum.length ? (
          <Card padded={false}>
            {belum.map((it, idx) => {
              const sas = sasaranDariBacklog(it);
              const pr = it.card.priority;
              return (
                <View key={it.unitId}>
                  {idx > 0 ? <Divider inset={14} /> : null}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, minHeight: 64 }}>
                    <Pressable accessibilityRole="button" disabled={!it.view} onPress={() => it.view && bukaUnit(it.view.runId)} style={{ flex: 1, minWidth: 0 }}>
                      <T.Headline numberOfLines={1}>{kodePendek(it.card.unit.unitCode)} · {it.card.customer?.name || "—"}</T.Headline>
                      <T.Sub numberOfLines={2} style={{ fontSize: 12.5 }}>
                        {[it.card.unit.merk, it.card.unit.ukuran].filter(Boolean).join(" · ") || "—"}
                        {!sas && it.rencana?.message ? ` · ${it.rencana.message}` : ""}
                      </T.Sub>
                      {pr?.key && pr.key !== "NORMAL" ? <Chip label={pr.label} tone={pr.key === "COMPLAINT" ? "red" : "orange"} style={{ marginTop: 4 }} /> : null}
                    </Pressable>
                    {sas ? (
                      <Button kind="tinted" label={sas.tanyaAktivasi ? "Aktifkan" : "Jadwalkan"} icon={<CalendarDays color={TONE.blue.text} size={18} />} onPress={() => bukaJadwal(sas)} style={{ minWidth: 128 }} />
                    ) : <Chip label="Belum bisa" tone="gray" />}
                  </View>
                </View>
              );
            })}
          </Card>
        ) : null}
        {backlog.hasNextPage ? (
          <Button kind="plain" label="Muat lagi" onPress={() => void backlog.fetchNextPage()} busy={backlog.isFetchingNextPage} style={{ marginTop: 8 }} />
        ) : null}
      </Section>
    </Screen>
  );
}

function Meja({ s, tgl, buka, jadwal, pic }: { s: MejaPapan; tgl: string; buka: (runId: string) => void; jadwal: (v: RunView) => void; pic: () => void }) {
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
  const bawaan = s.defaultPic?.active ? s.defaultPic.name : null;

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
      title={`${s.label} · ${s.items.length}/${s.capacity}`}
      right={bisaAtur ? (
        <Pressable accessibilityRole="button" onPress={atur ? () => setAtur(false) : mulai} style={{ minHeight: 32, justifyContent: "center", paddingHorizontal: 4 }}>
          <T.Caption style={{ color: TONE.blue.text }}>{atur ? "Batal" : "Atur urutan"}</T.Caption>
        </Pressable>
      ) : undefined}
    >
      <Pressable accessibilityRole="button" accessibilityLabel={`Atur PIC bawaan ${s.label}`} onPress={pic}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8, marginHorizontal: 4, minHeight: 32 }}>
        <UserRound color={bawaan ? TONE.indigo.text : TONE.orange.text} size={17} />
        <T.Sub style={{ flex: 1, color: bawaan ? C.ink2 : TONE.orange.text }} numberOfLines={1}>
          {bawaan ? `PIC bawaan: ${bawaan}` : "PIC bawaan belum diatur"}{s.operatorNames.length && !bawaan ? ` · ${s.operatorNames.join(", ")}` : ""}
        </T.Sub>
        <T.Caption style={{ color: TONE.blue.text }}>Ubah</T.Caption>
      </Pressable>

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
                    <T.Sub numberOfLines={1} style={{ fontSize: 12.5 }}>
                      {v.bucketLabel}{v.plan?.operator?.name ? ` · ${v.plan.operator.name}` : ""}{v.plan?.targetMissed ? " · lewat target" : ""}
                    </T.Sub>
                    {p ? <Chip label={p.label} tone={p.tone} style={{ marginTop: 4 }} /> : null}
                  </Pressable>
                  {atur ? (
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <Panah arah="naik" disabled={idx === 0} onPress={() => setUrut((xs) => geser(xs, idx, -1))} />
                      <Panah arah="turun" disabled={idx === list.length - 1} onPress={() => setUrut((xs) => geser(xs, idx, 1))} />
                    </View>
                  ) : v.plan?.id ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Ubah jadwal ${kodePendek(v.unit.unitCode)}`} onPress={() => jadwal(v)}
                      style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: TONE.blue.tint, alignItems: "center", justifyContent: "center" }}>
                      <CalendarDays color={TONE.blue.text} size={22} />
                    </Pressable>
                  ) : null}
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
