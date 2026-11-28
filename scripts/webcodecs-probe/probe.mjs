import { muxProbeMp4 } from "./mp4.mjs";
const AUDIO={codec:"mp4a.40.2",sampleRate:48000,numberOfChannels:2,bitrate:192000};
const videoConfig=(width,height)=>({codec:"avc1.420028",width,height,framerate:30,bitrate:4000000,
  latencyMode:"realtime",hardwareAcceleration:"no-preference",avc:{format:"avc"}});
async function support(kind,config){
  const Encoder=kind==="video"?globalThis.VideoEncoder:globalThis.AudioEncoder;
  if(!Encoder||typeof Encoder.isConfigSupported!=="function")return {supported:false,reason:"API unavailable"};
  const result=await Encoder.isConfigSupported(config);
  if(typeof result.supported!=="boolean")throw Error("Invalid codec support response");
  return {supported:result.supported,reason:result.supported?"supported":"configuration unsupported"};
}
function copyDescription(value){
  return value?new Uint8Array(value instanceof ArrayBuffer?value.slice(0):new Uint8Array(value.buffer,value.byteOffset,value.byteLength).slice()):null;
}
function capture(state,chunk,metadata){
  const bytes=new Uint8Array(chunk.byteLength);chunk.copyTo(bytes);
  state.total+=bytes.length;
  if(state.total>32*1024*1024){state.error=Error("Encoded probe exceeds 32 MiB");return;}
  const desc=copyDescription(metadata?.decoderConfig?.description);
  if(desc){
    if(state.description&&(!state.description.every((v,i)=>v===desc[i])||state.description.length!==desc.length)){
      state.error=Error("Decoder configuration changed");return;
    }
    state.description=desc;
  }
  state.samples.push({timestamp:chunk.timestamp,duration:chunk.duration,bytes,key:chunk.type==="key"});
}
async function videoTrack(width,height,seconds){
  const state={samples:[],description:null,total:0,error:null};
  const encoder=new VideoEncoder({output:(c,m)=>capture(state,c,m),error:e=>{state.error=e;}});
  const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
  const context=canvas.getContext("2d",{alpha:false});
  if(!context)throw Error("No canvas context");
  try{
    encoder.configure(videoConfig(width,height));
    for(let i=0;i<seconds*30;i++){
      context.fillStyle=Math.floor(i/30)%2===0?"#ff0000":"#0000ff";context.fillRect(0,0,width,height);
      const timestamp=Math.round(i*1e6/30);
      const frame=new VideoFrame(canvas,{timestamp,duration:Math.round((i+1)*1e6/30)-timestamp});
      try{encoder.encode(frame,{keyFrame:i%30===0});}finally{frame.close();}
      if((i+1)%30===0){await encoder.flush();if(state.error)throw state.error;}
    }
    await encoder.flush();if(state.error)throw state.error;
    if(state.samples.length!==seconds*30)throw Error("Unexpected video frame count");
    const last=state.samples.at(-1);last.duration??=Math.round(seconds*1e6)-last.timestamp;
    return {kind:"video",width,height,description:state.description,samples:state.samples};
  }finally{if(encoder.state!=="closed")encoder.close();}
}
async function audioTrack(seconds){
  const state={samples:[],description:null,total:0,error:null};
  const encoder=new AudioEncoder({output:(c,m)=>capture(state,c,m),error:e=>{state.error=e;}});
  try{
    encoder.configure(AUDIO);
    const rate=AUDIO.sampleRate,block=1024,count=Math.ceil(seconds*rate/block);
    for(let i=0;i<count;i++){
      const pcm=new Float32Array(block*2);
      for(let j=0;j<block;j++){
        const sample=i*block+j;
        const v=sample<seconds*rate?0.2*Math.sin(2*Math.PI*440*sample/rate):0;
        pcm[j]=pcm[j+block]=v;
      }
      const data=new AudioData({format:"f32-planar",sampleRate:rate,numberOfFrames:block,numberOfChannels:2,
        timestamp:Math.round(i*block*1e6/rate),data:pcm});
      try{encoder.encode(data);}finally{data.close();}
      if((i+1)%32===0){
        // Wait for consumption instead of flushing AAC's internal state mid-track.
        while(encoder.encodeQueueSize>16){if(state.error)throw state.error;await new Promise(r=>setTimeout(r,10));}
      }
    }
    await encoder.flush();if(state.error)throw state.error;
    if(!state.samples.length)throw Error("No encoded audio samples");
    state.samples.at(-1).duration??=Math.round(block*1e6/rate);
    return {kind:"audio",sampleRate:rate,channels:2,description:state.description,samples:state.samples};
  }finally{if(encoder.state!=="closed")encoder.close();}
}
globalThis.runProbe=async(width,height,seconds)=>{
  if(![[1280,720,2],[1920,1080,30]].some(x=>x[0]===width&&x[1]===height&&x[2]===seconds))throw Error("Invalid probe case");
  const video=await support("video",videoConfig(width,height)),audio=await support("audio",AUDIO);
  const tracks=[],timing={};
  if(video.supported){const t=performance.now();tracks.push(await videoTrack(width,height,seconds));timing.videoSeconds=(performance.now()-t)/1000;}
  if(audio.supported){const t=performance.now();tracks.push(await audioTrack(seconds));timing.audioSeconds=(performance.now()-t)/1000;}
  const bytes=tracks.length?muxProbeMp4(tracks):null;
  globalThis.probeBytes=bytes;
  return {width,height,seconds,video,audio,timing,bytes:bytes?.length??0};
};
globalThis.readProbeBytes=(offset,length)=>{
  const bytes=globalThis.probeBytes;
  if(!bytes||offset<0||length<1||length>256*1024||offset+length>bytes.length)throw Error("Invalid read");
  let text="";
  for(let i=offset;i<offset+length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,Math.min(offset+length,i+8192)));
  return btoa(text);
};
