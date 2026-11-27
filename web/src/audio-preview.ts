import { createBrowserEngineSession } from "./engine-client";
import { errorMessage, type EngineSession } from "./engine-session";
import { LIMITS } from "./encode-plan";
import type { FilterSettings } from "../../src/services/preset-schema";

type Mode = "original" | "processed";
interface Dependencies {
  file: () => File | undefined;
  values: () => FilterSettings;
  metadataDuration: (file: File) => Promise<number>;
}
function get<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error("Missing audio preview control: "+id);
  return el as T;
}
function clock(seconds: number): string {
  const total=Math.floor(seconds);
  return Math.floor(total/60)+":"+String(total%60).padStart(2,"0");
}
export function initializeAudioPreview(deps: Dependencies) {
  const player=get<HTMLAudioElement>("audio-preview");
  const start=get<HTMLInputElement>("preview-start");
  const range=get<HTMLOutputElement>("preview-range");
  const original=get<HTMLButtonElement>("preview-original");
  const processed=get<HTMLButtonElement>("preview-processed");
  const cancel=get<HTMLButtonElement>("preview-cancel");
  const status=get<HTMLElement>("audio-preview-status");
  const cache=new Map<Mode,string>();
  let generation=0, sourceRevision=0, duration=0, busy=false, exportBusy=false;
  let engine:EngineSession|null=null, mode:Mode|null=null;
  function setStatus(message:string,state="idle") {
    status.textContent=message;
    status.dataset.state=state;
  }
  function refresh() {
    const ready=duration>0&&!exportBusy;
    start.disabled=!ready;
    original.disabled=processed.disabled=!ready||busy;
    cancel.disabled=!busy||exportBusy;
    const offset=start.valueAsNumber;
    range.value=duration>0?clock(offset)+" ～ "+clock(Math.min(offset+30,duration)):"未選択";
    original.setAttribute("aria-pressed",String(mode==="original"));
    processed.setAttribute("aria-pressed",String(mode==="processed"));
  }
  function stopJob() {
    generation++;
    engine?.dispose(); engine=null;
    busy=false;
  }
  function invalidate(message:string) {
    stopJob();
    player.pause(); player.onloadedmetadata=null;
    player.removeAttribute("src"); player.load();
    for(const url of cache.values())URL.revokeObjectURL(url);
    cache.clear(); mode=null;
    setStatus(message);
    refresh();
  }
  async function refreshSource() {
    const current=++sourceRevision;
    duration=0; start.value="0"; start.max="0";
    const file=deps.file();
    invalidate(file?"音声情報を読み込み中…":"MP3を選択してください。");
    if(!file)return;
    try {
      if(!/\.mp3$/i.test(file.name)||file.size<=0||file.size>LIMITS.audioBytes)
        throw new Error("MP3は50 MiB以下にしてください。");
      const seconds=await deps.metadataDuration(file);
      if(current!==sourceRevision)return;
      if(!Number.isFinite(seconds)||seconds<=0||seconds>LIMITS.seconds)
        throw new Error("音声の長さは5分以下にしてください。");
      duration=seconds;
      start.max=String(Math.max(0,Math.ceil(duration)-1));
      setStatus("試聴する音声を選択してください。");
    } catch(error) {
      if(current!==sourceRevision)return;
      setStatus(error instanceof Error?error.message:String(error),"error");
    } finally { if(current===sourceRevision)refresh(); }
  }
  function show(next:Mode,url:string,position:number,current:number) {
    mode=next;
    player.onloadedmetadata=()=>{
      if(current!==generation)return;
      player.currentTime=Math.min(position,Math.max(0,player.duration-0.05));
      setStatus((next==="original"?"原音":"加工音")+" · 同じ区間で比較できます。","ready");
      busy=false; refresh();
      void player.play().catch(()=>{
        if(current===generation)setStatus("再生ボタンから試聴してください。","ready");
      });
    };
    player.src=url;
    player.load();
    refresh();
  }
  function fail(current:number,message:string) {
    if(current!==generation)return;
    invalidate(message);
    setStatus(message,"error");
  }
  async function play(next:Mode) {
    const file=deps.file();
    if(!file||!duration||busy||exportBusy)return;
    if(mode===next&&player.hasAttribute("src")){
      if(player.paused)void player.play().catch(()=>setStatus("再生ボタンから試聴してください。","ready"));
      return;
    }
    const position=mode&&!player.ended?player.currentTime:0;
    player.pause();
    const current=++generation;
    busy=true; refresh(); setStatus("試聴データを準備しています…","busy");
    try {
      const cached=cache.get(next);
      if(cached){show(next,cached,position,current);return;}
      const settings=next==="processed"?deps.values():null;
      const offset=start.valueAsNumber;
      const audio=await file.arrayBuffer();
      if(current!==generation)return;
      const session=createBrowserEngineSession();
      engine=session;
      await session.run({type:"preview",audio,duration,settings,previewStart:offset},{
        status: message=>{if(current===generation)setStatus(message,"busy");},
        error: message=>fail(current,message),
        done: result=>{
          if(current!==generation||result.type!=="previewDone")return;
          engine=null;
          const wav=URL.createObjectURL(new Blob([result.bytes],{type:"audio/wav"}));
          cache.set(next,wav);
          show(next,wav,position,current);
        },
      });
    }catch(error){fail(current,errorMessage(error));}
  }
  start.addEventListener("input",()=>invalidate("試聴区間を変更しました。"));
  original.addEventListener("click",()=>{void play("original");});
  processed.addEventListener("click",()=>{void play("processed");});
  cancel.addEventListener("click",()=>invalidate("試聴を中断しました。再試聴できます。"));
  player.addEventListener("error",()=>{
    if(player.hasAttribute("src"))fail(generation,"試聴データの再生に失敗しました。");
  });
  refresh();
  return {invalidate,refreshSource,setExportBusy(value:boolean){exportBusy=value;refresh();}};
}
