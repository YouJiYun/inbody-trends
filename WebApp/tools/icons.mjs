import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
function crc32(buffer) {
  let crc=0xffffffff;
  for(const byte of buffer){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function chunk(type,data) {
  const name=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);
  length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));
  return Buffer.concat([length,name,data,crc]);
}
export async function icons(destination) {
  for(const size of [192,512]) {
    const pixels=Buffer.alloc((size*4+1)*size);
    const path=[[.25,.64],[.4,.52],[.54,.6],[.75,.34]];
    for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
      let white=false;
      for(let i=1;i<path.length;i++) {
        const [ax,ay]=path[i-1].map(v=>v*size),[bx,by]=path[i].map(v=>v*size);
        const t=Math.max(0,Math.min(1,((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)));
        if(Math.hypot(x-(ax+t*(bx-ax)),y-(ay+t*(by-ay)))<size*.026)white=true;
      }
      const offset=y*(size*4+1)+1+x*4;
      pixels[offset]=white?255:8;pixels[offset+1]=white?255:127;pixels[offset+2]=white?255:121;pixels[offset+3]=255;
    }
    const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
    await writeFile(join(destination,`icon-${size}.png`),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
      chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));
  }
}
