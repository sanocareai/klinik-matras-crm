import React from "react";
import { Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { kelompokPengajuan, useAdopsiUnit, usePengajuanMenunggu } from "@/api/bahanQc";
import { useRuangKerja } from "@/api/order";
import { pesanUntukPengguna } from "@/api/errors";
import { angka } from "@/features/catatBahanQc";
import { tanggalPendek } from "@/features/order";
import { PanelDokumentasi } from "@/features/PanelDokumentasi";
import { NavBar } from "@/design/NavBar";
import { Baris, Button, Card, Chip, KeteranganPanel, Screen, Section, StateView, T, TeksBaris } from "@/design/ui";
import { C, F, TONE } from "@/design/tokens";

// PROFIL ORDER — satu layar untuk satu unit: data order & pelanggan, status produksi, bahan (catat gaya kasir), dokumentasi.
// Sumber sama dengan Ruang Kerja Unit di web: GET /production/units/:id/ruang-kerja + /adopsi. Baca-saja kecuali Bahan & Dokumentasi.
export default function ProfilOrder() {
  const { unitId } = useLocalSearchParams<{ unitId: string }>();
  const router = useRouter();
  const rk = useRuangKerja(unitId);
  const ad = useAdopsiUnit(unitId);
  const aju = usePengajuanMenunggu();
  const menunggu = kelompokPengajuan(aju.data?.pengajuan).get(unitId ?? "") ?? [];
  const d = rk.data; const o = d?.order; const det = o?.detail;
  const pakai = ad.data?.pemakaianAktual?.total ?? [];
  const terkirim = o?.statusOrder.key === "TERKIRIM";

  return (
    <Screen header={<NavBar judul="Profil order" />} refreshing={rk.isRefetching} onRefresh={() => { void rk.refetch(); void ad.refetch(); }} bottomPad={60}>
      {rk.isLoading ? <StateView kind="loading" title="Memuat order…" /> : null}
      {rk.error ? <StateView kind="error" title="Order tidak bisa dimuat" text={pesanUntukPengguna(rk.error)} onRetry={() => void rk.refetch()} /> : null}

      {d && o && det ? (
        <>
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <Chip label={o.statusOrder.label} tone={terkirim ? "green" : "blue"} />
              {d.alurMeja ? <Chip label={`${d.alurMeja.statusLabel}${d.alurMeja.tahap ? ` · ${d.alurMeja.tahap}` : ""}`} tone="blue" /> : null}
              {det.komplain && !det.komplain.selesai ? <Chip label="Komplain" tone="orange" /> : null}
            </View>
            <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1.2} style={{ fontFamily: F.heavy, fontSize: 26, letterSpacing: -0.5, color: C.white }}>{d.unit.unitCode}</Text>
            <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ fontFamily: F.medium, fontSize: 14, color: "#DCEBFF" }}>{[o.pelanggan?.name, [d.unit.merk, d.unit.ukuran].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "—"}</Text>
          </View>

          {d.perhatian ? <Card style={{ backgroundColor: TONE.orange.tint }}><T.RowSub style={{ color: TONE.orange.text, fontSize: 13 }}>{d.perhatian.teks}</T.RowSub></Card> : null}

          <Section title="Order">
            <Card style={{ gap: 10 }}>
              <Info label="Nomor order" nilai={o.orderNumber ?? "—"} />
              <Info label="Pelanggan" nilai={o.pelanggan?.name ?? "—"} />
              <Info label="Layanan" nilai={o.layanan.length ? o.layanan.join(", ") : "—"} />
              <Info label="Jumlah unit" nilai={`${o.jumlahUnit}${o.unitLain.length ? ` (lainnya: ${o.unitLain.map((u) => u.unitCode).join(", ")})` : ""}`} />
              <Info label="Janji ke pelanggan" nilai={tanggalPendek(det.janjiPelanggan) ?? "Belum diisi"} />
              <Info label="Pengiriman dikonfirmasi" nilai={tanggalPendek(det.pengirimanDikonfirmasi) ?? "Belum"} />
            </Card>
          </Section>

          <Section title="Pelanggan & catatan">
            <Card style={{ gap: 10 }}>
              <Info label="Kondisi pelanggan" nilai={`${det.kondisiPelanggan.label}${det.kondisiPelanggan.keluhan.length ? ` — ${det.kondisiPelanggan.keluhan.join(", ")}` : ""}`} />
              <Info label="Catatan Sales untuk Produksi" nilai={det.catatanProduksi ?? "Tidak ada"} />
              {det.komplain ? <Info label={`Komplain${det.komplain.tanggal ? ` · ${tanggalPendek(det.komplain.tanggal)}` : ""}${det.komplain.selesai ? " · selesai" : ""}`} nilai={det.komplain.rincian ?? "—"} /> : null}
            </Card>
          </Section>

          <Section title="Status produksi">
            <Card style={{ gap: 10 }}>
              <Info label="Status unit" nilai={d.unit.statusUnit ?? d.unit.status} />
              {d.tindakan ? <Info label="Langkah berikutnya" nilai={`${d.tindakan.label}${d.tindakan.aktor && d.tindakan.aktor !== "—" ? ` · ${d.tindakan.aktor}` : ""}`} /> : null}
              {d.tindakan?.detail ? <T.RowSub>{d.tindakan.detail}</T.RowSub> : null}
            </Card>
            {d.alurMeja ? <Button label="Buka pekerjaan" onPress={() => router.push({ pathname: "/unit/[runId]", params: { runId: d.alurMeja!.runId } })} /> : null}
          </Section>

          <Section title="Bahan" right={<KeteranganPanel>{pakai.length ? `${pakai.length} tercatat` : menunggu.length ? "menunggu Admin" : "belum ada"}</KeteranganPanel>}>
            {pakai.map((t) => (
              <Baris key={t.materialId}><TeksBaris judul={t.nama ?? t.kode ?? "Bahan"} /><T.Row style={{ fontVariant: ["tabular-nums"] }}>{angka(Number(t.dipakai))} {String(t.satuan ?? "").toLowerCase()}</T.Row></Baris>
            ))}
            {menunggu.flatMap((p) => (p.ringkasan?.baris ?? []).map((x, i) => ({ key: `${p.id}-${i}`, x }))).map(({ key, x }) => (
              <Baris key={key}><TeksBaris judul={x.bahan ?? "Bahan"} sub="Diajukan — menunggu verifikasi Admin" /><T.Row style={{ fontVariant: ["tabular-nums"] }}>{angka(Number(x.qty))} {String(x.satuanInput ?? x.satuanStok ?? "").toLowerCase()}</T.Row></Baris>
            ))}
            {!pakai.length && !menunggu.length ? <StateView kind="empty" text="Belum ada bahan tercatat untuk unit ini." /> : null}
            {ad.data?.izin?.pemakaianAktual ? <Button label={pakai.length || menunggu.length ? "Tambah bahan" : "Catat bahan"} onPress={() => router.push({ pathname: "/bahan/[unitId]", params: { unitId: unitId! } })} /> : null}
          </Section>

          <Section title="Dokumentasi" right={terkirim ? <KeteranganPanel>unit terkirim</KeteranganPanel> : undefined}>
            <PanelDokumentasi unitId={unitId!} rk={d} />
          </Section>
        </>
      ) : null}
    </Screen>
  );
}

function Info({ label, nilai }: { label: string; nilai: string }) {
  return (
    <View style={{ gap: 1 }}>
      <T.RowSub>{label}</T.RowSub>
      <T.Row style={{ fontFamily: F.semibold, lineHeight: 19 }}>{nilai}</T.Row>
    </View>
  );
}
