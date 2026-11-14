import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { AlertTriangle, CalendarDays, ChevronDown, ChevronUp, UserRound } from "lucide-react-native";
import { simpanUrutan } from "@/api/production";
import { useBacklog, usePapan, useSasaranJadwal } from "@/api/jadwal";
import { ApiError, pesanUntukPengguna } from "@/api/errors";
import type { RunView } from "@/api/types";
import { perhatianAdmin, sasaranDariBacklog, sasaranDariView, type MejaPapan, type Sasaran } from "@/features/jadwal";
import { geser, kodePendek, prioritasDari } from "@/features/model";
import { Baris, Button, Chip, HeroCard, KepalaJudul, KeteranganPanel, KolomCari, QueueNumber, Screen, Section, StateView, T } from "@/design/ui";
import { Segmented } from "@/design/Segmented";
import { C, F, KACA, TONE } from "@/design/tokens";
import { deretHari, kunciTanggalWib } from "@/lib/waktu";

// TARGET (Admin / Kepala Produksi) — rencana per tanggal & per meja (GET /production-v2/board), urutan persis dari server.
//   • Perlu perhatian: Komplain, lewat target, tertunda, Tinggi belum dijadwalkan (hanya memberi tahu — prioritas tetap manual)
//   • Per meja: PIC bawaan, atur urutan (naik/turun), ubah jadwal per kartu
//   • Belum dijadwalkan: cari & jadwalkan ke meja (POST /production-v2/plans)
// Semua perubahan langsung tampil di HP tim, SANSS Web, dan Andon TV.
// Tampilan mengikuti mockup v2: kartu kaca ringkasan, lalu PANEL KACA per bagian berisi BARIS PUTIH.
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
  // Dua tampilan (bukan satu halaman panjang): rencana per meja, atau daftar yang belum dijadwalkan.
  const [tampil, setTampil] = useState<"meja" | "belum">("meja");
  const hariDipilih = hari.find((h) => h.kunci === tgl);
  const target = q.data?.config?.dailyTarget ?? 0;

  const bukaUnit = (runId: string) => router.push({ pathname: "/unit/[runId]", params: { runId } });
  const bukaJadwal = (s: Sasaran) => { pilih(s, tgl); router.push("/jadwal"); };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => { void q.refetch(); void backlog.refetch(); }}>
      <KepalaJudul keterangan="Rencana & urutan meja" judul="Target" />

      {/* Pemilih hari: kaca di atas biru; hari terpilih = putih pekat + teks biru (biru-di-atas-biru tidak terlihat terpilih). */}
      <View style={{ flexDirection: "row", gap: 6 }}>
        {hari.map((h) => {
          const on = h.kunci === tgl;
          return (
            <Pressable key={h.kunci} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${h.hari3} ${h.tgl}`} onPress={() => setTgl(h.kunci)}
              style={{ flex: 1, height: 58, borderRadius: 18, backgroundColor: on ? KACA.tombolPutih.bg : KACA.pil.bg, borderWidth: 1, borderColor: on ? C.white : KACA.pil.tepi, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: F.semibold, fontSize: 12, color: on ? TONE.blue.text : "#DCEBFF" }}>{h.hari3}</Text>
              <Text style={{ fontFamily: F.heavy, fontSize: 19, color: on ? TONE.blue.text : C.white }}>{h.tgl}</Text>
            </Pressable>
          );
        })}
      </View>

      <HeroCard>
        <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.bold, fontSize: 15, color: C.white }}>Rencana {hariDipilih ? `${hariDipilih.hari3} ${hariDipilih.tgl}` : ""}</Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
          <Text maxFontSizeMultiplier={1.1} style={{ fontFamily: F.heavy, fontSize: 56, lineHeight: 60, letterSpacing: -1.5, color: C.white, fontVariant: ["tabular-nums"] }}>{total}</Text>
          <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.semibold, fontSize: 15, color: "#DCEBFF", paddingBottom: 9 }}>{target ? `/ target ${target} kasur` : "kasur dijadwalkan"}</Text>
        </View>
        {target ? (
          <View style={{ height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.25)" }}>
            <View style={{ width: `${Math.min(100, (total / target) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: C.white }} />
          </View>
        ) : null}
      </HeroCard>

      <Segmented value={tampil} onChange={setTampil} options={[{ key: "meja", label: "Per meja" }, { key: "belum", label: `Belum dijadwalkan${totalBelum ? ` · ${totalBelum}` : ""}` }]} />

      {q.isLoading ? <StateView kind="loading" title="Memuat target…" /> : null}
      {q.error ? <StateView kind="error" title="Target tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} /> : null}
      {q.data?.readerMode === "OFF" ? <StateView kind="empty" title="Produksi V2 belum aktif" /> : null}

      {perhatian.length ? (
        <Section title="Perlu perhatian" right={<KeteranganPanel>{perhatian.length} unit</KeteranganPanel>}>
          {perhatian.slice(0, 8).map((p) => (
            <Baris key={p.key} onPress={() => (p.sasaran ? bukaJadwal(p.sasaran) : p.runId ? bukaUnit(p.runId) : undefined)}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: TONE[p.tone].tint, alignItems: "center", justifyContent: "center" }}>
                <AlertTriangle color={TONE[p.tone].text} size={18} strokeWidth={2.4} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T.Row numberOfLines={1}>{p.kode} · {p.customer}</T.Row>
                <T.RowSub numberOfLines={1} style={{ color: TONE[p.tone].text }}>{p.alasan}</T.RowSub>
              </View>
              {p.sasaran ? <Chip label="Jadwalkan" tone="blue" /> : null}
            </Baris>
          ))}
        </Section>
      ) : null}

      {tampil === "meja" ? stations.map((s) => (
        <Meja key={`${tgl}-${s.code}`} s={s} tgl={tgl} buka={bukaUnit} jadwal={(v) => bukaJadwal(sasaranDariView(v))}
          pic={() => router.push({ pathname: "/pic-meja", params: { kode: s.code, tgl } })} />
      )) : null}

      {tampil === "belum" ? (
        <Section title="Belum dijadwalkan" right={totalBelum ? <KeteranganPanel>{totalBelum} unit</KeteranganPanel> : undefined}>
          <KolomCari accessibilityLabel="Cari unit atau order" value={cari} onChangeText={setCari} placeholder="Cari kode unit / order / nama" autoCapitalize="characters" />
          {backlog.isLoading ? <StateView kind="loading" /> : null}
          {backlog.error ? <StateView kind="error" title="Daftar tidak bisa dimuat" text={pesanUntukPengguna(backlog.error)} onRetry={() => void backlog.refetch()} /> : null}
          {backlog.data && !belum.length ? <StateView kind="empty" text={cari ? "Tidak ada yang cocok." : "Semua unit sudah dijadwalkan."} /> : null}
          {belum.map((it) => {
            const sas = sasaranDariBacklog(it);
            const pr = it.card.priority;
            return (
              <Baris key={it.unitId} style={{ alignItems: "flex-start" }}>
                <Pressable accessibilityRole="button" disabled={!it.view} onPress={() => it.view && bukaUnit(it.view.runId)} style={{ flex: 1, minWidth: 0 }}>
                  <T.Row numberOfLines={1}>{kodePendek(it.card.unit.unitCode)} · {it.card.customer?.name || "—"}</T.Row>
                  <T.RowSub numberOfLines={2}>
                    {[it.card.unit.merk, it.card.unit.ukuran].filter(Boolean).join(" · ") || "—"}
                    {!sas && it.rencana?.message ? ` · ${it.rencana.message}` : ""}
                  </T.RowSub>
                  {pr?.key && pr.key !== "NORMAL" ? <Chip label={pr.label} tone="orange" style={{ marginTop: 4 }} /> : null}
                </Pressable>
                {sas ? (
                  <Button kind="tinted" label={sas.tanyaAktivasi ? "Aktifkan" : "Jadwalkan"} icon={<CalendarDays color="#0056B3" size={16} />} onPress={() => bukaJadwal(sas)} style={{ minHeight: 40, paddingHorizontal: 14, alignSelf: "center" }} />
                ) : <Chip label="Belum bisa" tone="gray" style={{ alignSelf: "center" }} />}
              </Baris>
            );
          })}
          {backlog.hasNextPage ? (
            <Button kind="plain" label="Muat lagi" onPress={() => void backlog.fetchNextPage()} busy={backlog.isFetchingNextPage} />
          ) : null}
        </Section>
      ) : null}
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
      title={s.label}
      right={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <KeteranganPanel>{s.items.length}/{s.capacity} kasur</KeteranganPanel>
          {bisaAtur ? (
            <Pressable accessibilityRole="button" hitSlop={10} onPress={atur ? () => setAtur(false) : mulai}>
              <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.bold, fontSize: 13, color: TONE.blue.text }}>{atur ? "Batal" : "Atur urutan"}</Text>
            </Pressable>
          ) : null}
        </View>
      }
    >
      {/* PIC bawaan meja — baris putih seperti baris lain di panel */}
      <Baris onPress={pic} accessibilityLabel={`Atur PIC bawaan ${s.label}`} style={{ minHeight: 48 }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: bawaan ? TONE.blue.tint : TONE.orange.tint, alignItems: "center", justifyContent: "center" }}>
          <UserRound color={bawaan ? TONE.blue.text : TONE.orange.text} size={16} strokeWidth={2.4} />
        </View>
        <T.RowSub numberOfLines={1} style={{ flex: 1, fontSize: 13, color: bawaan ? C.ink2 : TONE.orange.text }}>
          {bawaan ? `PIC bawaan: ${bawaan}` : "PIC bawaan belum diatur"}{s.operatorNames.length && !bawaan ? ` · ${s.operatorNames.join(", ")}` : ""}
        </T.RowSub>
        <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.bold, fontSize: 13, color: TONE.blue.text }}>Ubah</Text>
      </Baris>

      {list.length ? list.map((v, idx) => {
        const p = prioritasDari(v.priority?.key, v.plan?.priorityLabel, v.plan?.priorityRank ?? 0);
        return (
          <Baris key={v.runId}>
            <QueueNumber n={idx + 1} solid={idx === 0} tone={p?.tone === "red" ? "orange" : "blue"} />
            <Pressable accessibilityRole="button" disabled={atur} onPress={() => buka(v.runId)} style={{ flex: 1, minWidth: 0 }}>
              <T.Row numberOfLines={1}>{kodePendek(v.unit.unitCode)} · {v.customer.name || "—"}</T.Row>
              <T.RowSub numberOfLines={1}>
                {v.bucketLabel}{v.plan?.operator?.name ? ` · ${v.plan.operator.name}` : ""}{v.plan?.targetMissed ? " · lewat target" : ""}
              </T.RowSub>
              {p ? <Chip label={p.label} tone={p.tone} style={{ marginTop: 4 }} /> : null}
            </Pressable>
            {atur ? (
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Panah arah="naik" disabled={idx === 0} onPress={() => setUrut((xs) => geser(xs, idx, -1))} />
                <Panah arah="turun" disabled={idx === list.length - 1} onPress={() => setUrut((xs) => geser(xs, idx, 1))} />
              </View>
            ) : v.plan?.id ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Ubah jadwal ${kodePendek(v.unit.unitCode)}`} onPress={() => jadwal(v)}
                style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#D8E9FF", alignItems: "center", justifyContent: "center" }}>
                <CalendarDays color="#0056B3" size={20} />
              </Pressable>
            ) : null}
          </Baris>
        );
      }) : (
        <Baris style={{ minHeight: 44, justifyContent: "center" }}><T.RowSub style={{ fontSize: 13 }}>Kosong — belum ada unit di meja ini.</T.RowSub></Baris>
      )}
      {galat ? <T.RowSub style={{ color: TONE.red.text, fontSize: 13, marginHorizontal: 4 }}>{galat}</T.RowSub> : null}
      {atur ? (
        <Button label="Simpan urutan & kabari tim" onPress={() => void simpan()} busy={busy} disabled={!berubah || !online} />
      ) : null}
    </Section>
  );
}

function Panah({ arah, onPress, disabled }: { arah: "naik" | "turun"; onPress: () => void; disabled?: boolean }) {
  const Ikon = arah === "naik" ? ChevronUp : ChevronDown;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={arah === "naik" ? "Naikkan" : "Turunkan"} disabled={disabled} onPress={onPress}
      style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#D8E9FF", alignItems: "center", justifyContent: "center", opacity: disabled ? 0.3 : 1 }}>
      <Ikon color="#0056B3" size={22} strokeWidth={2.6} />
    </Pressable>
  );
}
