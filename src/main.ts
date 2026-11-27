import "./styles.css";
import { getRuntimeInfo } from "./services/runtime";

const status = document.querySelector<HTMLElement>("#status");
if (!status) throw new Error("Missing status element");

async function initialize(element: HTMLElement): Promise<void> {
  try {
    const runtime = await getRuntimeInfo();
    element.textContent = runtime.kind === "desktop"
      ? `Desktop / ${runtime.os} / v${runtime.version}`
      : "Browser preview — デスクトップ処理は利用できません。";
  } catch (error) {
    element.textContent = `実行環境の取得に失敗しました: ${String(error)}`;
  }
}

void initialize(status);
