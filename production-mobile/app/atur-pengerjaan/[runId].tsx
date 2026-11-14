import React, { useRef, useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { useRefsJadwal } from "@/api/jadwal";
import { konfirmasiCorner, tetapkanPicBahan } from "@/api/picBahan";
import { pesanUntukPengguna } from "@/api/errors";
import { useRunCard } from "@/api/production";
import { bodyCorner, teksCorner, validasiCorner } from "@/features/picBahan";
import { bolehCobaLagi } from "@/features/langkah";
import { Isian, PilihanChip } from "@/design/Form";
import { NavBar } from "@/design/NavBar";
import { Button, Card, Screen, StateView, T } from "@/design/ui";
import { C, TONE } from "@/design/tokens";

// RENCANA PENGERJAAN PESANAN (Lead/Admin/Owner, izin PRODUCTION_ASSIGNMENT_WRITE) — cermin BuildPlanPanel di Unit 360 web:
//   POST /production-v2/runs/:runId/build/corner             kebutuhan Corner (tidak diperlukan = wajib beralasan)
//   POST /production-v2/runs/:runId/build/material-operator  PIC Bahan per pekerjaan (operator produksi yang sah)
// Jenis produk TIDAK diubah di sini — masalahnya ditampilkan supaya Sales memperbaiki order.
type Pilihan = "" | "YES" | "NO";

export default function AturPengerjaan() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const qc = useQueryClient();
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const card = useRunCard(runId);
  const refs = useRefsJadwal();
  const c = card.data;
  const b = c?.build ?? null;
  const corner = b?.corner ?? null;

  const [cornerPilih, setCornerPilih] = useState<Pilihan | null>(null);
  const [alasan, setAlasan] = useState<string | null>(null);
  const [picPilih, setPicPilih] = useState<string | null>(null);
  const cornerNilai: Pilihan = cornerPilih ?? (corner?.required === true ? "YES" : corner?.required === false ? "NO" : "");
  const alasanNilai = alasan ?? corner?.reason ?? "";
  const picSekarang = b?.materialOperator?.id ?? "";
  const picNilai = picPilih ?? picSekarang;
  const [busy, setBusy] = useState<"" | "corner" | "pic">("");
  const [pesan, setPesan] = useState<{ ok: boolean; teks: string } | null>(null);
  const kunciCorner = useRef(`pm-corner-${randomUUID()}`);
  const kunciPic = useRef(`pm-picb-${randomUUID()}`);

  const jalankan = async (nama: "corner" | "pic", fn: () => Promise<{ changed?: boolean } | null | undefined>, sukses: string, kunci: React.MutableRefObject<string>, awalan: string) => {
    setBusy(nama); setPesan(null);
    try {
      const r = await fn();
      kunci.current = `${awalan}${randomUUID()}`;
      setPesan({ ok: true, teks: r?.changed === false ? "Tidak ada perubahan." : sukses });
      setCornerPilih(null); setAlasan(null); setPicPilih(null);
      await qc.invalidateQueries();
    } catch (e) {
      if (!bolehCobaLagi(e)) kunci.current = `${awalan}${randomUUID()}`;
      setPesan({ ok: false, teks: pesanUntukPengguna(e) });
      void card.refetch();
    } finally { setBusy(""); }
  };

  const simpanCorner = () => {
    if (!c) return;
    const v = validasiCorner(cornerNilai, alasanNilai);
    if (v) { setPesan({ ok: false, teks: v }); return; }
    void jalankan("corner", () => konfirmasiCorner(c.runId, bodyCorner(c.revision, cornerNilai as "YES" | "NO", alasanNilai), kunciCorner.current), "Kebutuhan Corner dikonfirmasi.", kunciCorner, "pm-corner-");
  };
  const simpanPic = (operatorId: string | null) => {
    if (!c) return;
    void jalankan("pic", () => tetapkanPicBahan(c.runId, c.revision, operatorId, kunciPic.current), operatorId ? "PIC Bahan ditetapkan." : "PIC Bahan dilepas.", kunciPic, "pm-picb-");
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen lembar header={<NavBar judul="Rencana Pengerjaan" kembali="Tutup" />} bottomPad={40} refreshing={card.isRefetching} onRefresh={() => void card.refetch()}>
        {card.isLoading ? <StateView kind="loading" title="Memuat…" /> : null}
        {card.error ? <StateView kind="error" title="Kartu tidak bisa dimuat" text={pesanUntukPengguna(card.error)} onRetry={() => void card.refetch()} /> : null}
        {c && c.track !== "BUILD" ? <StateView kind="empty" title="Hanya untuk pesanan baru/custom" text="Pengaturan ini berlaku untuk jalur Pengerjaan Pesanan." /> : null}

        {c && c.track === "BUILD" ? (
          <>
            <T.Sub style={{ marginHorizontal: 4 }}>{c.unit.unitCode} · pesanan baru/custom dikerjakan langsung dari spesifikasi & layanan pesanan Sales.</T.Sub>
            {c.product?.problem ? (
              <Card style={{ backgroundColor: TONE.orange.tint }}>
                <T.Sub style={{ color: TONE.orange.text }}>Jenis produk perlu dikonfirmasi: {c.product.problem}. Produksi tidak mengubah order; racikan dan pengujian khusus kasur ditahan sampai Sales memperbaiki jenis produk pada order.</T.Sub>
              </Card>
            ) : null}

            <Card style={{ gap: 10 }}>
              <T.Headline>Corner (kain/jahit)</T.Headline>
              <T.Sub style={{ color: corner?.confirmed ? C.ink2 : TONE.orange.text }}>{corner?.confirmed ? teksCorner(corner) : "Belum dikonfirmasi — QC menunggu"}</T.Sub>
              {corner?.locked ? <T.Caption>Keputusan Corner terkunci — pekerjaan sudah melewati gerbang penentuannya.</T.Caption> : (
                <>
                  <PilihanChip label="Kebutuhan Corner" options={[{ value: "YES", label: "Diperlukan" }, { value: "NO", label: "Tidak diperlukan" }]} value={cornerNilai ? [cornerNilai] : []}
                    onChange={(v) => { setCornerPilih((v[0] as Pilihan) ?? ""); kunciCorner.current = `pm-corner-${randomUUID()}`; }} />
                  {cornerNilai === "NO" ? <Isian label="Alasan (wajib)" value={alasanNilai} onChange={(v) => { setAlasan(v); kunciCorner.current = `pm-corner-${randomUUID()}`; }} placeholder="mis. tidak ada pekerjaan kain/jahit" /> : null}
                  <Button kind="tinted" label="Simpan Corner" onPress={simpanCorner} busy={busy === "corner"} disabled={!online || !!busy} />
                </>
              )}
            </Card>

            <Card style={{ gap: 10 }}>
              <T.Headline>PIC Bahan</T.Headline>
              <T.Sub>{b?.materialOperator?.name || "Belum ditugaskan"}</T.Sub>
              {refs.isLoading ? <T.Caption>Memuat daftar operator…</T.Caption> : null}
              {refs.error ? <T.Caption style={{ color: TONE.red.text }}>{pesanUntukPengguna(refs.error)}</T.Caption> : null}
              {refs.data && !refs.data.operators.length ? <T.Caption>Belum ada operator terdaftar (daftarkan di Pengaturan › Operator).</T.Caption> : null}
              {refs.data?.operators.length ? (
                <PilihanChip label="Pilih operator" options={refs.data.operators.map((o) => ({ value: o.id, label: o.name }))} value={picNilai ? [picNilai] : []}
                  onChange={(v) => { setPicPilih(v[0] ?? ""); kunciPic.current = `pm-picb-${randomUUID()}`; }} />
              ) : null}
              <View style={{ flexDirection: "row", gap: 8 }}>
                {b?.materialOperator ? <Button kind="tinted" tone="red" label="Lepas" onPress={() => simpanPic(null)} disabled={!online || !!busy} style={{ flex: 1 }} /> : null}
                <Button kind="tinted" label="Tetapkan" onPress={() => simpanPic(picNilai || null)} busy={busy === "pic"} disabled={!online || !!busy || !picNilai || picNilai === picSekarang} style={{ flex: 2 }} />
              </View>
              <T.Caption>PIC Bahan mencatat racikan dan pemakaian aktual dari HP (Kerja › PIC Bahan). Stok keluar hanya saat Gudang menyerahkan bahan.</T.Caption>
            </Card>

            {pesan ? <Card style={{ backgroundColor: pesan.ok ? TONE.green.tint : TONE.red.tint }}><T.Sub style={{ color: pesan.ok ? TONE.green.text : TONE.red.text }}>{pesan.teks}</T.Sub></Card> : null}
          </>
        ) : null}
      </Screen>
    </View>
  );
}
