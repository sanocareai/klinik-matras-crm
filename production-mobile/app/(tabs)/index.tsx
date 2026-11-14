import React, { useMemo } from "react";
import { Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { AlertTriangle, ArrowUpRight, CalendarDays, Camera, ChevronRight, Image as ImageIcon, LayoutGrid, Layers, Package, Search, ShieldCheck, Target, UserCog } from "lucide-react-native";
import { useAndon, useLayout, useMingguIni } from "@/api/production";
import { useQcQueue } from "@/api/qc";
import { bulanWib, useBahanBelumBulanIni } from "@/api/bahanQc";
import { useSession } from "@/auth/session";
import { kodePendek, ringkasPapan } from "@/features/model";
import { perluPerhatian } from "@/features/papan";
import { Baris, Chip, CincinProgres, GlassOnBlue, GridMenu, HeroCard, IconOrb, Kepala, KeteranganPanel, MenuTile, PilLive, QueueNumber, Screen, Section, TeksBaris, TombolBulat, TombolPutih } from "@/design/ui";
import { haptic } from "@/design/haptics";
import { C, F, TONE } from "@/design/tokens";

// BERANDA (kanvas SANSS Produksi v2) — super-app per peran, susunan PERSIS mockup:
//   Admin/Kepala Produksi → latar biru · kartu kaca "Produksi hari ini" (cincin selesai/target + rincian + "Minggu ini") ·
//                           ubin menu kaca · panel "Butuh perhatian".
//   QC & Dokumentasi      → latar navy · kartu kaca "Menunggu Uji Berat Badan" · ubin menu · panel "Antrean uji" ·
//                           panel "Bahan belum dicatat" (keputusan Owner 14 Nov 2026: pendataan bahan = tim QC & Dokumentasi).
//   PIC Meja saja         → langsung ke Kerja (pekerjaannya sendiri, tanpa menu).
// Semua angka dari server (papan/andon, antrean QC, klasifikasi bahan) — tidak ada data contoh.
export default function Beranda() {
  const l = useLayout();
  const router = useRouter();
  const user = useSession((s) => s.user);
  const admin = l.admin;
  const timQc = l.qc || l.docs;
  const andon = useAndon();
  const minggu = useMingguIni(admin);
  const qc = useQcQueue(l.qc);
  const bahan = useBahanBelumBulanIni(timQc);
  const kpi = ringkasPapan(andon.data);
  const perhatian = useMemo(() => perluPerhatian(andon.data?.stations ?? []), [andon.data]);
  const antreQc = qc.data?.items ?? [];

  if (!admin && !timQc) return <Redirect href={l.lane ? "/kerja" : "/papan"} />;

  const ke = (path: string) => () => { haptic.tick(); router.push(path as never); };
  const bukaQc = (runId: string) => () => { haptic.ringan(); router.push({ pathname: "/qc/[runId]", params: { runId } }); };
  // Urutan ubin mengikuti mockup (Papan · Rencana · QC · Bahan · Target · …); hanya menu yang memang ada & boleh dibuka akun ini.
  const tiles = admin ? [
    { key: "papan", label: "Papan", Icon: LayoutGrid, to: "/papan" },
    { key: "jadwal", label: "Jadwal", Icon: CalendarDays, to: "/jadwal" },
    ...(l.qc ? [{ key: "qc", label: "QC", Icon: ShieldCheck, to: "/qc", badge: antreQc.length }] : []),
    // Order (tab Order Produksi, 14 Nov 2026): semua order + profil (bahan, dokumentasi). Lencana = unit bulan ini yang bahannya belum dicatat.
    { key: "order", label: "Order", Icon: Package, to: "/order", badge: timQc ? bahan.perlu : undefined, oranye: timQc && bahan.perlu > 0 },
    { key: "target", label: "Target", Icon: Target, to: "/target" },
    { key: "pic", label: "PIC Meja", Icon: UserCog, to: "/pic-meja" },
    { key: "media", label: "Media", Icon: ImageIcon, to: "/media" },
    ...(l.lane ? [{ key: "kerja", label: "Kerja", Icon: Layers, to: "/kerja" }] : []),
  ] : [
    ...(l.qc ? [{ key: "qc", label: "Uji Berat", Icon: ShieldCheck, to: "/qc", badge: antreQc.length }] : []),
    { key: "media", label: "Dokumentasi", Icon: Camera, to: "/media" },
    { key: "order", label: "Order", Icon: Package, to: "/order", badge: bahan.perlu, oranye: bahan.perlu > 0 },
    { key: "papan", label: "Papan", Icon: LayoutGrid, to: "/papan" },
    ...(l.lane ? [{ key: "kerja", label: "Kerja", Icon: Layers, to: "/kerja" }] : []),
  ];
  const nama = (user?.name ?? "").split(" ")[0] || "Tim";
  const inisial = (user?.name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  const muat = () => { void andon.refetch(); void qc.refetch(); };

  return (
    <Screen latar={admin ? "biru" : "navy"} refreshing={andon.isRefetching} onRefresh={muat}>
      <Kepala foto={user?.avatarUrl}
        inisial={inisial}
        keterangan={admin ? "Kepala Produksi" : "QC & Dokumentasi"}
        judul={`Halo, ${nama}`}
        kanan={<TombolBulat accessibilityLabel="Cari unit" onPress={ke("/media")}><Search size={21} color={C.white} strokeWidth={2} /></TombolBulat>}
      />

      {admin ? (
        <HeroCard>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.bold, fontSize: 15, color: C.white }}>Produksi hari ini</Text>
            <PilLive putus={!!andon.error} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            <CincinProgres nilai={kpi.selesai} total={kpi.target} />
            <View style={{ flex: 1, gap: 8 }}>
              <Rinci label="Dikerjakan" n={kpi.dikerjakan} />
              {l.qc ? <Rinci label="Di QC" n={antreQc.length} /> : <Rinci label="Lewat target" n={kpi.terlambat} sorot={kpi.terlambat > 0} />}
              <Rinci label="Terhambat" n={kpi.terhambat} sorot={kpi.terhambat > 0} />
            </View>
          </View>
          {/* mockup: baris kaca "Minggu ini" + batang + angka. Angka = selesai / terjadwal Senin–Minggu dari papan per tanggal. */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.16)", borderWidth: 1, borderColor: "rgba(255,255,255,0.3)" }}>
            <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: F.bold, fontSize: 12, color: C.white }}>Minggu ini</Text>
            <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.25)" }}>
              <View style={{ width: `${minggu.terjadwal ? Math.min(100, (minggu.selesai / minggu.terjadwal) * 100) : 0}%`, height: 6, borderRadius: 3, backgroundColor: C.white }} />
            </View>
            <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: F.heavy, fontSize: 12, color: C.white, fontVariant: ["tabular-nums"] }}>{minggu.siap ? `${minggu.selesai}/${minggu.terjadwal}` : "…"}</Text>
          </View>
        </HeroCard>
      ) : (
        <HeroCard>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.bold, fontSize: 15, color: C.white }}>Menunggu Uji Berat Badan</Text>
            <PilLive putus={!!qc.error} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
            {/* pendar teks (mockup: text-shadow 30px) — Android memotong bayangan di kotak teks, jadi diberi ruang 24 lalu ditarik balik */}
            <Text maxFontSizeMultiplier={1.1} style={{ fontFamily: F.heavy, fontSize: 68, lineHeight: 72, letterSpacing: -2, color: C.white, textShadowColor: "rgba(140,200,255,0.8)", textShadowRadius: 22, padding: 24, margin: -24, fontVariant: ["tabular-nums"] }}>{qc.isLoading ? "…" : antreQc.length}</Text>
            <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.semibold, fontSize: 15, color: "#CBE9FD", paddingBottom: 12 }}>kasur siap diuji</Text>
          </View>
          {antreQc[0] ? (
            <View style={{ flexDirection: "row" }}>
              <TombolPutih label="Mulai uji berikutnya" warna="#0B2CB1" onPress={bukaQc(antreQc[0].runId)}>
                <IconOrb size={40}><ArrowUpRight color={C.white} size={18} strokeWidth={2.6} /></IconOrb>
              </TombolPutih>
            </View>
          ) : (
            <GlassOnBlue style={{ borderRadius: 18, paddingVertical: 10, paddingHorizontal: 12 }}>
              <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.semibold, fontSize: 13, color: C.white }}>Tidak ada yang menunggu. Unit muncul begitu Meja selesai.</Text>
            </GlassOnBlue>
          )}
        </HeroCard>
      )}

      <GridMenu>
        {tiles.slice(0, 8).map((t) => <MenuTile key={t.key} label={t.label} Icon={t.Icon} badge={t.badge} oranye={t.oranye} onPress={ke(t.to)} />)}
      </GridMenu>

      {!admin && antreQc.length ? (
        <Section title="Antrean uji" right={<KeteranganPanel>urut terlama</KeteranganPanel>}>
          {antreQc.slice(0, 4).map((it, i) => (
            <Baris key={it.runId} onPress={bukaQc(it.runId)} accessibilityLabel={`Uji ${it.unit.unitCode}`}>
              <QueueNumber n={i + 1} solid={i === 0} />
              <TeksBaris judul={kodePendek(it.unit.unitCode)} sub={it.unit.orderNumber ?? it.unit.unitCode} />
              {it.conflict ? <Chip label="Konflik" tone="orange" /> : <Chip label="Siap diuji" />}
            </Baris>
          ))}
        </Section>
      ) : null}

      {timQc ? (
        <Section title="Bahan belum dicatat" right={<KeteranganPanel>{bulanWib(0).label}</KeteranganPanel>}>
          <Baris onPress={ke("/order?filter=bahan")} accessibilityLabel={`Bahan belum dicatat, ${bahan.perlu} order`}>
            <IconOrb size={38} nada={bahan.perlu ? "orbOranye" : "orb"}><Package color={C.white} size={18} strokeWidth={2.2} /></IconOrb>
            <TeksBaris judul={bahan.isLoading ? "Menghitung…" : bahan.perlu ? `${bahan.perlu} order perlu dicatat` : "Semua order sudah tercatat"} sub="Catat bahan yang dipakai tiap order" />
            <ChevronRight color={C.ink3} size={20} />
          </Baris>
        </Section>
      ) : null}

      {admin ? (
        <Section title="Butuh perhatian" right={perhatian.length ? <KeteranganPanel>{perhatian.length} unit</KeteranganPanel> : undefined}>
          {perhatian.length ? perhatian.slice(0, 4).map((p) => (
            <Baris key={p.runId} onPress={() => router.push({ pathname: "/unit/[runId]", params: { runId: p.runId } })} accessibilityLabel={`${p.kode}, ${p.alasan}`}>
              <IconOrb size={36} nada="orbOranye"><AlertTriangle color={C.white} size={18} strokeWidth={2.4} /></IconOrb>
              <TeksBaris judul={`${p.kode} · ${p.customer}`} sub={`${p.alasan} · ${p.meja}`} />
            </Baris>
          )) : (
            <Baris>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: TONE.green.tint, alignItems: "center", justifyContent: "center" }}>
                <ShieldCheck color={TONE.green.text} size={18} strokeWidth={2.4} />
              </View>
              <TeksBaris judul={andon.isLoading ? "Memuat papan…" : "Semua lancar"} sub={andon.isLoading ? undefined : "Tidak ada unit yang perlu perhatian sekarang"} />
            </Baris>
          )}
        </Section>
      ) : null}
    </Screen>
  );
}

/** Baris rincian di kanan cincin (mockup: label 13/600, angka 13/800; angka > 0 yang perlu disorot = pil putih teks oranye). */
function Rinci({ label, n, sorot }: { label: string; n: number; sorot?: boolean }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.semibold, fontSize: 13, color: C.white }}>{label}</Text>
      {sorot ? (
        <View style={{ paddingVertical: 1, paddingHorizontal: 9, borderRadius: 10, backgroundColor: C.white }}>
          <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.heavy, fontSize: 13, color: TONE.orange.text }}>{n}</Text>
        </View>
      ) : <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.heavy, fontSize: 13, color: C.white, fontVariant: ["tabular-nums"] }}>{n}</Text>}
    </View>
  );
}
