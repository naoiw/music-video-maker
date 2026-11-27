import { addPreset, removePreset, MAX_PRESETS, MAX_NAME_LENGTH, type FilterPreset, type FilterSettings } from "../../src/services/preset-schema";
import type { WebStore } from "./settings-storage";
function get<T extends HTMLElement>(id: string): T {
  const el=document.getElementById(id);
  if(!el)throw new Error("Missing preset control: "+id);
  return el as T;
}
export function initializeWebPresets(store:WebStore, snapshot:()=>FilterSettings, apply:(values:FilterSettings)=>void) {
  const root=get<HTMLFieldSetElement>("preset-controls");
  const name=get<HTMLInputElement>("preset-name");
  const select=get<HTMLSelectElement>("preset-select");
  const save=get<HTMLButtonElement>("preset-save");
  const load=get<HTMLButtonElement>("preset-load");
  const remove=get<HTMLButtonElement>("preset-delete");
  const clear=get<HTMLButtonElement>("preset-clear");
  const status=get<HTMLElement>("preset-status");
  let presets:FilterPreset[]=[];
  let readable=false, confirmClear=false, busy=false;
  name.maxLength=MAX_NAME_LENGTH;
  function refresh(){
    root.disabled=busy;
    name.disabled=!readable;
    select.disabled=!readable||presets.length===0;
    save.disabled=!readable||!name.value.trim()||presets.length>=MAX_PRESETS;
    load.disabled=remove.disabled=!readable||!select.value;
    clear.disabled=readable&&presets.length===0;
    clear.textContent=confirmClear?"全削除を確定":"全削除";
  }
  function render(selected=""){
    select.replaceChildren(new Option("プリセットを選択",""));
    for(const preset of presets)select.add(new Option(preset.name,preset.name));
    select.value=presets.some(p=>p.name===selected)?selected:"";
    refresh();
  }
  function cancelClear(){confirmClear=false;refresh();}
  function report(error:unknown){status.textContent=error instanceof Error?error.message:String(error);}
  function commit(next:FilterPreset[],selected:string,message:string){
    try{
      // Update the in-memory list only after successful persistent storage.
      store.writePresets(next);
      presets=next;readable=true;
      status.textContent=message;
      render(selected);
    }catch(error){report(error);}
    finally{cancelClear();}
  }
  root.addEventListener("input",cancelClear);
  root.addEventListener("change",cancelClear);
  save.addEventListener("click",()=>{
    if(busy||save.disabled)return;
    try{
      const next=addPreset(presets,name.value,snapshot());
      const selected=next[next.length-1].name;
      commit(next,selected,"「"+selected+"」を保存しました。");
    }catch(error){report(error);}
  });
  load.addEventListener("click",()=>{
    if(busy||load.disabled)return;
    const selected=presets.find(p=>p.name===select.value);
    if(!selected)return;
    cancelClear();
    try{apply(selected.filters);status.textContent="「"+selected.name+"」を適用しました。";}
    catch(error){report(error);}
  });
  remove.addEventListener("click",()=>{
    if(busy||remove.disabled)return;
    const selected=select.value;
    commit(removePreset(presets,selected),"","「"+selected+"」を削除しました。");
  });
  clear.addEventListener("click",()=>{
    if(busy||clear.disabled)return;
    if(!confirmClear){
      confirmClear=true;refresh();
      status.textContent="保存済みプリセットをすべて削除します。もう一度押すと確定します。";
      return;
    }
    commit([],"","プリセット一覧を初期化しました。");
  });
  try{
    presets=store.readPresets();readable=true;
    status.textContent=presets.length?presets.length+" 件のプリセットを読み込みました。":"プリセットは未登録です。";
  }catch(error){report(error);status.textContent+=" 全削除で初期化できます。";}
  render();
  return {setBusy(value:boolean){busy=value;cancelClear();}};
}
