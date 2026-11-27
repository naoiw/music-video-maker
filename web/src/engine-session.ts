import { activeFilterNames, compileWebAudioFilters } from "./audio-filter-plan.ts";
import type { FilterSettings } from "../../src/services/preset-schema.ts";
import type { ImageKind } from "./encode-plan.ts";

type CommonRequest = { audio: ArrayBuffer; duration: number; settings: FilterSettings | null };
export type EngineRequest = CommonRequest & (
  { type: "preview"; previewStart: number } |
  { type: "encode"; visual: ArrayBuffer; kind: ImageKind; args: string[] }
);
export type EngineResult =
  { type: "previewDone"; bytes: ArrayBuffer } |
  { type: "done"; bytes: ArrayBuffer; encodeSeconds: number };
export interface EngineHandlers {
  status: (message: string) => void;
  progress?: (value: number) => void;
  log?: (message: string) => void;
  error: (message: string) => void;
  done: (result: EngineResult) => void;
}
interface Dependencies {
  loadManifest: (signal: AbortSignal) => Promise<unknown>;
  createWorker: () => Worker;
}
export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Owns exactly one engine job. Cancellation aborts the manifest request and
 * terminates the Worker. Late callbacks cannot complete a disposed session. */
export function createEngineSession(deps: Dependencies) {
  const controller = new AbortController();
  let worker: Worker | null = null;
  let started = false;
  let disposed = false;
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    controller.abort();
    const current = worker;
    worker = null;
    if (current) {
      current.onmessage = null;
      current.onerror = null;
      current.onmessageerror = null;
      current.terminate();
    }
  }
  async function run(request: EngineRequest, handlers: EngineHandlers): Promise<void> {
    if (disposed) return;
    if (started) throw new Error("Engine session already started");
    started = true;
    const { settings, ...payload } = request;
    const useFilters = settings !== null && activeFilterNames(settings).length > 0;
    let graphSent = false;
    function fail(error: unknown): void {
      if (disposed) return;
      dispose();
      handlers.error(errorMessage(error));
    }
    try {
      const manifest = await deps.loadManifest(controller.signal);
      if (disposed) return;
      const current = deps.createWorker();
      worker = current;
      current.onerror = event => fail(event.message || "Workerの実行に失敗しました。");
      current.onmessageerror = () => fail("Workerの応答を読み込めません。");
      current.onmessage = ({data}: MessageEvent<unknown>) => {
        if (disposed) return;
        try {
          if (!record(data)) throw new Error("Workerの応答が無効です。");
          switch (data.type) {
            case "status":
            case "log":
            case "error":
              if (typeof data.message !== "string") throw new Error("Workerのメッセージが無効です。");
              if (data.type === "status") handlers.status(data.message);
              else if (data.type === "log") handlers.log?.(data.message);
              else fail(data.message);
              return;
            case "progress":
              if (typeof data.value !== "number" || !Number.isFinite(data.value) || data.value < 0 || data.value > 100)
                throw new Error("Workerの進捗値が無効です。");
              handlers.progress?.(data.value);
              return;
            case "probe": {
              if (!useFilters || !settings || graphSent || typeof data.sampleRate !== "number")
                throw new Error("音声フィルタの要求が無効です。");
              const graph = compileWebAudioFilters(settings, data.sampleRate);
              if (!graph) throw new Error("音声フィルタの設定を取得できません。");
              graphSent = true;
              current.postMessage({type:"filterGraph", graph});
              return;
            }
            case "done":
            case "previewDone": {
              const expected = request.type === "encode" ? "done" : "previewDone";
              if (data.type !== expected || (useFilters && !graphSent) ||
                  !(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength === 0)
                throw new Error("Workerの出力データが無効です。");
              let result: EngineResult;
              if (data.type === "previewDone") {
                if (data.bytes.byteLength <= 44 || data.bytes.byteLength > 6 * 1024 * 1024)
                  throw new Error("試聴データのサイズが無効です。");
                result = {type:"previewDone", bytes:data.bytes};
              } else {
                if (typeof data.encodeSeconds !== "number" || !Number.isFinite(data.encodeSeconds) || data.encodeSeconds <= 0)
                  throw new Error("Workerの処理時間が無効です。");
                result = {type:"done", bytes:data.bytes, encodeSeconds:data.encodeSeconds};
              }
              dispose();
              try { handlers.done(result); } catch (error) { handlers.error(errorMessage(error)); }
              return;
            }
            default: throw new Error("未対応のWorker応答です。");
          }
        } catch (error) { fail(error); }
      };
      const transfers = request.type === "encode" ? [request.audio, request.visual] : [request.audio];
      current.postMessage({...payload, manifest, useFilters}, transfers);
    } catch (error) { fail(error); }
  }
  return {run, dispose};
}
export type EngineSession = ReturnType<typeof createEngineSession>;
