import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import { Send } from "lucide-react-native";
import { catatLangkah, kunciNiat } from "@/api/aksi";
import { ApiError, pesanUntukPengguna } from "@/api/errors";
import { useRunCard } from "@/api/production";
import {
  CHECKLIST_CORNER, KESESUAIAN, VERDIK_TEKSTUR, LABEL_KONFIRMASI_SALES, MATERIAL_LAMA, MODE_KAIN, MODEL_KASUR, PETUNJUK, PETUNJUK_PENGERJAAN, PETUNJUK_PENGERJAAN_KASUR,
  aturanMedia, bolehCobaLagi, formulirDidukung, labelTahap, langkahBahanOlehPic, payloadLangkah, validasiLangkah, type FormLangkah,
} from "@/features/langkah";
import { alurProduk } from "@/features/picBahan";
import { BahanDipakai, BahanOlehPic, PermintaanCorner, PratinjauSelesai } from "@/features/Bahan";
import { PanelLampiran, useLampiran } from "@/features/Lampiran";
import { beratPemakai } from "@/features/model";
import { PilihBerat } from "@/features/PilihBerat";
import { CentangBaris, Isian, PilihanChip } from "@/design/Form";
import { NavBar } from "@/design/NavBar";
import { Button, Card, Screen, StateView, T } from "@/design/ui";
import { C, TONE } from "@/design/tokens";

