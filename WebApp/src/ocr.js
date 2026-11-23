import { documentFromTSV, documentFromBlocks, locateLayout, locateAnchors, headerRegions } from './domain.js';
import { prepareDocument } from './preprocess.js';

let workerPromise;
let progressSink=()=>{};
export async function imageCanvas(blob) {
  if(blob.size>25*1024*1024)throw new Error('图片超过 25 MB，请使用普通分辨率的清晰照片');
  const image=new Image(),url=URL.createObjectURL(blob);
  try {
    image.src=url;await image.decode();
    if(!image.naturalWidth||!image.naturalHeight)throw new Error('图片尺寸无效');
    const scale=Math.min(3,2600/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
    const context=canvas.getContext('2d',{willReadFrequently:true});
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    return canvas;
  } finally {URL.revokeObjectURL(url);}
}
function options() {
  return {workerPath:new URL('../vendor/worker.min.js',import.meta.url).href,
    corePath:new URL('../vendor/core/',import.meta.url).href,
    langPath:new URL('../vendor/lang',import.meta.url).href,workerBlobURL:false,cacheMethod:'none',
    logger:({status,progress})=>progressSink({status,progress:Number.isFinite(progress)?progress:0}),
    errorHandler:()=>progressSink({status:'本地识别发生错误',progress:0})};
}
async function getWorker(onProgress) {
  progressSink=onProgress;
  if(!workerPromise) {
    workerPromise=window.Tesseract.createWorker(['chi_sim','eng'],1,options())
      .catch(error=>{workerPromise=null;throw error;});
  }
  return workerPromise;
}
async function bytes(canvas) {
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('本地图片编码失败')),'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
function crop(canvas,left,top,right,bottom) {
  const result=document.createElement('canvas');
  const x=Math.max(0,Math.floor(left*canvas.width)),y=Math.max(0,Math.floor(top*canvas.height));
  const width=Math.min(canvas.width-x,Math.ceil((right-left)*canvas.width));
  const height=Math.min(canvas.height-y,Math.ceil((bottom-top)*canvas.height));
  if(width<=0||height<=0)throw new Error('报告区域无效，请重新拍摄完整报告');
  result.width=width;result.height=height;
  result.getContext('2d').drawImage(canvas,x,y,width,height,0,0,width,height);
  return {canvas:result,x:x/canvas.width,y:y/canvas.height,w:width/canvas.width,h:height/canvas.height};
}
const readDocument=(data,width,height,offset,scale)=>data.blocks?.length?
  documentFromBlocks(data.blocks,width,height,offset,scale):documentFromTSV(data.tsv,width,height,offset,scale);
export async function recognize(blob,onProgress=()=>{}) {
  onProgress({status:'正在读取本地图片',progress:0});
  const decoded=await imageCanvas(blob);
  onProgress({status:'本地校正纸张与阴影',progress:0.05});
  const prepared=await prepareDocument(decoded),canvas=prepared.canvas,worker=await getWorker(onProgress);
  if(canvas!==decoded){decoded.width=1;decoded.height=1;}
  await worker.reinitialize(['chi_sim','eng'],1);
  await worker.setParameters({tessedit_pageseg_mode:window.Tesseract.PSM.SPARSE_TEXT,user_defined_dpi:'300',preserve_interword_spaces:'1'});
  onProgress({status:'在设备内识别中文分区',progress:0.1});
  const {data}=await worker.recognize(await bytes(canvas),{}, {text:false,tsv:true,blocks:true});
  const doc=readDocument(data,canvas.width,canvas.height);
  doc.preprocessing={corrected:prepared.corrected,width:prepared.width,height:prepared.height,
    sourceWidth:prepared.sourceWidth,sourceHeight:prepared.sourceHeight};
  let layout=locateLayout(doc);
  if(!layout) {
    const anchors=locateAnchors(doc),right=anchors.score??anchors.control;
    if(right) {
      onProgress({status:'本地复核中文左栏',progress:0.2});
      await worker.reinitialize('chi_sim',1);
      const part=crop(canvas,0,0,right.x-.012,.99);
      const {data:local}=await worker.recognize(await bytes(part.canvas),{}, {text:false,tsv:true,blocks:true});
      doc.lines.push(...readDocument(local,part.canvas.width,part.canvas.height,{x:part.x,y:part.y},{x:part.w,y:part.h}).lines);
      part.canvas.width=1;part.canvas.height=1;
      layout=locateLayout(doc);
    }
  }
  const headings=layout?[]:headerRegions(doc);
  if(headings.length) {
    await worker.reinitialize('chi_sim',1);
    await worker.setParameters({tessedit_pageseg_mode:window.Tesseract.PSM.SINGLE_LINE});
    for(const box of headings) {
      const part=crop(canvas,Math.max(0,box.x-.012),Math.max(0,box.y-box.height*.3),
        Math.min(1,box.x+box.width+.012),box.y+box.height*1.3);
      const {data:local}=await worker.recognize(await bytes(part.canvas),{}, {text:false,tsv:true,blocks:true});
      doc.lines.push(...readDocument(local,part.canvas.width,part.canvas.height,{x:part.x,y:part.y},{x:part.w,y:part.h}).lines);
      part.canvas.width=1;part.canvas.height=1;
    }
    layout=locateLayout(doc);
  }
  if(layout) {
    await worker.reinitialize('eng',1);
    await worker.setParameters({tessedit_pageseg_mode:window.Tesseract.PSM.SPARSE_TEXT,user_defined_dpi:'300'});
    const regions=[[layout.composition.x,0,0.98,layout.composition.y],
      [layout.composition.x,layout.composition.y+layout.composition.height,layout.divider,layout.muscle.y],
      [layout.composition.x+0.04,layout.muscle.y+layout.muscle.height,layout.divider,layout.segment.y],
      [layout.divider,layout.score?.y??layout.composition.y,0.99,0.99]];
    for(const [index,region] of regions.entries()) {
      onProgress({status:`本地复核数值区域 ${index+1}/${regions.length}`,progress:0.3+index*0.15});
      const part=crop(canvas,...region);
      await worker.setParameters({tessedit_pageseg_mode:index===1?window.Tesseract.PSM.SINGLE_BLOCK:window.Tesseract.PSM.SPARSE_TEXT});
      const {data:local}=await worker.recognize(await bytes(part.canvas),{}, {text:false,tsv:true,blocks:true});
      for(const word of doc.lines.flatMap(line=>line.words))if(word.x>=region[0]&&word.x+word.width<=region[2]&&word.y>=region[1]&&word.y+word.height<=region[3])word.numberSource=false;
      const read=readDocument(local,part.canvas.width,part.canvas.height,{x:part.x,y:part.y},{x:part.w,y:part.h});
      for(const word of read.lines.flatMap(line=>line.words))word.numberSource=true;
      doc.lines.push(...read.lines);
      part.canvas.width=1;part.canvas.height=1;
    }
    await worker.setParameters({tessedit_pageseg_mode:window.Tesseract.PSM.SINGLE_LINE});
    const words=doc.lines.flatMap(line=>line.words).filter(word=>word.numberSource===true&&/\d/.test(word.text));
    const boxes=[];
    for(const [top,bottom] of [[layout.muscle.y+layout.muscle.height,layout.obesity.y],
      [layout.obesity.y+layout.obesity.height,layout.segment.y],[layout.score?.y??0,layout.control?.y??0]]) {
      const score=top===layout.score?.y;
      const candidates=words.filter(word=>word.y>top&&word.y+word.height<bottom&&
        (score?word.x>layout.divider:word.x>layout.composition.x+.06&&word.x+word.width<layout.divider));
      const heights=candidates.map(word=>word.height).sort((a,b)=>a-b),median=heights[Math.floor(heights.length/2)]??0;
      for(const word of candidates.filter(word=>word.height>median*1.6)) {
        if(!boxes.some(box=>Math.abs(box.y-word.y)<word.height*.7&&Math.abs(box.x-word.x)<.04))boxes.push(word);
      }
    }
    for(const box of boxes.slice(0,12)) {
      const part=crop(canvas,Math.max(0,box.x-.012),Math.max(0,box.y-box.height*.25),
        Math.min(1,box.x+box.width+.015),box.y+box.height*1.25);
      const {data:local}=await worker.recognize(await bytes(part.canvas),{}, {text:false,tsv:true,blocks:true});
      const read=readDocument(local,part.canvas.width,part.canvas.height,{x:part.x,y:part.y},{x:part.w,y:part.h});
      for(const word of read.lines.flatMap(line=>line.words))word.numberSource=true;
      doc.lines.push(...read.lines);part.canvas.width=1;part.canvas.height=1;
    }
  }
  canvas.width=1;canvas.height=1;
  onProgress({status:'检查日期、单位和数据一致性',progress:0.98});
  return doc;
}
export async function releaseOCR() {
  if(workerPromise){const worker=await workerPromise;await worker.terminate();workerPromise=null;}
}
