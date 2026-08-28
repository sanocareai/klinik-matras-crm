-- Pecah authorityStructureFollowed (1 boolean gabungan) jadi 4 kolom granular
-- per langkah Struktur Authority Communication. Kolom lama TETAP ADA sbg
-- legacy (dihitung ulang di kode sbg AND() dari 4 kolom baru).
ALTER TABLE "ConversationQualityScore" ADD COLUMN "authorityReferensiPresent" BOOLEAN;
ALTER TABLE "ConversationQualityScore" ADD COLUMN "authorityHedgeLanguageUsed" BOOLEAN;
ALTER TABLE "ConversationQualityScore" ADD COLUMN "authorityMekanismeExplained" BOOLEAN;
ALTER TABLE "ConversationQualityScore" ADD COLUMN "authoritySolusiConnected" BOOLEAN;
