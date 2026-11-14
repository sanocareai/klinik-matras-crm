import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CalendarDays, ChevronRight } from "lucide-react-native";
import { bulanWib, kelompokPengajuan, usePengajuanMenunggu } from "@/api/bahanQc";
import { useDaftarOrder } from "@/api/order";
import { pesanUntukPengguna } from "@/api/errors";
import { hitungFilter, ringkasBaris, tanggalPendek, type BarisOrder, type FilterOrder, type PeriodeOrder } from "@/features/order";
import { Segmented } from "@/design/Segmented";
import { LembarKalender } from "@/design/LembarKalender";
import { labelRentang, type Rentang } from "@/features/rentangTanggal";
import { Baris, Button, Chip, KepalaJudul, KeteranganPanel, KolomCari, Screen, Section, StateView, T } from "@/design/ui";
import { haptic } from "@/design/haptics";
import { C, F, KACA, TONE } from "@/design/tokens";

// ORDER — SELURUH order produksi (bukan hanya yang dikerjakan hari ini), cermin halaman "Order Produksi" web:
// cari kode unit / nomor order / nama pelanggan, saring status (Aktif · Terkirim · Bahan belum dicatat) dan periode,
// lalu buka PROFIL ORDER: data order & pelanggan, status produksi, bahan (catat gaya kasir), dan dokumentasi.
// Menggantikan tab "Bahan" (keputusan Owner 14 Nov 2026) — pencatatan bahan sekarang ada di dalam profil tiap order.
const JUDUL: Record<FilterOrder, string> = { semua: "Semua order", aktif: "Order aktif", terkirim: "Sudah terkirim", bahan: "Bahan belum dicatat" };

