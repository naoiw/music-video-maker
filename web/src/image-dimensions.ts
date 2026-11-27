// Inspect bounded file data before invoking any browser or WASM image decoder.
export const MAX_IMAGE_PIXELS = 40_000_000;
export type Dimensions = { width: number; height: number };
export function assertImageDimensions(width: number, height: number): Dimensions {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > MAX_IMAGE_PIXELS)
    throw new Error("画像は4000万画素以下にしてください。");
  return {width,height};
}
const invalid = () => new Error("画像ヘッダーが破損しているか未対応です。");
const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
export function inspectImageDimensions(bytes: Uint8Array, kind: "png"|"jpeg"|"gif"): Dimensions {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(kind==="png"){
    if(bytes.length<33 || ![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) ||
       view.getUint32(8)!==13 || view.getUint32(12)!==0x49484452)throw invalid();
    return assertImageDimensions(view.getUint32(16),view.getUint32(20));
  }
  if(kind==="gif"){
    if(bytes.length<13 || !["GIF87a","GIF89a"].includes(String.fromCharCode(...bytes.subarray(0,6))))throw invalid();
    return assertImageDimensions(view.getUint16(6,true),view.getUint16(8,true));
  }
  if(kind!=="jpeg" || bytes.length<4 || bytes[0]!==0xff || bytes[1]!==0xd8)throw invalid();
  // Walk length-delimited marker segments; never search compressed scan data
  // or mistake a thumbnail/EXIF payload for the main frame header.
  let offset=2;
  while(offset<bytes.length){
    if(bytes[offset++]!==0xff)throw invalid();
    while(offset<bytes.length&&bytes[offset]===0xff)offset++;
    if(offset>=bytes.length)throw invalid();
    const marker=bytes[offset++];
    if(marker===0x00||marker===0xd8||marker===0xd9||marker===0xda||
       (marker>=0xd0&&marker<=0xd7))throw invalid();
    if(marker===0x01)continue;
    if(offset+2>bytes.length)throw invalid();
    const length=view.getUint16(offset);
    if(length<2||offset+length>bytes.length)throw invalid();
    if(sof.has(marker)){
      if(length<8||length!==8+3*bytes[offset+7]||bytes[offset+7]===0)throw invalid();
      return assertImageDimensions(view.getUint16(offset+5),view.getUint16(offset+3));
    }
    offset+=length;
  }
  throw invalid();
}