// FORMULIR TAHAP — isian + foto/video wajib per tahap, lalu POST /production-v2/runs/:runId/steps/:stepNo.
// Revisi & aksi berikutnya selalu dari kartu server; bila kartu berubah di tempat lain (revisi basi), server menolak
// dan layar kembali ke Detail Unit yang sudah dimuat ulang. Offline: tombol kirim mati, tidak ada "berhasil" palsu.
export default function Langkah() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const card = useRunCard(runId);
  const lamp = useLampiran(runId);
  const [f, setF] = useState<FormLangkah>({});
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const set = (p: Partial<FormLangkah>) => { setF((x) => ({ ...x, ...p })); setGalat(null); };

  const c = card.data;
  const next = c?.next;
  const stepNo = next?.stepNo ?? 0;
  const dukung = c && next ? formulirDidukung(c, next) : null;
  const cornerV2 = !!c?.cornerView?.contractV2;
  const byPic = !!c && langkahBahanOlehPic(c, stepNo);
  const build = c?.track === "BUILD";
  const alur = c ? alurProduk(c) : null;
  const judulTahap = labelTahap(stepNo, c?.track);
  const petunjuk = build && stepNo === 6 ? (alur === "KASUR" && !byPic ? PETUNJUK_PENGERJAAN_KASUR : PETUNJUK_PENGERJAAN) : PETUNJUK[stepNo];
  const brief = c?.cornerView?.request ?? null;
  const diserahkan = c?.issuedMaterials ?? [];
  const aturan = aturanMedia(stepNo, c?.track);
  const pemakai = beratPemakai(c?.customer);
  // Berat penguji bawaan = berat pemakai PERTAMA dari order (diisi Sales); bisa diganti chip lain atau diketik.
  const beratBawaan = pemakai[0] ? String(pemakai[0].kg) : "";

  const kirim = async () => {
    if (!c || !next) return;
    if (lamp.sibuk) { setGalat("Tunggu unggahan selesai."); return; }
    if (lamp.adaGagal) { setGalat("Ada unggahan gagal — ulangi atau hapus dulu."); return; }
    // Berat penguji uji fondasi: bawaan = berat badan customer (sama dengan yang tampil di isian).
    const isi: FormLangkah = (stepNo === 4 || stepNo === 8) && f.testerWeightKg === undefined && beratBawaan ? { ...f, testerWeightKg: beratBawaan } : f;
    const v = validasiLangkah(stepNo, isi, lamp.selesai, { track: c.track, alur, gated: !!next.gated, cornerV2, byPic, cornerBrief: brief });
    if (v) { setGalat(v); return; }
    setBusy(true); setGalat(null);
    const kunci = kunciNiat.untuk(c.runId, stepNo, c.revision);
    try {
      await catatLangkah({ runId: c.runId, revision: c.revision, workCenterId: c.workCenterId }, stepNo, payloadLangkah(stepNo, isi, { cornerV2, byPic, track: c.track, alur }), lamp.selesai.map((m) => m.url), kunci);
      kunciNiat.lepas(c.runId, stepNo, c.revision);
      await qc.invalidateQueries();
      router.back();
    } catch (e) {
      if (!bolehCobaLagi(e)) kunciNiat.lepas(c.runId, stepNo, c.revision);
      setGalat(pesanUntukPengguna(e));
      const kode = e instanceof ApiError ? e.code : "";
      if (kode === "STEP_REVISION_CONFLICT" || kode === "STEP_OUT_OF_ORDER" || kode.startsWith("STEP_WAITING_")) void card.refetch();
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen lembar header={<NavBar judul={stepNo ? `Tahap ${stepNo} · ${judulTahap}` : "Tahap"} kembali="Batal" />} bottomPad={140}>
        {card.isLoading ? <StateView kind="loading" title="Memuat…" /> : null}
        {card.error ? <StateView kind="error" title="Kartu tidak bisa dimuat" text={pesanUntukPengguna(card.error)} onRetry={() => void card.refetch()} /> : null}
        {dukung && !dukung.ok ? <StateView kind="empty" title="Isi lewat SANSS Web" text={dukung.alasan} /> : null}

        {c && dukung?.ok ? (
          <>
            <Card style={{ backgroundColor: TONE.blue.tint }}>
              <T.Sub style={{ color: TONE.blue.text }}>{next?.rework ? "Rework — " : ""}{petunjuk}</T.Sub>
            </Card>

            {stepNo === 1 ? (
              <>
                <CentangBaris label="Ukuran & kondisi kain luar sudah dicek" value={!!f.conditionConfirmed} onChange={(v) => set({ conditionConfirmed: v })} />
                <Isian label="Catatan kondisi (opsional)" value={f.conditionNote ?? ""} onChange={(v) => set({ conditionNote: v })} multiline placeholder="mis. kain sobek di sudut kiri" />
              </>
            ) : null}
            {stepNo === 2 ? <Isian label="Catatan rasa awal" value={f.feelNote ?? ""} onChange={(v) => set({ feelNote: v })} multiline placeholder="mis. tengah terasa amblas, pinggir keras" /> : null}
            {stepNo === 3 ? (
              <>
                <PilihanChip label={next?.gated ? "Material lama (opsional)" : "Material lama yang ditemukan"} multi options={MATERIAL_LAMA} value={(f.oldMaterials ?? []) as (typeof MATERIAL_LAMA)[number]["value"][]} onChange={(v) => set({ oldMaterials: v })} />
                <Isian label="Catatan (opsional)" value={f.note ?? ""} onChange={(v) => set({ note: v })} multiline />
              </>
            ) : null}
            {stepNo === 4 ? (
              <>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}><Isian label="Tinggi awal" value={f.heightBeforeCm ?? ""} onChange={(v) => set({ heightBeforeCm: v })} keyboardType="decimal-pad" suffix="cm" /></View>
                  <View style={{ flex: 1 }}><Isian label="Saat ditekan" value={f.heightCompressedCm ?? ""} onChange={(v) => set({ heightCompressedCm: v })} keyboardType="decimal-pad" suffix="cm" /></View>
                </View>
                <PilihBerat label="Berat penguji (seberat pemakai)" value={f.testerWeightKg ?? beratBawaan} onChange={(v) => set({ testerWeightKg: v })} pemakai={pemakai} />
                <Isian label="Catatan (opsional)" value={f.note ?? ""} onChange={(v) => set({ note: v })} multiline />
              </>
            ) : null}
            {build && stepNo === 6 ? (
              <>
                {alur === "UNCONFIRMED" ? (
                  <Card style={{ backgroundColor: TONE.orange.tint }}>
                    <T.Sub style={{ color: TONE.orange.text }}>Jenis produk belum jelas pada order{c.product?.problem ? ` (${c.product.problem})` : ""} — racikan kasur ditahan sampai Sales mengonfirmasi. Catatan & dokumentasi umum tetap bisa dikirim.</T.Sub>
                  </Card>
                ) : null}
                {byPic ? <BahanOlehPic card={c} /> : (
                  <>
                    {alur === "KASUR" ? (
                      <>
                        <Isian label="Racikan fondasi" value={f.racikanFondasi ?? ""} onChange={(v) => set({ racikanFondasi: v })} placeholder="mis. pocket spring 25 cm + penguat pinggir" />
                        <Isian label="Racikan lapisan" value={f.racikanLapisan ?? ""} onChange={(v) => set({ racikanLapisan: v })} placeholder="mis. latex 3 cm + busa D23 2 cm" />
                      </>
                    ) : null}
                    <BahanDipakai diserahkan={diserahkan} value={f.materials ?? []} onChange={(v) => set({ materials: v })}
                      kosong="Belum ada bahan yang diserahkan Gudang untuk pekerjaan ini (bahan opsional di jalur ini)." />
                  </>
                )}
                <Isian label="Penjelasan pengerjaan" value={f.note ?? ""} onChange={(v) => set({ note: v })} multiline placeholder="mis. kasur custom 160×200, sesuai spesifikasi Sales" />
              </>
            ) : null}
            {!build && (stepNo === 6 || stepNo === 7) ? (
              <>
                {byPic ? <BahanOlehPic card={c} /> : (
                  <BahanDipakai diserahkan={diserahkan} value={f.materials ?? []} onChange={(v) => set({ materials: v })}
                    kosong="Belum ada bahan yang diserahkan Gudang untuk unit ini. Kalau bahannya belum ada, kembali lalu tekan Bahan kurang." />
                )}
                <Isian label={stepNo === 6 ? "Penjelasan isi fondasi" : "Catatan lapisan (opsional)"} value={f.note ?? ""} onChange={(v) => set({ note: v })} multiline
                  placeholder={stepNo === 6 ? "mis. pocket spring baru + penguat pinggir" : undefined} />
              </>
            ) : null}
            {stepNo === 10 ? (
              <>
                {cornerV2 ? (
                  <>
                    <PermintaanCorner cv={c.cornerView} />
                    <CentangBaris label="Permintaan Sales di atas sudah saya periksa" value={!!f.requestChecked} onChange={(v) => set({ requestChecked: v })} />
                    <PilihanChip label="Kain yang dipakai" options={MODE_KAIN} value={f.fabricMode ? [f.fabricMode as (typeof MODE_KAIN)[number]["value"]] : []} onChange={(v) => set({ fabricMode: v[0] })} />
                    <PilihanChip label="Kesesuaian dengan permintaan Sales" options={KESESUAIAN} value={f.requestMatch ? [f.requestMatch as (typeof KESESUAIAN)[number]["value"]] : []} onChange={(v) => set({ requestMatch: v[0] })} />
                    {f.requestMatch === "ADA_PERBEDAAN" ? <Isian label="Jelaskan perbedaannya (wajib)" value={f.requestNote ?? ""} onChange={(v) => set({ requestNote: v })} multiline /> : null}
                    {brief?.needsSalesConfirmation || f.fabricMode === "NEW_INSTALLED" ? (
                      <Isian label={brief?.needsSalesConfirmation ? `Konfirmasi Sales yang dicatat (${LABEL_KONFIRMASI_SALES}) *` : "Konfirmasi Sales yang dicatat (opsional)"}
                        value={f.salesConfirmation ?? ""} onChange={(v) => set({ salesConfirmation: v })} multiline placeholder="mis. Sales (telepon): motif polos, abu-abu tua" />
                    ) : null}
                  </>
                ) : null}
                <PilihanChip label="Model kasur" options={MODEL_KASUR} value={f.mattressStyle ? [f.mattressStyle as (typeof MODEL_KASUR)[number]["value"]] : []} onChange={(v) => set({ mattressStyle: v[0] })} />
                <Isian label="Spesifikasi / warna kain" value={f.fabricSpec ?? ""} onChange={(v) => set({ fabricSpec: v })} placeholder="mis. Knitting putih quilting" />
                <Isian label="Warna list" value={f.borderColor ?? ""} onChange={(v) => set({ borderColor: v })} placeholder="mis. Abu-abu tua" />
                {diserahkan.length ? (
                  <>
                    <T.Sub style={{ marginHorizontal: 4 }}>Bahan kain dari Gudang (opsional)</T.Sub>
                    <BahanDipakai diserahkan={diserahkan} value={f.materials ?? []} onChange={(v) => set({ materials: v })} kosong="" />
                  </>
                ) : null}
              </>
            ) : null}
            {stepNo === 8 ? (
              <>
                {next?.lastVerdict ? <Card style={{ backgroundColor: TONE.orange.tint }}><T.Sub style={{ color: TONE.orange.text }}>Uji sebelumnya: {VERDIK_TEKSTUR.find((v) => v.value === next.lastVerdict)?.label ?? next.lastVerdict}. Lapisan sudah disesuaikan.</T.Sub></Card> : null}
                <PilihanChip label="Hasil uji tekstur akhir" options={VERDIK_TEKSTUR} value={f.verdict ? [f.verdict as (typeof VERDIK_TEKSTUR)[number]["value"]] : []} onChange={(v) => set({ verdict: v[0] })} />
                {f.verdict && f.verdict !== "PAS" ? <Card style={{ backgroundColor: TONE.orange.tint }}><T.Sub style={{ color: TONE.orange.text }}>Hasil ini mewajibkan rework: sesuaikan lapisan lalu kirim ulang bukti lapisan.</T.Sub></Card> : null}
                <PilihBerat label="Berat penguji (seberat pemakai)" value={f.testerWeightKg ?? beratBawaan} onChange={(v) => set({ testerWeightKg: v })} pemakai={pemakai} />
                <Isian label="Catatan (opsional)" value={f.note ?? ""} onChange={(v) => set({ note: v })} multiline />
              </>
            ) : null}
            {stepNo === 9 ? <Isian label="Catatan untuk Corner (opsional)" value={f.note ?? ""} onChange={(v) => set({ note: v })} multiline /> : null}
            {stepNo === 11 ? (
              <>
                {CHECKLIST_CORNER.map((k) => (
                  <CentangBaris key={k.key} label={k.label} value={!!f.checklist?.[k.key]} onChange={(v) => set({ checklist: { ...(f.checklist ?? {}), [k.key]: v } })} />
                ))}
                {cornerV2 ? (
                  <>
                    <Isian label="Pekerjaan Corner yang dilakukan" value={f.cornerWork ?? ""} onChange={(v) => set({ cornerWork: v })} multiline />
                    <CentangBaris label="Tidak ada perbedaan dari permintaan" value={!!f.noDifference} onChange={(v) => set({ noDifference: v })} />
                    {!f.noDifference ? <Isian label="Catatan perbedaan" value={f.differenceNote ?? ""} onChange={(v) => set({ differenceNote: v })} multiline /> : null}
                  </>
                ) : null}
                <Isian label="Catatan (opsional)" value={f.note ?? ""} onChange={(v) => set({ note: v })} multiline />
              </>
            ) : null}
            {stepNo === 12 ? (
              <>
                {cornerV2 && !c.adaptation ? <PratinjauSelesai runId={c.runId} revision={c.revision} /> : null}
                <CentangBaris label="Kasur selesai & siap diserahkan" value={!!f.confirm} onChange={(v) => set({ confirm: v })} />
                <Isian label="Catatan (opsional)" value={f.note ?? ""} onChange={(v) => set({ note: v })} multiline />
              </>
            ) : null}

            <PanelLampiran l={lamp} aturan={aturan} disabled={busy} />
            {galat ? <Card style={{ backgroundColor: TONE.red.tint }}><T.Sub style={{ color: TONE.red.text }}>{galat}</T.Sub></Card> : null}
            {!online ? <Card style={{ backgroundColor: TONE.orange.tint }}><T.Sub style={{ color: TONE.orange.text }}>Offline — isian tetap di layar ini; kirim saat sinyal kembali. Belum ada yang terkirim.</T.Sub></Card> : null}
          </>
        ) : null}
      </Screen>

      {c && dukung?.ok ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 30, backgroundColor: C.barBg, borderTopWidth: 1, borderTopColor: C.barLine }}>
          <Button
            label={busy ? "Mengirim…" : lamp.sibuk ? "Menunggu unggahan…" : `Kirim ${judulTahap}`}
            kind="success"
            icon={<Send color="#fff" size={20} />}
            onPress={() => void kirim()}
            busy={busy}
            disabled={!online || lamp.sibuk}
          />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
