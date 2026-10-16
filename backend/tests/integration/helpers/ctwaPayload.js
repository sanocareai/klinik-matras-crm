// Pembangun payload webhook WAHA GOWS bersinyal CTWA untuk tes integrasi atribusi (data sintetis; tanpa identitas nyata).
export const CLID_UJI = "AfhKBK8ZBWyKw3p49jW-KFh_rNlyzXmCKW0eSdHULJZtXqZk";
export const TEKS_UJI = "rahasia keluhan pinggang canary";
export const NAMA_UJI = "Budi Canary Santoso";

export function gowsPayload({ phone, msgId, ad = null, sourceType = "ad", clid = CLID_UJI, penanda = true, ctwa = true, url = "https://www.instagram.com/p/DcgquCfg3_4/" }) {
  const ctx = ctwa ? {
    ...(penanda ? { conversionSource: "FB_Ads", entryPointConversionSource: "ctwa_ad", entryPointConversionApp: "instagram", entryPointConversionDelaySeconds: 18 } : {}),
    externalAdReply: { sourceURL: url, ...(ad ? { sourceID: ad, sourceType } : {}), ...(clid ? { ctwaClid: clid } : {}) },
  } : undefined;
  return {
    id: `false_${phone}@c.us_${msgId}`, from: `${phone}@c.us`, fromMe: false, body: TEKS_UJI, hasMedia: false, timestamp: Math.floor(Date.now() / 1000),
    _data: { Info: { Chat: `${phone}@c.us`, Sender: `${phone}@c.us`, PushName: NAMA_UJI, Type: "text" }, Message: { extendedTextMessage: { text: TEKS_UJI, ...(ctx ? { contextInfo: ctx } : {}) } } },
  };
}

export const bungkusWebhook = (event, payload) => ({ event, session: "default", engine: "GOWS", payload });
