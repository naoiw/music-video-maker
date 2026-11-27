export interface DroppedSources {
  audio?: string;
  visual?: string;
}

/** Classify the entire drop before changing any selected source. */
export function classifyDroppedSources(paths: readonly string[]): DroppedSources {
  if (paths.length === 0) throw new Error("素材ファイルをドロップしてください。");
  const sources: DroppedSources = {};
  for (const path of paths) {
    const filename = path.split(/[\\/]/).pop() ?? "";
    if (/\.mp3$/i.test(filename)) {
      if (sources.audio) throw new Error("MP3は1ファイルずつ指定してください。");
      sources.audio = path;
    } else if (/\.(png|jpe?g|gif)$/i.test(filename)) {
      if (sources.visual) throw new Error("画像は1ファイルずつ指定してください。");
      sources.visual = path;
    } else {
      throw new Error("対応形式はMP3・PNG・JPEG・GIFです。");
    }
  }
  return sources;
}
