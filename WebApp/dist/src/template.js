import { imageCanvas } from './ocr.js';
import { prepareDocument } from './preprocess.js';
import { documentFromBlocks,numberTokens,parseDate,validateMeasurement,definitions,locateAnchors,compact,coreKeys } from './domain.js';

function components(gray,w,h,threshold,region={x:0,y:0,width:w,height:h}) {
  const {x:left,y:top,width:rw,height:rh}=region,mask=new Uint8Array(rw*rh),queue=new Int32Array(rw*rh),result=[];
  for(let y=0;y<rh;y++)for(let x=0;x<rw;x++)mask[y*rw+x]=gray[(y+top)*w+x+left]<threshold?1:0;
  for(let start=0;start<mask.length;start++)if(mask[start]) {
    let read=0,count=1,minX=rw,minY=rh,maxX=0,maxY=0;queue[0]=start;mask[start]=0;
    while(read<count) {
      const index=queue[read++],x=index%rw,y=Math.floor(index/rw);
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const next of [x?index-1:-1,x<rw-1?index+1:-1,y?index-rw:-1,y<rh-1?index+rw:-1])if(next>=0&&mask[next]){mask[next]=0;queue[count++]=next;}
    }
    result.push({x:minX+left,y:minY+top,width:maxX-minX+1,height:maxY-minY+1,fill:count/((maxX-minX+1)*(maxY-minY+1))});
  }
  return result;
}
export function locateTemplatePixels(gray,w,h,corroborated=false) {
  const region={x:Math.floor(w*.08),y:Math.floor(h*.18),width:Math.floor(w*.57),height:Math.floor(h*.52)};
  const boxes=components(gray,w,h,160,region).filter(box=>box.width>w*.02&&box.width<w*.5&&
    box.height>h*.002&&box.height<h*.028&&box.width/box.height>4&&box.fill>.65),rows=[];
  for(const box of boxes.sort((a,b)=>a.y-b.y)) {
    const row=rows.find(row=>Math.abs(row.y-box.y)<h*.008);
    if(row){row.parts.push(box);row.y=Math.min(row.y,box.y);row.height=Math.max(row.height,box.height);}
    else rows.push({y:box.y,height:box.height,parts:[box]});
  }
  const patterns=[];
  for(let i=0;i<=rows.length-5;i++) {
    const group=rows.slice(i,i+5),gap=((group[1].y-group[0].y)+(group[2].y-group[1].y)+(group[4].y-group[3].y))/3;
    if(gap>h*.014&&gap<h*.045&&[1,2,4].every(j=>Math.abs(group[j].y-group[j-1].y-gap)<gap*.25)&&
      group[3].y-group[2].y>gap*2&&group[3].y-group[2].y<gap*5)patterns.push({group,gap});
  }
  if(patterns.length!==1)return null;
  const {group,gap}=patterns[0],origin=Math.min(...group.flatMap(row=>row.parts.map(box=>box.x)));
  const widths=group.flatMap(row=>row.parts.map(box=>box.width)).sort((a,b)=>a-b),cell=widths[Math.floor(widths.length/2)];
  const left=Math.max(0,Math.floor(origin-cell*1.5)),right=Math.min(w,Math.floor(origin+cell*12));
  let grids=0,previous=-100;
  for(let y=Math.ceil(group[4].y+gap*2);y<h;y++) {
    let dark=0;for(let x=left;x<right;x++)if(gray[y*w+x]<190)dark++;
    if(dark>(right-left)*.65&&y-previous>gap*.4){grids++;previous=y;}
  }
  return grids>=2||corroborated?{group,gap,origin,cell,grids}:null;
}
const grayImage=canvas=>{
  const data=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height).data;
  return Uint8Array.from({length:canvas.width*canvas.height},(_,i)=>data[i*4]);
};
export function gridRules(gray,w,h,region,vertical=false,density=.55) {
  const x=Math.max(0,Math.floor(region.x)),y=Math.max(0,Math.floor(region.y));
  const width=Math.min(w-x,Math.floor(region.width)),height=Math.min(h-y,Math.floor(region.height));
  if(width<=0||height<=0)return [];
  const histogram=new Uint32Array(256);
  for(let yy=y;yy<y+height;yy++)for(let xx=x;xx<x+width;xx++)histogram[gray[yy*w+xx]]++;
  let total=0,background=255;
  for(let value=0;value<256;value++){total+=histogram[value];if(total>=width*height*.9){background=value;break;}}
  const threshold=Math.max(100,background-16),bands=[],length=vertical?width:height,span=vertical?height:width;
  for(let index=0;index<length;index++) {
    let dark=0;
    for(let other=0;other<span;other++) {
      let ink=false;
      const radius=vertical?2:Math.max(2,Math.round(h*.002));
      for(let delta=-radius;delta<=radius;delta++) {
        const yy=y+(vertical?other:index+delta),xx=x+(vertical?index+delta:other);
        if(yy>=0&&yy<h&&xx>=0&&xx<w) {
          const before=vertical?gray[yy*w+Math.max(0,xx-2)]:gray[Math.max(0,yy-2)*w+xx];
          const after=vertical?gray[yy*w+Math.min(w-1,xx+2)]:gray[Math.min(h-1,yy+2)*w+xx];
          if(gray[yy*w+xx]<threshold||Math.abs(before-after)>12){ink=true;break;}
        }
      }
      if(ink)dark++;
    }
    if(dark/span>density) {
      const band=bands.at(-1);
      if(band&&index-band.last<=2)band.last=index;else bands.push({first:index,last:index});
    }
  }
  return bands.filter(band=>band.last-band.first<Math.min(width,height)*.1)
    .map(band=>(vertical?x:y)+(band.first+band.last)/2);
}
export function compositionCells(doc,anchors,layout,w,h) {
  if(!anchors.composition)return [];
  const divider=(anchors.score?.x??.7)-.012,bottom=anchors.muscle?.y??(layout.group[0].y-layout.gap*1.2)/h;
  const units=doc.lines.flatMap(line=>line.words).filter(word=>word.confidence>=35&&/^\(?(kg|L)\)?$/i.test(compact(word.text))&&
    word.x>anchors.composition.x+.12&&word.x<divider&&word.y>anchors.composition.y+anchors.composition.height&&word.y<bottom)
    .sort((a,b)=>a.y-b.y),rows=[];
  for(const word of units) {
    const center=word.y+word.height/2,existing=rows.find(row=>Math.abs(row.center-center)<Math.max(row.word.height,word.height)*.7);
    if(!existing)rows.push({word,center});else if(word.confidence>existing.word.confidence){existing.word=word;existing.center=center;}
  }
  const centers=equalGrid(rows.map(row=>row.center*h),5,h*.009,h*.035);
  if(!centers)return [];
  const selected=centers.map(center=>rows.find(row=>Math.abs(row.center*h-center)<1));
  if(!/^[(]?L[)]?$/i.test(compact(selected[0].word.text))||
    selected.slice(1).some(row=>!/^[(]?kg[)]?$/i.test(compact(row.word.text))))return [];
  const gap=(centers[4]-centers[0])/4,cells=[];
  for(const [index,center] of centers.entries()) {
    const left=(selected[index].word.x+selected[index].word.width)*w+w*.004;
    const references=doc.lines.flatMap(line=>line.words).filter(word=>/[~～]/.test(word.text)&&word.x*w>left&&word.x<divider&&
      Math.abs((word.y+word.height/2)*h-center)<gap*.6);
    const right=references.length?Math.min(...references.map(word=>word.x*w))-w*.002:Math.min(divider*w,left+gap*3);
    if(right-left<gap||right-left>gap*4)return [];
    cells.push({x:left,y:center-gap*.45,width:right-left,height:gap*.9});
  }
  return cells;
}
export function equalGrid(rules,count,minGap,maxGap) {
  const groups=[];
  for(let i=0;i<=rules.length-count;i++) {
    const group=rules.slice(i,i+count),gap=(group.at(-1)-group[0])/(count-1);
    if(gap>=minGap&&gap<=maxGap&&group.slice(1).every((value,j)=>Math.abs(value-group[j]-gap)<gap*.25))groups.push(group);
  }
  return groups.length===1?groups[0]:null;
}
export function reconcileMetric(metrics,key,candidate,issues) {
  if(!candidate)return;
  if(metrics[key]&&Math.abs(metrics[key].value-candidate.value)>.051) {
    delete metrics[key];issues.push(`${definitions.find(def=>def.id===key).name}独立位置存在矛盾`);return;
  }
  const name=definitions.find(def=>def.id===key).name;
  const missing=issues.indexOf(`${name}未可靠识别`);
  if(missing>=0)issues.splice(missing,1);
  if(!issues.some(issue=>issue===`${name}独立位置存在矛盾`))
    metrics[key]=candidate;
}
function crop(canvas,box,scale=1) {
  const x=Math.max(0,Math.floor(box.x)),y=Math.max(0,Math.floor(box.y));
  const width=Math.min(canvas.width-x,Math.ceil(box.width)),height=Math.min(canvas.height-y,Math.ceil(box.height));
  if(width<=0||height<=0)throw new Error('模板裁图尺寸无效');
  const output=document.createElement('canvas');output.width=width*scale;output.height=height*scale;
  output.getContext('2d').drawImage(canvas,x,y,width,height,0,0,output.width,output.height);return output;
}
function foregroundBoxes(canvas,gap,header=false,maxHeight=Infinity) {
  const gray=grayImage(canvas),histogram=new Uint32Array(256);
  for(const value of gray)histogram[value]++;
  let background=255,total=0;
  for(let value=0;value<256;value++){total+=histogram[value];if(total>=gray.length*.9){background=value;break;}}
  const all=components(gray,canvas.width,canvas.height,Math.max(100,background-25));
  if(header) {
    const clean=new Uint8Array(gray.length);
    for(const box of all.filter(box=>box.height>6&&box.height<gap*.75&&box.width<gap*3.5))
      for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++)clean[y*canvas.width+x]=1;
    const bands=[];
    for(let y=0;y<canvas.height;y++) {
      let dark=0;for(let x=0;x<canvas.width;x++)dark+=clean[y*canvas.width+x];
      if(dark>6){const band=bands.at(-1);if(band&&y-band.last<=3)band.last=y;else bands.push({first:y,last:y});}
    }
    return bands.filter(band=>band.last-band.first>5).map(band=>({x:0,y:Math.max(0,band.first-5),width:canvas.width,height:band.last-band.first+11}));
  }
  const glyphs=all.filter(box=>box.height>gap*.23&&box.height<maxHeight&&
    box.width>box.height*.07&&box.width<box.height*1.5&&box.fill>.1).sort((a,b)=>a.x-b.x),groups=[];
  for(const glyph of glyphs) {
    const group=groups.find(group=>Math.abs(group[0].y+group[0].height/2-glyph.y-glyph.height/2)<Math.max(group[0].height,glyph.height)*.4&&
      glyph.x-group.at(-1).x-group.at(-1).width<Math.max(group.at(-1).height,glyph.height)*1.1);
    if(group)group.push(glyph);else groups.push([glyph]);
  }
  return groups.filter(group=>group.length>=2).map(group=>{
    const height=Math.max(...group.map(box=>box.height)),x=Math.min(...group.map(box=>box.x))-height*.2,y=Math.min(...group.map(box=>box.y))-height*.2;
    return {x,y,width:Math.max(...group.map(box=>box.x+box.width))-x+height*.2,height:Math.max(...group.map(box=>box.y+box.height))-y+height*.2};
  });
}
function numeratorBoxes(canvas) {
  const gray=grayImage(canvas),histogram=new Uint32Array(256);
  for(const value of gray)histogram[value]++;
  let background=255,total=0;
  for(let value=0;value<256;value++){total+=histogram[value];if(total>=gray.length*.9){background=value;break;}}
  const boxes=components(gray,canvas.width,canvas.height,Math.max(100,background-25))
    .filter(box=>box.height>canvas.height*.15&&box.height<canvas.height*.8&&
      box.width>box.height*.08&&box.width<box.height*1.5&&box.fill>.1);
  const largest=Math.max(0,...boxes.map(box=>box.height)),groups=[];
  for(const box of boxes.filter(box=>box.height>largest*.75).sort((a,b)=>a.x-b.x)) {
    const previous=groups.at(-1)?.at(-1);
    if(previous&&box.x-previous.x-previous.width<largest*.7&&Math.abs(box.y-previous.y)<largest*.3)groups.at(-1).push(box);
    else groups.push([box]);
  }
  return groups.filter(group=>group.length>=2&&group.length<=3).map(group=>{
    const x=Math.min(...group.map(box=>box.x))-largest*.2,y=Math.min(...group.map(box=>box.y))-largest*.2;
    return {x,y,width:Math.max(...group.map(box=>box.x+box.width))-x+largest*.2,
      height:Math.max(...group.map(box=>box.y+box.height))-y+largest*.2};
  });
}
const pixelBox=(token,canvas)=>({x:token.x*canvas.width,y:token.y*canvas.height,width:token.width*canvas.width,height:token.height*canvas.height});
const expand=box=>({x:box.x-box.height*.2,y:box.y-box.height*.2,width:box.width+box.height*.4,height:box.height*1.4});
function dateMatches(doc,canvas) {
  const found=[];
  for(const line of doc.lines) {
    let text='',spans=[];
    for(const word of line.words){const start=text.length;text+=`${word.text} `;spans.push({word,start,end:text.length-1});}
    for(const match of text.matchAll(/\d{4}[./-]\d{2}[./-]\d{2}(?:\s+|[.,，]\s*)\d{2}:\d{2}/g)) {
      const words=spans.filter(span=>span.end>match.index&&span.start<match.index+match[0].length).map(span=>span.word);
      const date=parseDate(match[0]);if(date===null)continue;
      const x=Math.min(...words.map(word=>word.x)),y=Math.min(...words.map(word=>word.y));
      const token={x,y,width:Math.max(...words.map(word=>word.x+word.width))-x,height:Math.max(...words.map(word=>word.y+word.height))-y};
      found.push({date,confidence:Math.min(...words.map(word=>word.confidence)),box:pixelBox(token,canvas)});
    }
  }
  return found;
}
export function verifiedTimestamp(locator,confirmed,verified) {
  const trusted=[locator,...confirmed,...verified].filter(item=>item.confidence>=70);
  const values=[...new Set(trusted.map(item=>item.date))];
  const conflict=values.length>1;
  const date=!conflict&&values.length===1&&confirmed.some(item=>item.confidence>=70&&item.date===values[0])&&
    verified.some(item=>item.confidence>=70&&item.date===values[0])?values[0]:null;
  return {date,conflict};
}
export function independentPartial(current,independent,issues,identityVerified) {
  if(!identityVerified||current.measuredAt===null||issues.some(issue=>issue.includes('独立日期时间存在矛盾')))return null;
  const trustworthy=Object.fromEntries(Object.entries(independent).filter(([key])=>current.metrics[key]&&
    !issues.some(issue=>issue===`${definitions.find(def=>def.id===key).name}独立位置存在矛盾`||
      issue===`${definitions.find(def=>def.id===key).name}局部裁图存在矛盾`)));
  if(Object.keys(trustworthy).length<2)return null;
  const point={...current,kind:'partial',metrics:trustworthy};
  validateMeasurement(point);
  return point;
}
export async function recognizeTemplate(blob,sourceID,legacyDoc,onProgress=()=>{}) {
  const decoded=await imageCanvas(blob),prepared=await prepareDocument(decoded),canvas=prepared.canvas;
  let worker;
  try {
    const anchors=locateAnchors(legacyDoc);
    const corroborated=!!(anchors.score&&anchors.control&&anchors.score.y<anchors.control.y);
    const layout=locateTemplatePixels(grayImage(canvas),canvas.width,canvas.height,corroborated);
    if(!layout)return null;
    if(corroborated&&anchors.control.y*canvas.height>layout.group[0].y+layout.gap)return null;
    worker=await window.Tesseract.createWorker('eng',1,{
      workerPath:new URL('../vendor/worker.min.js',import.meta.url).href,corePath:new URL('../vendor/core/',import.meta.url).href,
      langPath:new URL('../vendor/lang',import.meta.url).href,workerBlobURL:false,cacheMethod:'none',logger:()=>{}
    });
    await worker.setParameters({tessedit_pageseg_mode:window.Tesseract.PSM.SINGLE_LINE,user_defined_dpi:'300',preserve_interword_spaces:'1'});
    async function read(image,box,scale=2,singleWord=false,binarize=false) {
      const part=box?crop(image,box,scale):image;
      try {
        if(binarize) {
          const context=part.getContext('2d',{willReadFrequently:true}),pixels=context.getImageData(0,0,part.width,part.height);
          const histogram=new Uint32Array(256);
          for(let i=0;i<pixels.data.length;i+=4)histogram[pixels.data[i]]++;
          let total=0,background=255;
          for(let value=0;value<256;value++){total+=histogram[value];if(total>=part.width*part.height*.9){background=value;break;}}
          const threshold=Math.max(100,background-45);
          for(let i=0;i<pixels.data.length;i+=4){const value=pixels.data[i]<threshold?0:255;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=value;}
          context.putImageData(pixels,0,0);
        }
        await worker.setParameters({tessedit_pageseg_mode:singleWord?window.Tesseract.PSM.SINGLE_WORD:window.Tesseract.PSM.SINGLE_LINE});
        const png=await new Promise((resolve,reject)=>part.toBlob(blob=>blob?resolve(blob):reject(new Error('模板图片编码失败')),'image/png'));
        const {data}=await worker.recognize(new Uint8Array(await png.arrayBuffer()),{},{text:false,blocks:true});
        const offset=box?{x:Math.max(0,Math.floor(box.x))/image.width,y:Math.max(0,Math.floor(box.y))/image.height}:{x:0,y:0};
        const scaleToImage=box?{x:part.width/scale/image.width,y:part.height/scale/image.height}:{x:1,y:1};
        const doc=documentFromBlocks(data.blocks,part.width,part.height,offset,scaleToImage);
        return doc;
      } finally {if(part!==image){part.width=1;part.height=1;}}
    }
    async function cellNumber(box,key) {
      const image=crop(canvas,box),def=definitions.find(item=>item.id===key),precision=def.decimals;
      const shaped=doc=>numberTokens(doc).filter(token=>!token.reference&&
        new RegExp(precision?`^\\d+\\.\\d{${precision}}$`:'^\\d+$').test(token.text)&&
        token.value>=def.min&&token.value<=def.max&&token.height*image.height>image.height*.15);
      const valid=doc=>shaped(doc).filter(token=>token.confidence>=70);
      try {
        const full=await read(image,{x:0,y:0,width:image.width,height:image.height},3),observations=[];
        for(const token of valid(full)) {
          const confirmed=valid(await read(image,expand(pixelBox(token,image)),4,true));
          if(confirmed.some(other=>other.value===token.value))observations.push(token);
        }
        if(!observations.length) {
          const boxes=foregroundBoxes(image,image.height*.75,false,image.height*.8);
          for(const local of boxes) {
            const candidates=valid(await read(image,local,3,true,true));
            if(!candidates.length)continue;
            const confirmed=valid(await read(image,local,4,true,true));
            for(const token of candidates)if(confirmed.some(other=>other.value===token.value))observations.push(token);
          }
          if(observations.length&&shaped(full).some(token=>observations.some(other=>other.value!==token.value)))return null;
        }
        const values=[...new Set(observations.map(token=>token.value))];
        return values.length===1?{value:values[0],confidence:Math.min(...observations.map(token=>token.confidence))}:null;
      } finally {image.width=1;image.height=1;}
    }
    const metrics={},independent={},issues=[],notices=[],{group,gap,origin,cell}=layout;
    for(const [index,key] of ['weight','muscle','fat','bmi','pbf'].entries()) {
      onProgress({status:`本机模板字段复核 ${index+1}/6`,progress:.1+index*.12});
      const row=group[index],image=crop(canvas,{x:origin-cell*1.5,y:row.y-gap*.8,
        width:Math.min(canvas.width*.67,origin+cell*12)-origin+cell*1.5,height:row.height+gap*1.2});
      try {
        const glyphBoxes=foregroundBoxes(image,gap),largest=Math.max(0,...glyphBoxes.map(box=>box.height/1.4));
        const def=definitions.find(def=>def.id===key),valid=doc=>numberTokens(doc).filter(token=>
          token.confidence>=70&&/^[+-]?\d+\.\d$/.test(token.text)&&token.value>=def.min&&token.value<=def.max&&
          token.height*image.height>Math.max(gap*.25,largest*.75));
        const selectedBoxes=glyphBoxes.filter(box=>box.height/1.4>=largest*.75);
        const whole=await read(image),primary=valid(whole).filter(token=>selectedBoxes.some(box=>{
          const x=(token.x+token.width/2)*image.width,y=(token.y+token.height/2)*image.height;
          return x>=box.x&&x<=box.x+box.width&&y>=box.y&&y<=box.y+box.height;
        })),observations=[];
        for(const token of primary) {
          const confirmation=valid(await read(image,expand(pixelBox(token,image)),2,true));
          if(confirmation.some(item=>item.value===token.value))observations.push(token);
          else issues.push(`${def.name}整行与字段裁图未一致`);
        }
        for(const box of selectedBoxes) {
          const doc=await read(image,box,2,true);
          const candidates=valid(doc);
          if(!candidates.length)continue;
          const verified=valid(await read(image,box,3,true));
          for(const token of candidates) {
            if(verified.some(item=>item.value===token.value))observations.push(token);
            else issues.push(`${def.name}局部裁图重复复核未一致`);
          }
        }
        const values=[...new Set(observations.map(token=>token.value))];
        if(values.length===1)metrics[key]={value:values[0],confidence:Math.min(...observations.map(token=>token.confidence))};
        else issues.push(`${def.name}${values.length?'局部裁图存在矛盾':'未可靠识别'}`);
      } finally {image.width=1;image.height=1;}
    }
    onProgress({status:'独立人体成分结果列逐格复核',progress:.7});
    const bodyCells=compositionCells(legacyDoc,anchors,layout,canvas.width,canvas.height);
    let compositionCount=0;
    for(const [index,key] of ['water','protein','minerals','fat','weight'].entries())if(bodyCells[index]) {
      const candidate=await cellNumber(bodyCells[index],key);
      if(candidate){
        compositionCount++;candidate.evidence='composition-cell';
        reconcileMetric(metrics,key,candidate,issues);
        if(metrics[key]===candidate)independent[key]=candidate;
      }
    }
    notices.push(`人体成分结果列定位 ${bodyCells.length}/5 格，可信 ${compositionCount}/5 格`);
    if(anchors.score&&anchors.control) {
      const box={x:anchors.score.x*canvas.width,y:(anchors.score.y+anchors.score.height)*canvas.height,
        width:canvas.width*.98-anchors.score.x*canvas.width,height:(anchors.control.y-anchors.score.y-anchors.score.height)*canvas.height};
      if(box.height>gap*.5) {
        const image=crop(canvas,box);
        try {
          const tall=numeratorBoxes(image);
          if(tall.length===1) {
            const local=tall[0],candidate=await cellNumber({x:box.x+local.x,y:box.y+local.y,width:local.width,height:local.height},'score');
            if(candidate){candidate.evidence='score-numerator';reconcileMetric(metrics,'score',candidate,issues);independent.score=candidate;}
          }
        }finally {image.width=1;image.height=1;}
      }
    }
    notices.push(metrics.score?'评分独立分子框已复核':'评分独立分子框未可靠识别');
    onProgress({status:'本机测量时间小块复核',progress:.8});
    const header=crop(canvas,{x:Math.max(0,origin-cell*2),y:0,width:canvas.width*.98-Math.max(0,origin-cell*2),height:group[0].y-gap*4});
    const dates=[],weakDates=[];
    try {
      for(const box of foregroundBoxes(header,gap,true).slice(0,24)) {
        const line=crop(header,box),doc=await read(line);
        try {
          for(const match of dateMatches(doc,line)) {
            weakDates.push(match.date);
            const confirmed=dateMatches(await read(line,expand(match.box)),line);
            const verified=dateMatches(await read(line,expand(match.box),3),line);
            const result=verifiedTimestamp(match,confirmed,verified);
            if(result.conflict)issues.push('独立日期时间存在矛盾');
            if(result.date!==null)dates.push(result.date);
          }
        } finally {line.width=1;line.height=1;}
      }
    } finally {header.width=1;header.height=1;}
    const distinct=[...new Set(dates)];
    let measuredAt=distinct.length===1?distinct[0]:null;
    if(distinct.length>1)issues.push('独立日期时间存在矛盾');
    const history=[];
    if(anchors.history) {
      onProgress({status:'底部最右历史列逐格复核',progress:.9});
      const gray=grayImage(canvas),w=canvas.width,h=canvas.height;
      const region={x:Math.max(0,origin-cell),y:(anchors.history.y+anchors.history.height)*h,
        width:Math.min(w*.75,(anchors.score?.x??.65)*w+cell*2)-Math.max(0,origin-cell),
        height:h-(anchors.history.y+anchors.history.height)*h};
      const rowRules=equalGrid(gridRules(gray,w,h,region),3,h*.02,h*.06);
      const columns=gridRules(gray,w,h,region,true,.18);
      let columnRules=null;
      for(let count=Math.min(10,columns.length);count>=3&&!columnRules;count--)
        columnRules=equalGrid(columns,count,w*.025,w*.12);
      if(rowRules&&columnRules) {
        const rowGap=(rowRules[2]-rowRules[0])/2,columnGap=(columnRules.at(-1)-columnRules[0])/(columnRules.length-1);
        const located=numberTokens(legacyDoc).filter(token=>token.text.includes('.')&&token.x>=region.x/w&&
          token.x< (region.x+region.width)/w&&token.y*h>rowRules[0]-rowGap&&token.y*h<rowRules[2]);
        const center=Math.max(-1,...located.map(token=>(token.x+token.width/2)*w));
        const boundaries=[...columnRules,columnRules.at(-1)+columnGap];
        const column=boundaries.findIndex((value,index)=>index<boundaries.length-1&&center>=value&&center<boundaries[index+1]);
        const left=column>=0?boundaries[column]:columnRules.at(-1),right=Math.min(left+columnGap,region.x+region.width);
        const values={};
        for(const [index,key] of ['weight','muscle','pbf'].entries()) {
          const candidate=await cellNumber({x:left+columnGap*.04,y:rowRules[index]-rowGap,
            width:right-left-columnGap*.08,height:rowGap},key);
          if(candidate)values[key]=candidate;
        }
        const dateBox={x:left,y:rowRules[2]+2,width:right-left,height:Math.min(rowGap*2,h-rowRules[2]-2)};
        const dateImage=crop(canvas,dateBox),dateParts=[],timeParts=[];
        try {
          for(const band of foregroundBoxes(dateImage,rowGap,true)) {
            const doc=await read(dateImage,band,4);
            for(const word of doc.lines.flatMap(line=>line.words).filter(word=>word.confidence>=70)) {
              if(/^(?:\d{2}|\d{4})[./-]\d{2}[./-]\d{2}$/.test(compact(word.text)))dateParts.push(compact(word.text));
              if(/^\d{2}:\d{2}$/.test(compact(word.text)))timeParts.push(compact(word.text));
            }
          }
        }finally {dateImage.width=1;dateImage.height=1;}
        const dateStrings=[...new Set(dateParts)],timeStrings=[...new Set(timeParts)];
        const timestamp=dateStrings.length===1&&timeStrings.length===1?parseDate(`${dateStrings[0]} ${timeStrings[0]}`,true):null;
        const sameHeader=timestamp!==null&&[...new Set(weakDates)].length===1&&weakDates[0]===timestamp;
        if(timestamp!==null&&Object.keys(values).length===3) {
          if(timestamp===measuredAt||measuredAt===null&&sameHeader) {
            if(measuredAt===null)measuredAt=timestamp;
            for(const key of ['weight','muscle','pbf'])reconcileMetric(metrics,key,values[key],issues);
            notices.push('最右历史列日期及三项已与同次报告独立核对');
          }else if(measuredAt!==null&&timestamp<measuredAt) {
            const point={id:crypto.randomUUID(),measuredAt:timestamp,kind:'history',metrics:values,sourceIDs:[sourceID]};
            try {validateMeasurement(point);history.push(point);}catch(error){notices.push(`历史摘要校验失败：${error.message}`);}
          }else notices.push('历史日期无法绑定本次报告，未用于补值');
        }else notices.push(`历史网格已定位，可信数字 ${Object.keys(values).length}/3，时间未完整复核`);
      }else notices.push('历史行列网格未唯一定位，未用于补值');
    }else notices.push('历史栏头未可靠定位，未用于补值');
    if(measuredAt===null)issues.push('日期时间未被字段小块可靠复核');
    const current={id:crypto.randomUUID(),measuredAt,kind:'complete',metrics,sourceIDs:[sourceID]};
    let accepted=false;
    if(measuredAt!==null&&coreKeys.every(key=>metrics[key])&&!issues.length) {
      try {validateMeasurement(current);accepted=true;}catch(error){issues.push(`模板核心校验失败：${error.message}`);}
    }
    const missing=definitions.filter(def=>!metrics[def.id]).map(def=>def.name);
    let partial=null;
    if(!accepted) {
      try {partial=independentPartial(current,independent,issues,!!(anchors.composition&&corroborated));}
      catch(error){notices.push(`部分记录未保存：${error.message}`);}
    }
    return {accepted:accepted||!!partial,partial:!!partial,measuredAt,metrics:partial?partial.metrics:metrics,
      history:accepted?history:[],current:accepted?current:partial,
      issues:[...issues,...notices,'采用模板独立位置复核；仅在两张开发样例上验证，其他版式可能不支持',
        '仅保存通过复核的字段；分段、阻抗及其他历史列未导入',`未可靠识别：${missing.join('、')}`]};
  } finally {if(worker)await worker.terminate();canvas.width=1;canvas.height=1;if(decoded!==canvas){decoded.width=1;decoded.height=1;}}
}
