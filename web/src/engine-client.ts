import workerSource from "./encoder-worker.js?raw";
import { createEngineSession } from "./engine-session";

export function createBrowserEngineSession() {
  return createEngineSession({
    async loadManifest(signal) {
      const url = new URL(import.meta.env.BASE_URL + "core-manifest.json", location.origin);
      const response = await fetch(url, {
        cache:"no-store", credentials:"same-origin", redirect:"error", referrerPolicy:"no-referrer", signal,
      });
      if (!response.ok) throw new Error("処理エンジンの検証情報がありません。web:prepareを実行してください。");
      return response.json();
    },
    createWorker() {
      const url = URL.createObjectURL(new Blob([workerSource], {type:"text/javascript"}));
      try { return new Worker(url); } finally { URL.revokeObjectURL(url); }
    },
  });
}