export default function Order() {
  const router = useRouter();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [filter, setFilter] = useState<FilterOrder>("semua");
  const [periode, setPeriode] = useState<PeriodeOrder>("semua");
  const [rentang, setRentang] = useState<Rentang | null>(null);
  const [kalender, setKalender] = useState(false);
  const [cari, setCari] = useState("");
  const [tunda, setTunda] = useState("");
  // Dibuka dari Beranda "Bahan belum dicatat" → langsung tersaring (bulan ini, seperti angka di Beranda).
  // (Disesuaikan saat render — bukan di effect — setiap kali parameter berubah, mis. dibuka lagi dari Beranda.)
  const [paramTerakhir, setParamTerakhir] = useState<string | undefined>(undefined);
  if (params.filter !== paramTerakhir) {
    setParamTerakhir(params.filter);
    if (params.filter === "bahan") { setFilter("bahan"); setPeriode("0"); }
  }
  useEffect(() => { const t = setTimeout(() => setTunda(cari), 300); return () => clearTimeout(t); }, [cari]);

  // Batas periode untuk server (dari/sampai, kalender WIB) + labelnya — bulan cepat atau rentang pilihan sendiri (sama dengan web).
  const bulan: { dari: string; sampai: string; label: string } | null = periode === "semua" ? null
    : periode === "rentang" ? (rentang ? { ...rentang, label: labelRentang(rentang) } : null)
    : bulanWib(Number(periode));
  const q = useDaftarOrder({ q: tunda, filter, bulan });
  const aju = usePengajuanMenunggu();
  const diajukan = useMemo(() => kelompokPengajuan(aju.data?.pengajuan), [aju.data]);
  const baris = useMemo(() => q.data?.pages.flatMap((p) => p.units) ?? [], [q.data]);
  const total = q.data?.pages[0]?.total ?? 0;
  const hitung = hitungFilter(q.data?.pages[0]?.displayStatusCounts);
  const pilihan: { key: FilterOrder; label: string; n?: number }[] = [
    // "Semua" tanpa angka: hitungan status server tidak mencakup setiap status unit (total ada di judul panel).
    { key: "semua", label: "Semua" },
    { key: "aktif", label: "Aktif", n: hitung?.aktif },
    { key: "terkirim", label: "Terkirim", n: hitung?.terkirim },
    { key: "bahan", label: "Bahan belum dicatat" },
  ];

  return (
    <Screen refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => { void q.refetch(); void aju.refetch(); }}>
      <KepalaJudul keterangan="Semua order produksi" judul="Order" />
      <KolomCari accessibilityLabel="Cari order" value={cari} onChangeText={setCari} placeholder="Cari kode unit, nomor order, nama" />

      {/* Saringan status: kaca di atas biru; terpilih = putih pekat + teks biru. Angka = jumlah unit dari server (seluruh waktu). */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}>
        {pilihan.map((p) => {
          const on = filter === p.key;
          return (
            <Pressable key={p.key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { haptic.tick(); setFilter(p.key); }}
              style={{ height: 38, paddingHorizontal: 14, borderRadius: 19, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: on ? KACA.tombolPutih.bg : KACA.pil.bg, borderWidth: 1, borderColor: on ? C.white : KACA.pil.tepi }}>
              <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: on ? F.heavy : F.bold, fontSize: 13, color: on ? TONE.blue.text : C.white }}>{p.label}</Text>
              {p.n != null ? <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: F.bold, fontSize: 12, color: on ? C.ink3 : "#DCEBFF" }}>{p.n}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Segmented value={periode === "rentang" ? ("rentang" as PeriodeOrder) : periode} onChange={(k) => setPeriode(k)}
            options={[{ key: "semua", label: "Semua" }, { key: "0", label: "Bulan ini" }, { key: "-1", label: "Bulan lalu" }]} />
        </View>
        {/* Pilih tanggal sendiri: tombol bulat kaca; menyala putih saat rentang pilihan sedang dipakai. */}
        <Pressable accessibilityRole="button" accessibilityLabel={rentang && periode === "rentang" ? `Rentang ${labelRentang(rentang)}, ubah` : "Pilih rentang tanggal"} onPress={() => { haptic.tick(); setKalender(true); }}
          style={{ width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center", backgroundColor: periode === "rentang" ? KACA.tombolPutih.bg : KACA.pil.bg, borderWidth: 1, borderColor: periode === "rentang" ? C.white : KACA.pil.tepi }}>
          <CalendarDays size={22} color={periode === "rentang" ? TONE.blue.text : C.white} strokeWidth={2.2} />
        </Pressable>
      </View>
      {periode === "rentang" && rentang ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Hapus rentang ${labelRentang(rentang)}`} onPress={() => { haptic.tick(); setPeriode("semua"); }}
          style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, backgroundColor: KACA.tombolPutih.bg }}>
          <CalendarDays size={16} color={TONE.blue.text} strokeWidth={2.2} />
          <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: F.bold, fontSize: 13, color: TONE.blue.text }}>{labelRentang(rentang)}</Text>
          <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: F.bold, fontSize: 15, color: C.ink3, marginLeft: 2 }}>×</Text>
        </Pressable>
      ) : null}
      {kalender ? (
        <LembarKalender awal={periode === "rentang" ? rentang : null} onTutup={() => setKalender(false)}
          onPilih={(r) => { setRentang(r); setPeriode("rentang"); }} />
      ) : null}

      {q.isLoading ? <StateView kind="loading" title="Memuat order…" /> : null}
      {q.error ? <StateView kind="error" title="Order tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} /> : null}

      {!q.isLoading && !q.error ? (
        <Section title={JUDUL[filter]} right={<KeteranganPanel>{total} unit{bulan ? ` · ${bulan.label}` : ""}</KeteranganPanel>}>
          {baris.length ? baris.map((u) => (
            <BarisUnit key={u.id} u={u} diajukan={diajukan.has(u.id)} onPress={() => router.push({ pathname: "/order/[unitId]", params: { unitId: u.id } })} />
          )) : (
            <StateView kind="empty" title={filter === "bahan" ? "Semua sudah tercatat" : "Tidak ada order"}
              text={tunda.trim() ? "Tidak ada yang cocok dengan pencarian." : filter === "bahan" ? `Tidak ada unit${bulan ? ` ${bulan.label}` : ""} yang belum punya catatan bahan.` : "Belum ada order pada saringan ini."} />
          )}
          {q.hasNextPage ? <Button kind="plain" label={`Muat lagi (${baris.length} dari ${total})`} busy={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} /> : null}
        </Section>
      ) : null}
    </Screen>
  );
}

function BarisUnit({ u, diajukan, onPress }: { u: BarisOrder; diajukan: boolean; onPress: () => void }) {
  const r = ringkasBaris(u, diajukan);
  return (
    <Baris accessibilityLabel={`Buka order ${u.unitCode}`} onPress={onPress}>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <T.Row numberOfLines={1} style={{ flex: 1 }}>{r.kode}</T.Row>
          <T.RowSub>{tanggalPendek(u.createdAt) ?? ""}</T.RowSub>
        </View>
        <T.RowSub numberOfLines={1}>{r.sub}</T.RowSub>
        {r.chips.length ? (
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
            {r.chips.map((c, i) => <Chip key={`${i}-${c.label}`} label={c.label} tone={c.tone} />)}
          </View>
        ) : null}
      </View>
      <ChevronRight color={C.ink3} size={18} />
    </Baris>
  );
}
