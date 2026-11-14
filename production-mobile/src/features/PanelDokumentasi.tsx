import React, { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { Camera, Images } from "lucide-react-native";
import { kirimDokumentasi, unggahDokumentasiTambahan, unggahFotoDokumentasi, useDokumentasi, useDokumentasiTambahan, type RuangKerja } from "@/api/order";
import type { BerkasLokal } from "@/api/aksi";
import { pesanUntukPengguna } from "@/api/errors";
import { MAKS_FOTO_SEKALI, chipKategori, kategoriTambahan, kelompokDokumentasi, type KategoriDok } from "./order";
import { Button, Card, Chip, StateView, T } from "@/design/ui";
import { haptic } from "@/design/haptics";
import { C, F, TONE } from "@/design/tokens";
import { urlMedia } from "@/lib/env";

// DOKUMENTASI ORDER — server menentukan SATU tujuan unggah per unit (tidak pernah dua):
//   • Dokumentasi Produksi V2 (matriks per kategori dengan jumlah minimal) — unit yang punya pekerjaan V2 yang menyala;
//   • Dokumentasi tambahan (kategori sama, tanpa minimal) — unit tanpa Dokumentasi V2, mis. order lama yang SUDAH TERKIRIM.
// Menambah foto tidak mengubah status produksi/QC/stok. Bila keduanya tidak tersedia, alasan dari server ditampilkan apa adanya.
export function PanelDokumentasi({ unitId, rk }: { unitId: string; rk: RuangKerja }) {
  const v2 = rk.dokumentasi;
  const tambahan = rk.dokumentasiTambahan;
  if (v2.tersedia) return <PanelV2 dok={v2} />;
  if (tambahan?.aktif) return <PanelTambahan unitId={unitId} boleh={tambahan.bolehUnggah} alasan={tambahan.alasan} />;
  return <Card><T.RowSub style={{ fontSize: 13, lineHeight: 18, color: C.ink2 }}>{tambahan?.alasan ?? v2.alasan ?? "Dokumentasi belum tersedia untuk unit ini."}</T.RowSub></Card>;
}

function PanelV2({ dok }: { dok: RuangKerja["dokumentasi"] }) {
  const q = useDokumentasi(dok.runId, true);
  const qc = useQueryClient();
  if (q.isLoading) return <StateView kind="loading" title="Memuat dokumentasi…" />;
  if (q.error) return <StateView kind="error" title="Dokumentasi tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} />;
  const boleh = dok.bolehUnggah && !!q.data?.canWrite;
  return (
    <DaftarKategori categories={q.data?.categories} boleh={boleh} alasan={dok.alasan ?? "Akun ini hanya bisa melihat dokumentasi."}
      kirim={async (k, berkas) => {
        const terunggah = await unggahFotoDokumentasi(dok.runId!, berkas);
        await kirimDokumentasi(dok.runId!, k, terunggah, `dok-${randomUUID()}`);
        await qc.invalidateQueries({ queryKey: ["dokumentasi", dok.runId] });
        return `${terunggah.length} foto ditambahkan.`;
      }} />
  );
}

function PanelTambahan({ unitId, boleh, alasan }: { unitId: string; boleh: boolean; alasan: string | null }) {
  const q = useDokumentasiTambahan(unitId);
  const qc = useQueryClient();
  if (q.isLoading) return <StateView kind="loading" title="Memuat dokumentasi…" />;
  if (q.error) return <StateView kind="error" title="Dokumentasi tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} />;
  return (
    <View style={{ gap: 8 }}>
      <Card><T.RowSub style={{ fontSize: 13, lineHeight: 18, color: C.ink2 }}>Dokumentasi tambahan — untuk unit tanpa alur Dokumentasi Produksi (mis. order yang sudah terkirim). Foto ikut berkas dokumentasi order di SANSS Web.</T.RowSub></Card>
      <DaftarKategori categories={kategoriTambahan(q.data?.categories)} boleh={boleh && !!q.data?.bolehUnggah} alasan={alasan ?? q.data?.alasan ?? "Akun ini hanya bisa melihat dokumentasi."}
        kirim={async (k, berkas) => {
          const r = await unggahDokumentasiTambahan(unitId, k, berkas);
          await qc.invalidateQueries({ queryKey: ["dokumentasi-tambahan", unitId] });
          return r.ditambah ? `${r.ditambah} foto ditambahkan.${r.dilewati ? ` ${r.dilewati} sudah ada sebelumnya.` : ""}` : "Foto ini sudah ada di kategori ini.";
        }} />
    </View>
  );
}

/** Kartu per kategori (Sebelum · Proses · Sesudah): jumlah foto, galeri mini, tombol Kamera/Galeri. */
function DaftarKategori({ categories, boleh, alasan, kirim }: {
  categories: KategoriDok[] | undefined; boleh: boolean; alasan: string; kirim: (kategori: string, berkas: BerkasLokal[]) => Promise<string>;
}) {
  const [sibuk, setSibuk] = useState<string | null>(null); // kunci kategori yang sedang mengunggah
  const [pesan, setPesan] = useState<{ kategori: string; ok: boolean; teks: string } | null>(null);
  const grup = kelompokDokumentasi(categories);

  async function tambah(k: KategoriDok, galeri: boolean) {
    try {
      const izin = galeri ? await ImagePicker.requestMediaLibraryPermissionsAsync() : await ImagePicker.requestCameraPermissionsAsync();
      if (!izin.granted) { Alert.alert(galeri ? "Izin galeri ditolak" : "Izin kamera ditolak", "Buka Pengaturan HP untuk mengizinkannya."); return; }
      const r = galeri
        ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: MAKS_FOTO_SEKALI, quality: 0.7 })
        : await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
      if (r.canceled || !r.assets.length) return;
      setSibuk(k.key); setPesan(null);
      const teks = await kirim(k.key, r.assets.slice(0, MAKS_FOTO_SEKALI).map((a) => ({ uri: a.uri, mimeType: a.mimeType, fileName: a.fileName, type: "image" as const })));
      haptic.sukses();
      setPesan({ kategori: k.key, ok: true, teks });
    } catch (e) {
      setPesan({ kategori: k.key, ok: false, teks: pesanUntukPengguna(e) });
    } finally { setSibuk(null); }
  }

  return (
    <View style={{ gap: 8 }}>
      {!boleh ? <Card><T.RowSub style={{ fontSize: 13, color: C.ink2 }}>{alasan}</T.RowSub></Card> : null}
      {grup.map((g) => (
        <View key={g.key} style={{ gap: 8 }}>
          <T.RowSub style={{ marginHorizontal: 4, marginTop: 4, letterSpacing: 0.4 }}>{g.label.toUpperCase()}</T.RowSub>
          {g.kategori.map((k) => {
            const chip = chipKategori(k);
            return (
              <Card key={k.key} style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <T.Row numberOfLines={1} style={{ flex: 1 }}>{k.label}</T.Row>
                  <Chip label={chip.label} tone={chip.tone} />
                </View>
                {k.items?.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {k.items.map((it, i) => (
                      <Image key={`${it.url}-${i}`} source={{ uri: urlMedia(it.url) ?? undefined }} contentFit="cover" transition={150} accessibilityLabel={`Foto ${k.label} ${i + 1}`}
                        style={{ width: 72, height: 72, borderRadius: 14, backgroundColor: C.isian }} />
                    ))}
                  </ScrollView>
                ) : null}
                {boleh ? (
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Button kind="tinted" label="Kamera" icon={<Camera size={16} color="#0056B3" strokeWidth={2.2} />} disabled={!!sibuk} busy={sibuk === k.key} onPress={() => void tambah(k, false)} style={{ flex: 1, minHeight: 40 }} />
                    <Button kind="tinted" label="Galeri" icon={<Images size={16} color="#0056B3" strokeWidth={2.2} />} disabled={!!sibuk} onPress={() => void tambah(k, true)} style={{ flex: 1, minHeight: 40 }} />
                  </View>
                ) : null}
                {sibuk === k.key ? <T.RowSub>Mengunggah…</T.RowSub> : null}
                {pesan?.kategori === k.key ? <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: F.semibold, fontSize: 12.5, color: pesan.ok ? TONE.green.text : TONE.red.text }}>{pesan.teks}</Text> : null}
              </Card>
            );
          })}
        </View>
      ))}
      {!grup.length ? <Card><T.RowSub style={{ fontSize: 13 }}>Belum ada kategori dokumentasi yang berlaku untuk unit ini.</T.RowSub></Card> : null}
    </View>
  );
}
