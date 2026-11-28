export type DropTarget = "audio" | "visual" | "overlay";

export function isDropTarget(value: string | undefined): value is DropTarget {
  return value === "audio" || value === "visual" || value === "overlay";
}

/** The destination, not the extension, determines which stream is requested.
 * Native loaders validate actual file contents.
 */
export function droppedPath(paths: readonly string[]): string {
  if (paths.length !== 1 || !paths[0]) throw new Error("素材を1ファイルずつドロップしてください。");
  return paths[0];
}
