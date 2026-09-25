import AsyncStorage from "@react-native-async-storage/async-storage";
import { File, UploadType } from "expo-file-system";
import { createApiClient, createSessionManager, createBiayaArmadaApi } from "@sano/delivery-shared";

export const DEFAULT_SERVER = "https://app.sanomatrassehat.com";

// Upload multipart lewat expo-file-system (FormData {uri,name,type} tidak didukung
// di New Architecture) — pola sama dengan Sano Driver.
async function uploadImpl(url, file, { fieldName, fields, headers, signal }) {
  const ref = new File(file.uri);
  const result = await ref.upload(url, {
    httpMethod: "POST",
    uploadType: UploadType.MULTIPART,
    fieldName,
    mimeType: file.type || "image/jpeg",
    parameters: fields,
    headers,
    signal,
  });
  return { status: result.status, body: result.body };
}

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export const client = createApiClient({
  serverUrl: DEFAULT_SERVER,
  storage: AsyncStorage,
  uploadImpl,
  tokenKey: "control:token",
  onUnauthorized: () => onUnauthorized && onUnauthorized(),
});

export const sessionManager = createSessionManager({ client, storage: AsyncStorage });
export const biayaArmadaApi = createBiayaArmadaApi(client);
