import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { randomUUID } from "expo-crypto";
import { Camera, ClipboardCheck, Images, X } from "lucide-react-native";
import { ApiError, pesanUntukPengguna } from "@/api/errors";
import { useRunCard } from "@/api/production";
import { simpanPutusanQc, unggahFotoUnit, useAssembly, useQcRun } from "@/api/qc";
import { beratPemakai, kodePendek } from "@/features/model";
import { PilihBerat } from "@/features/PilihBerat";
import { VERDICT_GAGAL, bodyQc, gerbangLulus, opsiRework, validasiQc, type FormQc, type ModeQc } from "@/features/qc";
import { bolehCobaLagi } from "@/features/langkah";
import { Isian, PilihanChip } from "@/design/Form";
import { NavBar } from "@/design/NavBar";
import { Button, Card, Screen, StateView, T } from "@/design/ui";
import { C, F, TONE } from "@/design/tokens";
import { urlMedia } from "@/lib/env";

// PUTUSAN QC (Uji Berat Badan) — Lulus atau Gagal → rework. Command & aturan SAMA dengan Aplikasi PIC QC web.
// Berat acuan terisi otomatis dari ORDER (berat pemakai yang diisi Sales); tetap bisa diganti.
export default function PutusanQc() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const run = useQcRun(runId);
  const card = useRunCard(runId);
  const unitId = run.data?.unit.id;
  const asm = useAssembly(unitId);
  const profil = run.data?.qcProfile ?? (run.data?.track === "BUILD" ? "GENERIC" : "KASUR");
  const pemakai = beratPemakai(card.data?.customer);
  const [f, setF] = useState<FormQc>({ mode: "PASS", photoUrls: [], referenceWeightKg: "", fitVerdict: "PAS", note: "", reworkStageId: "" });
  const [unggah, setUnggah] = useState(0);
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const kunci = useRef(`pm-qc-${randomUUID()}`);
  const set = (p: Partial<FormQc>) => { setF((x) => ({ ...x, ...p })); setGalat(null); kunci.current = `pm-qc-${randomUUID()}`; };

  const berat = f.referenceWeightKg || (pemakai[0] ? String(pemakai[0].kg) : "");
  const gerbang = gerbangLulus(asm.data?.assembly as never);
  const tahapRework = useMemo(() => opsiRework(run.data?.stages), [run.data]);
  const lulusTerkunci = f.mode === "PASS" && !gerbang.ok;

  const ambilFoto = async (galeri: boolean) => {
    if (!unitId) return;
    try {
      const izin = galeri ? await ImagePicker.requestMediaLibraryPermissionsAsync() : await ImagePicker.requestCameraPermissionsAsync();
      if (!izin.granted) { Alert.alert("Izin ditolak", "Buka Pengaturan HP untuk mengizinkan kamera/galeri."); return; }
      const r = galeri
        ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 6, quality: 0.7 })
        : await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
      if (r.canceled) return;
      for (const a of r.assets) {
        setUnggah((n) => n + 1);
        try {
          const url = await unggahFotoUnit(unitId, a.uri, a.mimeType);
          setF((x) => ({ ...x, photoUrls: [...x.photoUrls, url] }));
        } catch (e) { setGalat(pesanUntukPengguna(e)); } finally { setUnggah((n) => n - 1); }
      }
    } catch { Alert.alert("Kamera tidak bisa dibuka", "Coba lagi, atau pilih dari galeri."); }
  };

  const kirim = async () => {
    const r = run.data;
    if (!r) return;
    if (lulusTerkunci) { setGalat(gerbang.pesan); return; }
    const isi = { ...f, referenceWeightKg: berat };
    const v = validasiQc(isi, profil);
    if (v) { setGalat(v); return; }
    setBusy(true); setGalat(null);
    try {
      await simpanPutusanQc(runId, bodyQc(isi, r.revision, profil), kunci.current);
      await qc.invalidateQueries();
      router.back();
    } catch (e) {
      if (!bolehCobaLagi(e)) kunci.current = `pm-qc-${randomUUID()}`;
      setGalat(pesanUntukPengguna(e));
      if (e instanceof ApiError && e.code === "QC_REVISION_CONFLICT") void run.refetch();
    } finally { setBusy(false); }
  };

  const judul = run.data ? `QC · ${kodePendek(run.data.unit.unitCode)}` : "Putusan QC";
  const gagal = f.mode === "FAIL";

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen lembar header={<NavBar judul={judul} kembali="Antrean" />} bottomPad={140}>
        {run.isLoading ? <StateView kind="loading" title="Memuat…" /> : null}
        {run.error ? <StateView kind="error" title="Unit QC tidak bisa dimuat" text={pesanUntukPengguna(run.error)} onRetry={() => void run.refetch()} /> : null}
        {run.data && run.data.state !== "AWAITING_QC" ? <StateView kind="empty" title="Unit ini tidak sedang menunggu QC" text="Mungkin sudah diputuskan di perangkat lain." /> : null}

        {run.data && run.data.state === "AWAITING_QC" ? (
          <>
            {card.data ? (
              <Card style={{ gap: 4 }}>
                <T.Title>{card.data.customer.name ?? "Customer"}</T.Title>
                <T.Sub>{[card.data.unit.merk, card.data.unit.ukuran, card.data.plan?.stationLabel].filter(Boolean).join(" · ")}</T.Sub>
              </Card>
            ) : null}

            <View style={{ flexDirection: "row", gap: 8 }}>
              {([["PASS", "Lulus"], ["FAIL", "Gagal → rework"]] as [ModeQc, string][]).map(([k, l]) => {
                const on = f.mode === k;
                const tone = k === "PASS" ? TONE.green : TONE.red;
                return (
                  <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => set({ mode: k, fitVerdict: k === "FAIL" ? "TERLALU_KERAS" : "PAS" })}
                    style={{ flex: 1, height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: on ? tone.fill : C.card, borderWidth: on ? 0 : 1.5, borderColor: "#D1D1D6" }}>
                    <Text style={{ fontFamily: F.bold, fontSize: 16, color: on ? "#fff" : C.ink }}>{l}</Text>
                  </Pressable>
                );
              })}
            </View>
            {f.mode === "PASS" ? (
              <Card style={{ backgroundColor: gerbang.ok ? TONE.green.tint : TONE.orange.tint }}>
                <T.Sub style={{ color: gerbang.ok ? TONE.green.text : TONE.orange.text }}>
                  {gerbang.ok ? (gerbang.bagian.length ? `Gerbang putaran ini lengkap: ${gerbang.bagian.join(" · ")}.` : "Siap diputuskan.") : gerbang.pesan}
                </T.Sub>
              </Card>
            ) : null}

            {profil === "KASUR" ? <PilihBerat label="Berat acuan uji (kg)" value={berat} onChange={(v) => set({ referenceWeightKg: v.replace(/[^0-9]/g, "") })} pemakai={pemakai} /> : null}
            {gagal && profil === "KASUR" ? (
              <PilihanChip label="Hasil uji berat badan" options={VERDICT_GAGAL} value={[f.fitVerdict as (typeof VERDICT_GAGAL)[number]["value"]]} onChange={(v) => v[0] && set({ fitVerdict: v[0] })} />
            ) : null}
            <Isian label={gagal ? "Alasan / temuan (wajib)" : "Catatan (opsional)"} value={f.note} onChange={(v) => set({ note: v })} multiline placeholder={gagal ? "mis. tengah masih agak turun saat dibebani" : undefined} />
            {gagal ? (
              <PilihanChip label="Tahap rework (unit wajib diuji lagi)" options={tahapRework.map((s) => ({ value: s.id, label: s.label }))} value={f.reworkStageId ? [f.reworkStageId] : []} onChange={(v) => set({ reworkStageId: v[0] ?? "" })} />
            ) : null}

            <View style={{ gap: 8 }}>
              <T.Eyebrow style={{ marginLeft: 4 }}>Foto bukti · wajib {f.photoUrls.length ? `(${f.photoUrls.length})` : ""}</T.Eyebrow>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button kind="tinted" tone="purple" label="Foto" icon={<Camera color={TONE.purple.text} size={20} />} onPress={() => void ambilFoto(false)} style={{ flex: 1 }} />
                <Button kind="tinted" tone="purple" label="Galeri" icon={<Images color={TONE.purple.text} size={20} />} onPress={() => void ambilFoto(true)} style={{ flex: 1 }} />
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {f.photoUrls.map((u) => (
                  <View key={u} style={{ width: 84, height: 84, borderRadius: 14, overflow: "hidden", backgroundColor: C.fill }}>
                    <Image source={{ uri: urlMedia(u)! }} style={{ flex: 1 }} contentFit="cover" />
                    <Pressable accessibilityRole="button" accessibilityLabel="Hapus foto" onPress={() => set({ photoUrls: f.photoUrls.filter((x) => x !== u) })} hitSlop={8}
                      style={{ position: "absolute", top: 4, right: 4, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}>
                      <X color="#fff" size={15} />
                    </Pressable>
                  </View>
                ))}
                {unggah > 0 ? <View style={{ width: 84, height: 84, borderRadius: 14, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View> : null}
              </View>
            </View>
            {galat ? <Card style={{ backgroundColor: TONE.red.tint }}><T.Sub style={{ color: TONE.red.text }}>{galat}</T.Sub></Card> : null}
          </>
        ) : null}
      </Screen>

      {run.data?.state === "AWAITING_QC" ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 30, gap: 6, backgroundColor: C.barBg, borderTopWidth: 1, borderTopColor: C.barLine }}>
          {!online ? <T.Caption style={{ textAlign: "center" }}>Offline — kirim saat sinyal kembali.</T.Caption> : null}
          <Button
            kind={gagal ? "destructive" : "success"}
            icon={<ClipboardCheck color="#fff" size={20} />}
            label={gagal ? "Simpan — Gagal & Buka Rework" : "Simpan — Lulus"}
            onPress={() => void kirim()}
            busy={busy}
            disabled={!online || unggah > 0 || lulusTerkunci}
          />
        </View>
      ) : null}
    </View>
  );
}
