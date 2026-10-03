// P12B.3 — kapan Unit 360 TIDAK tersedia untuk sebuah unit (murni, diuji). Server menjawab 404 untuk unit di luar cohort Production V2 atau reader OFF
// (cohort tidak diperluas oleh slice ini). Pemanggil yang menyediakan `fallback` menampilkan data order asli, bukan pesan galat.
export const isOutsideV2 = (e) => e?.status === 404 || e?.code === "UNIT_NOT_FOUND" || e?.code === "PRODUCTION_V2_READER_OFF";
