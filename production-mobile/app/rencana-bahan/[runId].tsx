import React, { useMemo, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { Save } from "lucide-react-native";
import { simpanRencanaBahan } from "@/api/picBahan";
import { useKomponen } from "@/api/komponen";
import { ApiError, pesanUntukPengguna } from "@/api/errors";
import { useRunCard } from "@/api/production";
import { alasanBomTerkunci, barisDari, bomMelepasReservasi, payloadBaris, rujukanRacikan, samaDenganTersimpan, validasiBaris } from "@/features/picBahan";
import { bolehCobaLagi } from "@/features/langkah";
import { DaftarBahanKatalog, type BarisKatalog } from "@/features/BahanKatalog";
import { NavBar } from "@/design/NavBar";
import { Button, Card, Screen, StateView, T } from "@/design/ui";
import { C, TONE } from "@/design/tokens";

// RENCANA BAHAN (BOM) — PIC Bahan per pekerjaan LAYANAN (cermin BomPlanSheet web). POST /production-v2/runs/:runId/build/plan-bom
// dengan revisi RENCANA dari kartu. Acuan: racikan rencana dari Catatan Komponen. Menyimpan rencana TIDAK mengeluarkan stok —
// Gudang yang mereservasi & menyerahkan. Terkunci setelah bahan diserahkan Gudang.
export default function RencanaBahan() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const card = useRunCard(runId);
  const c = card.data;
  const catatan = useKomponen(c?.unit.id);
  const rencana = catatan.data?.sections?.PLAN_RACIKAN ?? null;
  const rujukan = useMemo(() => rujukanRacikan(rencana), [rencana]);
  const terkunci = c ? alasanBomTerkunci(c) : null;

  const awal = useMemo<BarisKatalog[]>(() => (c?.bom ?? []).map((b) => ({ materialId: b.materialId, code: b.code, name: b.name, unit: b.uom, qty: String(b.qty) })), [c?.bom]);
  const [ubahan, setUbahan] = useState<BarisKatalog[] | null>(null);
  const lines = ubahan ?? awal;
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const kunci = useRef(`pm-bom-${randomUUID()}`);
  const ubah = (v: BarisKatalog[]) => { setUbahan(v); setGalat(null); kunci.current = `pm-bom-${randomUUID()}`; };
  const ada = new Set(lines.map((l) => l.materialId));

  const simpan = async () => {
    if (!c) return;
    const rows = barisDari(lines.map((l) => ({ materialId: l.materialId, qty: l.qty })));
    const v = validasiBaris(rows, { wajibSatu: true });
    if (v) { setGalat(v); return; }
    if (samaDenganTersimpan(rows, c.bom ?? [])) { setGalat("Tidak ada perubahan pada rencana bahan."); return; }
    if (c.plan?.revision == null) { setGalat("Rencana produksi belum ada untuk unit ini."); return; }
    setBusy(true); setGalat(null);
    try {
      await simpanRencanaBahan(c.runId, c.plan.revision, payloadBaris(rows), kunci.current);
      await qc.invalidateQueries();
      Alert.alert("Tersimpan", "Rencana bahan tersimpan. Gudang yang mereservasi dan menyerahkan bahan.");
      router.back();
    } catch (e) {
      if (!bolehCobaLagi(e)) kunci.current = `pm-bom-${randomUUID()}`;
      setGalat(pesanUntukPengguna(e));
      if (e instanceof ApiError && e.code === "PLAN_REVISION_CONFLICT") { setUbahan(null); void card.refetch(); }
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen header={<NavBar judul="Rencana Bahan (BOM)" kembali="Batal" />} bottomPad={140}>
        {card.isLoading ? <StateView kind="loading" title="Memuat…" /> : null}
        {card.error ? <StateView kind="error" title="Kartu tidak bisa dimuat" text={pesanUntukPengguna(card.error)} onRetry={() => void card.refetch()} /> : null}

        {c ? (
          <>
            <Card style={{ backgroundColor: TONE.blue.tint, gap: 4 }}>
              <T.Sub style={{ color: TONE.blue.text }}>{c.unit.unitCode}{c.plan?.revision != null ? ` · rencana rev ${c.plan.revision}` : ""}</T.Sub>
              <T.Caption style={{ color: TONE.blue.text }}>Tentukan bahan katalog yang dibutuhkan pekerjaan ini. Menyimpan rencana tidak mengeluarkan stok — Gudang yang mereservasi dan menyerahkan bahan.</T.Caption>
            </Card>
            {terkunci ? <Card style={{ backgroundColor: TONE.orange.tint }}><T.Sub style={{ color: TONE.orange.text }}>{terkunci}</T.Sub></Card> : null}
            {!terkunci && bomMelepasReservasi(c) ? <Card style={{ backgroundColor: TONE.orange.tint }}><T.Sub style={{ color: TONE.orange.text }}>Bahan sudah direservasi Gudang. Mengubah BOM melepas reservasi — Gudang perlu mereservasi ulang.</T.Sub></Card> : null}

            <T.Headline style={{ marginHorizontal: 4 }}>Racikan dari PIC Meja/PIC QC (acuan)</T.Headline>
            {!rencana ? (
              <Card><T.Sub>{catatan.error ? "Racikan belum bisa dimuat." : catatan.isLoading ? "Memuat racikan…" : "Racikan rencana belum dicatat."}</T.Sub></Card>
            ) : (
              <Card padded={false}>
                {rujukan.catalog.map((r) => (
                  <View key={r.materialId} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T.Headline numberOfLines={1}>{r.name || r.code}</T.Headline>
                      <T.Caption numberOfLines={1}>{r.uses.map((u) => u.where).join(", ")}</T.Caption>
                    </View>
                    {!terkunci ? (
                      <Pressable accessibilityRole="button" disabled={ada.has(r.materialId)}
                        onPress={() => ubah([...lines, { materialId: r.materialId, code: r.code, name: r.name, unit: r.unit, qty: "" }])}
                        style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: 10, backgroundColor: TONE.blue.tint, justifyContent: "center", opacity: ada.has(r.materialId) ? 0.4 : 1 }}>
                        <T.Caption style={{ color: TONE.blue.text }}>{ada.has(r.materialId) ? "Sudah di BOM" : "Tambah ke BOM"}</T.Caption>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                {rujukan.unlinked.length ? <T.Caption style={{ padding: 14 }}>Tanpa katalog (pilih bahan katalog bila perlu): {rujukan.unlinked.map((u) => `${u.where} — ${u.label}`).join("; ")}</T.Caption> : null}
              </Card>
            )}

            <T.Headline style={{ marginHorizontal: 4 }}>BOM rencana</T.Headline>
            <DaftarBahanKatalog lines={lines} onChange={ubah} qtyLabel="Jumlah dibutuhkan" disabled={!!terkunci} kosong="Belum ada bahan di rencana." />
            {galat ? <Card style={{ backgroundColor: TONE.red.tint }}><T.Sub style={{ color: TONE.red.text }}>{galat}</T.Sub></Card> : null}
          </>
        ) : null}
      </Screen>

      {c ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 30, backgroundColor: C.barBg, borderTopWidth: 1, borderTopColor: C.barLine, gap: 6 }}>
          {!online ? <T.Caption style={{ textAlign: "center" }}>Offline — simpan saat sinyal kembali.</T.Caption> : null}
          <Button kind="success" icon={<Save color="#fff" size={20} />} label={c.bom?.length ? "Simpan Revisi Rencana Bahan" : "Simpan Rencana Bahan"} onPress={() => void simpan()} busy={busy} disabled={!online || !!terkunci} />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
