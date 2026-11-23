import { mergeMeasurements, validateMeasurement, definition, parseDate, printDate } from './domain.js';

const DB_NAME=`inbody-local-pwa-v1:${new URL('../',import.meta.url).pathname}`;
let dbPromise;
const storageError=error=>new Error(error?.name==='QuotaExceededError'?'本地存储空间不足，未保存。请先导出备份，再清理不需要的报告。':
  '本地数据库操作失败，原记录未被替换。请导出备份并检查浏览器存储权限。');
export async function openDB() {
  if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{
      for(const name of ['reports','measurements','meta'])request.result.createObjectStore(name,{keyPath:'id'});
    };
    request.onerror=()=>reject(storageError(request.error));
    request.onblocked=()=>reject(new Error('数据库升级被另一窗口阻止，请关闭其他应用窗口后重试'));
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();dbPromise=null;};resolve(db);};
  }).catch(error=>{dbPromise=null;throw error;});
  return dbPromise;
}
export async function snapshot() {
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['reports','measurements','meta'],'readonly');
    const result={reports:[],measurements:[],revision:0};
    for(const name of ['reports','measurements']) {
      const request=tx.objectStore(name).getAll();
      request.onsuccess=()=>{result[name]=request.result;};
    }
    const meta=tx.objectStore('meta').get('revision');
    meta.onsuccess=()=>{result.revision=meta.result?.value??0;};
    tx.oncomplete=()=>{result.measurements.sort((a,b)=>a.measuredAt-b.measuredAt);resolve(result);};
    tx.onabort=()=>reject(storageError(tx.error));tx.onerror=()=>{};
  });
}
async function commit(expected,next) {
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['reports','measurements','meta'],'readwrite');
    let failure;
    const request=tx.objectStore('meta').get('revision');
    request.onsuccess=()=>{
      if((request.result?.value??0)!==expected) {failure=new Error('另一窗口刚更新了数据，请重试；原库未覆盖');tx.abort();return;}
      try {
        for(const name of ['reports','measurements']) {
          const store=tx.objectStore(name);store.clear();
          for(const item of next[name])store.put(item);
        }
        tx.objectStore('meta').put({id:'revision',value:expected+1});
      } catch(error) {failure=storageError(error);tx.abort();}
    };
    tx.oncomplete=()=>resolve();tx.onabort=()=>reject(failure??storageError(tx.error));tx.onerror=()=>{};
  });
}
export async function digest(blob) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function validatePhoto(blob) {
  if(!(blob instanceof Blob)||!blob.size||blob.size>25*1024*1024)throw new Error('照片大小无效或超过 25 MB');
  const head=new Uint8Array(await blob.slice(0,64).arrayBuffer()),ascii=String.fromCharCode(...head);
  const mime=head[0]===255&&head[1]===216?'image/jpeg':
    head.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'?'image/png':
    ascii.startsWith('RIFF')&&ascii.slice(8,12)==='WEBP'?'image/webp':
    ascii.slice(4,8)==='ftyp'&&/avif|avis/.test(ascii.slice(8))?'image/avif':
    ascii.slice(4,8)==='ftyp'&&/heic|heix|hevc|hevx|mif1|msf1/.test(ascii.slice(8))?'image/heif':null;
  if(!mime)throw new Error('照片格式不受支持，请使用 JPEG、PNG、WebP 或浏览器可解码的 HEIF/AVIF');
  const image=new Image(),photo=new Blob([blob],{type:mime}),url=URL.createObjectURL(photo);
  try {
    image.src=url;await image.decode();
    if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>40_000_000)throw new Error('照片尺寸无效或过大');
  } catch {throw new Error('照片不能在此浏览器解码，原库未修改，请转换为 JPEG 后重试');}
  finally {URL.revokeObjectURL(url);}
  return photo;
}
function rebuild(reports) {
  return mergeMeasurements([],reports.flatMap(report=>report.points));
}
const remapPoints=(points,id)=>points.map(point=>({...point,sourceIDs:[id]}));
export async function saveScan(blob,parsed,id,retry=false) {
  const previous=await snapshot(),sha256=await digest(blob);
  const existing=previous.reports.find(report=>report.digest===sha256);
  if(existing?.status==='saved'&&!retry)return {duplicate:true};
  if(!existing&&previous.reports.some(report=>report.id===id))throw new Error('来源标识冲突，原记录未覆盖');
  validateMetrics(parsed.metrics);
  const reportID=existing?.id??id;
  let points=parsed.accepted?remapPoints([...parsed.history,parsed.current],reportID):[];
  for(const point of points)validateMeasurement(point);
  if(existing?.points.length) {
    if(parsed.accepted&&existing.measuredAt!==parsed.measuredAt)throw new Error('重新识别的日期与原记录矛盾，原图和原记录保持不变');
    points=mergeMeasurements(existing.points,points);
  }
  const current=points.find(point=>point.kind!=='history');
  const report={id:reportID,digest:sha256,image:await validatePhoto(blob),importedAt:existing?.importedAt??Date.now(),
    status:current?(current.kind==='partial'?'partial':'saved'):'pending',issues:parsed.issues,
    candidates:current?.metrics??parsed.metrics,measuredAt:current?.measuredAt??parsed.measuredAt,points};
  const reports=[...previous.reports.filter(report=>report.id!==reportID),report];
  await commit(previous.revision,{reports,measurements:rebuild(reports)});
  return {duplicate:false,retried:!!existing,status:report.status};
}
export async function removeReport(id) {
  const previous=await snapshot();
  const reports=previous.reports.filter(report=>report.id!==id);
  await commit(previous.revision,{reports,measurements:rebuild(reports)});
}
export async function eraseAll() {
  const previous=await snapshot();await commit(previous.revision,{reports:[],measurements:[]});
}
function validateMetrics(metrics) {
  if(!metrics||typeof metrics!=='object'||Array.isArray(metrics))throw new Error('备份候选指标无效');
  for(const [key,metric] of Object.entries(metrics)) {
    const def=definition(key);
    if(!def||!metric||!Number.isFinite(metric.value)||metric.value<def.min||metric.value>def.max||
      !Number.isFinite(metric.confidence)||metric.confidence<0||metric.confidence>100)throw new Error('备份指标无效');
  }
}
function blobToBase64(blob) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onerror=()=>reject(new Error('备份照片读取失败'));
    reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(blob);
  });
}
export async function exportBackup() {
  const current=await snapshot(),reports=[];
  for(const report of current.reports)reports.push({...report,image:{base64:await blobToBase64(report.image),mime:report.image.type}});
  const payload={reports,measurements:current.measurements};
  const checksum=await digest(new Blob([JSON.stringify(payload)]));
  const blob=new Blob([JSON.stringify({format:'inbody-local-backup',version:1,checksum,payload})],{type:'application/json'});
  if(blob.size>150*1024*1024)throw new Error('备份超过 150 MB 导出上限，原记录仍保留；请勿清理网站数据');
  return blob;
}
export async function validateBackup(blob) {
  if(blob.size>150*1024*1024)throw new Error('备份超过 150 MB，未修改本地记录');
  let backup;
  try {backup=JSON.parse(await blob.text());}catch {throw new Error('备份不是有效 JSON，原库未修改');}
  if(backup?.format!=='inbody-local-backup'||backup.version!==1||!backup.payload||
    !Array.isArray(backup.payload.reports)||backup.payload.reports.length>500||
    !Array.isArray(backup.payload.measurements)||backup.payload.measurements.length>10000||typeof backup.checksum!=='string')throw new Error('备份版本、数量或结构不受支持');
  if(await digest(new Blob([JSON.stringify(backup.payload)]))!==backup.checksum)throw new Error('备份校验失败，文件可能损坏；原库未修改');
  const ids=new Set(),digests=new Set(),reports=[];
  for(const source of backup.payload.reports) {
    if(!source||typeof source.id!=='string'||!source.id.length||source.id.length>128||ids.has(source.id)||digests.has(source.digest)||!/^[a-f0-9]{64}$/.test(source.digest)||
      !['saved','partial','pending'].includes(source.status)||!Number.isFinite(source.importedAt)||
      !Array.isArray(source.issues)||source.issues.some(issue=>typeof issue!=='string'||issue.length>4096)||
      !source.image||typeof source.image.base64!=='string'||source.image.base64.length>40*1024*1024||
      typeof source.image.mime!=='string'||!Array.isArray(source.points)||source.points.length>10000)throw new Error('备份报告或照片结构无效');
    ids.add(source.id);digests.add(source.digest);validateMetrics(source.candidates);
    if(source.measuredAt!==null&&(!Number.isInteger(source.measuredAt)||parseDate(printDate(source.measuredAt))!==source.measuredAt))throw new Error('备份日期无效');
    let bytes;
    try {bytes=Uint8Array.from(atob(source.image.base64),char=>char.charCodeAt(0));}catch {throw new Error('备份照片编码损坏');}
    const image=await validatePhoto(new Blob([bytes],{type:source.image.mime}));
    if(await digest(image)!==source.digest)throw new Error('备份照片摘要不匹配，原库未修改');
    for(const point of source.points) {
      validateMeasurement(point);
      if(point.sourceIDs.length!==1||point.sourceIDs[0]!==source.id)throw new Error('备份来源贡献关系无效');
    }
    const full=source.points.filter(point=>point.kind!=='history');
    if(source.status!=='pending'?(full.length!==1||full[0].kind!==(source.status==='saved'?'complete':'partial')||
      full[0].measuredAt!==source.measuredAt||!sameMetrics(full[0].metrics,source.candidates)):
      source.points.length!==0)throw new Error('备份保存状态与指标来源不一致');
    if(source.points.some(point=>point.kind==='history'&&point.measuredAt>=source.measuredAt))throw new Error('备份历史时间无效');
    reports.push({id:source.id,digest:source.digest,image,importedAt:source.importedAt,status:source.status,
      issues:source.issues,candidates:source.candidates,measuredAt:source.measuredAt,points:source.points});
  }
  const measurements=backup.payload.measurements;
  const pointIDs=new Set();
  for(const point of measurements) {
    validateMeasurement(point);
    if(pointIDs.has(point.id)||point.sourceIDs.some(id=>!ids.has(id)))throw new Error('备份存在重复记录或缺失来源');
    pointIDs.add(point.id);
  }
  const rebuilt=rebuild(reports);
  if(rebuilt.length!==measurements.length||measurements.some(point=>{
    const expected=rebuilt.find(item=>item.measuredAt===point.measuredAt);
    return !expected||expected.kind!==point.kind||!sameMetrics(expected.metrics,point.metrics)||
      [...expected.sourceIDs].sort().join('\0')!==[...point.sourceIDs].sort().join('\0');
  })||new Set(measurements.map(point=>point.measuredAt)).size!==measurements.length)throw new Error('备份趋势与报告来源不一致，原库未修改');
  return {reports,measurements};
}
function sameMetrics(a,b) {
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(key=>b[key]?.value===a[key].value&&b[key]?.confidence===a[key].confidence);
}
export async function restoreBackup(blob) {
  const incoming=await validateBackup(blob),previous=await snapshot();
  const reports=[...previous.reports];
  for(const source of incoming.reports) {
    const sameID=reports.find(report=>report.id===source.id);
    if(sameID&&sameID.digest!==source.digest)throw new Error('备份来源标识与原记录冲突，原库未修改');
    const same=reports.find(report=>report.digest===source.digest);
    if(same) {
      if(same.status!=='pending'&&source.status!=='pending'&&same.measuredAt!==source.measuredAt)throw new Error('同一照片的日期存在矛盾，原库未修改');
      if(source.status!=='pending') {
        const points=mergeMeasurements(same.points,remapPoints(source.points,same.id));
        const current=points.find(point=>point.kind!=='history');
        reports[reports.indexOf(same)]={...source,id:same.id,importedAt:same.importedAt,points,
          status:current.kind==='complete'?'saved':'partial',candidates:current.metrics};
      }
    } else reports.push(source);
  }
  const measurements=rebuild(reports);
  await commit(previous.revision,{reports,measurements});
  return {reports:reports.length,measurements:measurements.length};
}
