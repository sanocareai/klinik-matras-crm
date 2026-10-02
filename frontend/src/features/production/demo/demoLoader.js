// Chunk dataset demo — dimuat HANYA lewat import() dinamis setelah server mengizinkan (ADMIN/OWNER). Tidak ada di bundel utama.
import snapshot from "./demoSnapshot.json";
import { buildResolver } from "./demoDataset.js";

export async function loadDemoResolver() { return buildResolver(snapshot); }
export const demoSnapshotMeta = () => ({ label: snapshot.label, capturedAt: snapshot.capturedAt, unitCodes: snapshot.unitCodes });
