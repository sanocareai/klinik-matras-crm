-- Preferensi notifikasi push per kategori (Finance Mobile S11). Aditif: tabel baru, tidak menyentuh data lama.
CREATE TABLE "mobile_notification_prefs" (
    "user_id" TEXT NOT NULL,
    "categories" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_notification_prefs_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "mobile_notification_prefs" ADD CONSTRAINT "mobile_notification_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
