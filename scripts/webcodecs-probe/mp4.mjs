// Deliberately small ISO BMFF writer for bounded synthetic WebCodecs probes.
// No production demuxing, B frames, edit lists, fragmentation or >4 GiB files.
const ascii = text => Uint8Array.from(text, c=>c.charCodeAt(0));
const zero = n => new Uint8Array(n);
function uint(n, size) {
  if(!Number.isSafeInteger(n)||n<0||n>=2**(8*size))throw Error("MP4 integer out of range");
  const b=new Uint8Array(size);
  for(let i=size-1;i>=0;i--){b[i]=n%256;n=Math.floor(n/256);}
  return b;
}
const u16=n=>uint(n,2), u32=n=>uint(n,4);
function concat(...arrays){
  const length=arrays.reduce((sum,a)=>sum+a.length,0);
  if(length>64*1024*1024)throw Error("Probe exceeds 64 MiB");
  const out=new Uint8Array(length);let offset=0;
  for(const a of arrays){out.set(a,offset);offset+=a.length;}
  return out;
}
const box=(type,...parts)=>{const p=concat(...parts);return concat(u32(p.length+8),ascii(type),p);};
const full=(type,version,flags,...parts)=>box(type,uint(version,1),uint(flags,3),...parts);
const matrix=()=>concat(u32(65536),zero(12),u32(65536),zero(12),u32(1073741824));
function descriptor(tag,...parts){
  const data=concat(...parts),size=[];
  for(let n=data.length;;){size.unshift(n&127);n>>>=7;if(!n)break;}
  return concat(Uint8Array.of(tag),Uint8Array.from(size,(v,i)=>i<size.length-1?v|128:v),data);
}
function sampleEntry(t){
  if(t.kind==="video"){
    return box("avc1",zero(6),u16(1),zero(16),u16(t.width),u16(t.height),
      u32(0x00480000),u32(0x00480000),zero(4),u16(1),zero(32),u16(24),u16(65535),
      box("avcC",t.description));
  }
  const dec=descriptor(4,Uint8Array.of(0x40,0x15),zero(3),u32(192000),u32(192000),descriptor(5,t.description));
  const es=descriptor(3,u16(1),zero(1),dec,descriptor(6,Uint8Array.of(2)));
  return box("mp4a",zero(6),u16(1),zero(8),u16(t.channels),u16(16),zero(4),
    u32(t.sampleRate*65536),full("esds",0,0,es));
}
function normalize(track){
  if(!track||!["video","audio"].includes(track.kind)||!(track.description instanceof Uint8Array)||
     !track.description.length||track.description.length>4096||!Array.isArray(track.samples)||
     !track.samples.length||track.samples.length>10000)throw Error("Invalid probe track");
  if(track.kind==="video"){
    if(track.description[0]!==1||![track.width,track.height].every(n=>Number.isInteger(n)&&n>0&&n<=1920)||
       !track.samples[0].key)throw Error("Invalid AVC configuration or missing key frame");
  }else if(![1,2].includes(track.channels)||![44100,48000].includes(track.sampleRate))
    throw Error("Invalid AAC configuration");
  const first=track.samples[0].timestamp;
  const samples=track.samples.map((s,i)=>{
    if(!Number.isSafeInteger(s.timestamp)||!(s.bytes instanceof Uint8Array)||!s.bytes.length||
       (i>0&&s.timestamp<=track.samples[i-1].timestamp))throw Error("Non-monotonic or invalid encoded sample");
    const duration=i+1<track.samples.length?track.samples[i+1].timestamp-s.timestamp:s.duration;
    if(!Number.isSafeInteger(duration)||duration<=0||duration>1000000)throw Error("Invalid sample duration");
    return {...s,timestamp:s.timestamp-first,duration};
  });
  const duration=samples.reduce((sum,s)=>sum+s.duration,0);
  if(duration>31_000_000)throw Error("Probe duration exceeds limit");
  return {...track,samples,duration};
}
function trak(t,id,offset){
  const video=t.kind==="video";
  const movieDuration=Math.ceil(t.duration/1000);
  const tkhd=full("tkhd",0,7,zero(8),u32(id),zero(4),u32(movieDuration),zero(8),zero(4),
    u16(video?0:256),zero(2),matrix(),u32(video?t.width*65536:0),u32(video?t.height*65536:0));
  const mdhd=full("mdhd",0,0,zero(8),u32(1000000),u32(t.duration),u16(0x55c4),zero(2));
  const hdlr=full("hdlr",0,0,zero(4),ascii(video?"vide":"soun"),zero(12),ascii(video?"Video\0":"Audio\0"));
  const header=video?full("vmhd",0,1,zero(8)):full("smhd",0,0,zero(4));
  const dinf=box("dinf",full("dref",0,0,u32(1),full("url ",0,1)));
  const stsd=full("stsd",0,0,u32(1),sampleEntry(t));
  const runs=[];
  for(const s of t.samples){
    const last=runs.at(-1);
    if(last&&last[1]===s.duration)last[0]++;else runs.push([1,s.duration]);
  }
  const stts=full("stts",0,0,u32(runs.length),...runs.map(([n,d])=>concat(u32(n),u32(d))));
  const stsc=full("stsc",0,0,u32(1),u32(1),u32(t.samples.length),u32(1));
  const stsz=full("stsz",0,0,u32(0),u32(t.samples.length),...t.samples.map(s=>u32(s.bytes.length)));
  const stco=full("stco",0,0,u32(1),u32(offset));
  const keys=t.samples.flatMap((s,i)=>s.key?[i+1]:[]);
  const sync=video?[full("stss",0,0,u32(keys.length),...keys.map(u32))]:[];
  const stbl=box("stbl",stsd,stts,stsc,stsz,stco,...sync);
  return box("trak",tkhd,box("mdia",mdhd,hdlr,box("minf",header,dinf,stbl)));
}
export function muxProbeMp4(rawTracks){
  if(!Array.isArray(rawTracks)||rawTracks.length<1||rawTracks.length>2||
     new Set(rawTracks.map(t=>t.kind)).size!==rawTracks.length)throw Error("Invalid probe tracks");
  const tracks=rawTracks.map(normalize);
  const ftyp=box("ftyp",ascii("isom"),u32(512),ascii("isomiso2avc1mp41"));
  let offset=ftyp.length+8;
  const traks=[];
  for(let i=0;i<tracks.length;i++){
    traks.push(trak(tracks[i],i+1,offset));
    offset+=tracks[i].samples.reduce((sum,s)=>sum+s.bytes.length,0);
    if(offset>64*1024*1024)throw Error("Probe exceeds 64 MiB");
  }
  const mdat=box("mdat",...tracks.flatMap(t=>t.samples.map(s=>s.bytes)));
  const mvhd=full("mvhd",0,0,zero(8),u32(1000),u32(Math.ceil(Math.max(...tracks.map(t=>t.duration))/1000)),
    u32(65536),u16(256),zero(10),matrix(),zero(24),u32(tracks.length+1));
  return concat(ftyp,mdat,box("moov",mvhd,...traks));
}
