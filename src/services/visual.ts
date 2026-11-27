import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface VisualSource {
  path: string;
  name: string;
  format: "PNG" | "JPEG" | "GIF";
  width: number;
  height: number;
  sizeBytes: number;
}

interface VisualResponse extends Omit<VisualSource, "path"> {
  mimeType: string;
  previewBase64: string;
}

export interface VisualSelection {
  source: VisualSource;
  previewUrl: string;
}

export async function selectVisual(): Promise<VisualSelection | null> {
  if (!isTauri()) return null;
  const path = await open({
    title: "画像ファイルを選択",
    multiple: false,
    directory: false,
    filters: [{ name: "画像", extensions: ["png", "jpg", "jpeg", "gif"] }],
  });
  if (path === null) return null;
  if (typeof path !== "string") throw new Error("画像を1ファイル選択してください。");

  return loadVisual(path);
}

export async function loadVisual(path: string): Promise<VisualSelection> {
  const { mimeType, previewBase64, ...info } =
    await invoke<VisualResponse>("load_visual", { path });
  return {
    source: { ...info, path },
    previewUrl: `data:${mimeType};base64,${previewBase64}`,
  };
}
