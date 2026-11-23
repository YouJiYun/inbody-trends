import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const url=process.env.PWA_URL??'http://127.0.0.1:8787/';
const browser=await chromium.launch({channel:process.env.PWA_BROWSER??'msedge',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const unexpected=[],errors=[];
context.on('request',request=>{
  if(new URL(request.url()).origin!==new URL(url).origin&&!request.url().startsWith('blob:'))unexpected.push('external');
  if(request.method()!=='GET')unexpected.push('non-GET');
});
const page=await context.newPage();
page.on('pageerror',error=>errors.push(error.message));
page.on('dialog',dialog=>dialog.accept());
await page.addInitScript(()=>document.addEventListener('scan-finished',event=>{window.__syntheticScan=event.detail;}));
const checks=[];
try {
  await page.goto(url);
  await page.waitForSelector('[data-action="demo"]');
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const pixels=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=1800;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    const text=(value,x,y,size=30)=>{
      ctx.fillStyle='#111';ctx.font=`${size}px "Microsoft YaHei",sans-serif`;
      ctx.fillText(value,x*canvas.width,y*canvas.height);
    };
    text('SYNTHETIC DEMO — NOT A PERSONAL REPORT',.07,.05,22);
    text('2032.04.16 08:35',.42,.12,27);
    for(const [label,y] of [['人体成分分析',.18],['肌肉脂肪分析',.4],['肥胖分析',.57],['肌肉均衡',.75]])text(label,.07,y,32);
    text('InBody评分',.68,.2);text('体重控制',.68,.32);
    text('79',.73,.265,62);text('/100',.86,.285,22);
    for(const [i,[label,unit,value]] of [['身体总水分','(L)','41.2'],['蛋白质','(kg)','10.8'],['无机盐','(kg)','4.10'],['体脂肪','(kg)','18.7'],['体重','(kg)','74.8']].entries()) {
      const y=.25+i*.03;text(label,.23,y,24);text(unit,.38,y,24);text(value,.44,y,28);text('(10.0~85.0)',.52,y,18);
    }
    for(const [i,value] of ['74.8','29.6','18.7'].entries()) {
      text('100',.3,.46+i*.045,15);text(value,.42,.46+i*.045,38);
    }
    for(const [i,value] of ['24.4','25.0'].entries()) {
      text('18.5',.3,.645+i*.06,15);text(value,.42,.645+i*.06,40);
    }
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const image=Buffer.from(pixels);
  const input={name:'synthetic-report.png',mimeType:'image/png',buffer:image};
  await page.locator('#photo-input').setInputFiles(input);
  await page.waitForFunction(()=>window.__syntheticScan,null,{timeout:180000});
  const recognized=await page.evaluate(async()=>{
    const {snapshot}=await import('./src/storage.js');const state=await snapshot();
    return {accepted:window.__syntheticScan.accepted,reports:state.reports.length,points:state.measurements.length,
      metrics:state.reports[0]?.candidates,issues:state.reports[0]?.issues};
  });
  assert.equal(recognized.accepted,true,JSON.stringify({syntheticIssues:recognized.issues,metrics:recognized.metrics}));
  for(const [key,value] of Object.entries({weight:74.8,muscle:29.6,fat:18.7,bmi:24.4,pbf:25,score:79}))
    assert.ok(Math.abs(recognized.metrics[key]?.value-value)<.051,`Synthetic image ${key}`);
  checks.push('Actual synthetic image → local WASM OCR → parser → IndexedDB');
  const templateCheck=await page.evaluate(async()=>{
    const {recognizeTemplate}=await import('./src/template.js');
    const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=2000;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1440,2000);
    ctx.fillStyle='#111';ctx.font='30px Arial';ctx.fillText('2032.04.16, 08:35',580,360);
    const rows=[700,756,812,1020,1076],values=['74.8','29.6','18.7','24.4','25.0'];
    for(const [index,y] of rows.entries()) {
      for(const x of [400,454,508])ctx.fillRect(x,y,50,12);
      ctx.font='40px Arial';ctx.fillText(values[index],630,y+12);
    }
    ctx.fillRect(240,1600,760,2);ctx.fillRect(240,1700,760,2);
    const image=()=>new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const good=await recognizeTemplate(await image(),'synthetic-template',{lines:[]});
    ctx.font='40px Arial';ctx.fillText('72.8',840,712);
    const conflict=await recognizeTemplate(await image(),'synthetic-conflict',{lines:[]});
    canvas.width=1;canvas.height=1;
    return {good,conflict};
  });
  assert.equal(templateCheck.good.accepted,true,JSON.stringify(templateCheck.good));
  assert.ok(templateCheck.good.current);
  assert.equal(templateCheck.good.measuredAt,Date.UTC(2032,3,16,8,35));
  for(const [key,value] of Object.entries({weight:74.8,muscle:29.6,fat:18.7,bmi:24.4,pbf:25}))
    assert.equal(templateCheck.good.metrics[key]?.value,value,`Synthetic template image ${key}`);
  assert.equal(templateCheck.conflict.accepted,false);
  assert.equal(templateCheck.conflict.current,null);
  assert.equal(templateCheck.conflict.metrics.weight,undefined);
  assert.ok(templateCheck.conflict.issues.some(issue=>issue.includes('体重局部裁图存在矛盾')));
  checks.push('Actual synthetic field-crop OCR separates small chart ticks; contradictory same-size weight is rejected');
  const varied=await page.evaluate(async()=>{
    const {recognizeTemplate}=await import('./src/template.js'),results=[];
    for(const [font,timestamp] of [['Arial','2040.02.29 17:06'],['Georgia','2035.09.08 06:42'],['Times New Roman','2038.12.21 23:17'],['Arial','2040.02.30 17:06']]) {
      const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=2000;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1440,2000);ctx.fillStyle='#111';
      ctx.font=`30px "${font}"`;ctx.fillText(timestamp,580,360);
      for(const [index,y] of [700,756,812,1020,1076].entries()) {
        for(const x of [400,454,508])ctx.fillRect(x,y,50,12);
        ctx.font=`14px "${font}"`;ctx.fillText('40.0',420,y-12);
        ctx.font=`40px "${font}"`;ctx.fillText(['78.4','31.9','15.7','25.3','20.0'][index],630,y+12);
      }
      ctx.fillRect(240,1600,760,2);ctx.fillRect(240,1700,760,2);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      results.push({font,timestamp,parsed:await recognizeTemplate(blob,'synthetic-varied',{lines:[]})});
      canvas.width=1;canvas.height=1;
    }
    return results;
  });
  for(const [index,item] of varied.slice(0,3).entries()) {
    assert.equal(item.parsed.accepted,index<2,JSON.stringify(item));
    const p=item.timestamp.match(/(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})/);
    assert.equal(item.parsed.measuredAt,Date.UTC(+p[1],+p[2]-1,+p[3],+p[4],+p[5]));
    for(const [key,value] of Object.entries({weight:78.4,muscle:31.9,fat:15.7,pbf:20}))
      assert.equal(item.parsed.metrics[key]?.value,value,`${item.font} ${key}`);
    if(index<2)assert.equal(item.parsed.metrics.bmi?.value,25.3);
    else {assert.equal(item.parsed.metrics.bmi,undefined);assert.equal(item.parsed.current,null);}
  }
  assert.equal(varied[3].parsed.accepted,false);
  assert.equal(varied[3].parsed.measuredAt,null);
  checks.push('Actual crop OCR across three fonts and timestamps; incomplete Times New Roman core and invalid date are safely rejected');
  const independent=await page.evaluate(async()=>{
    const {recognizeTemplate}=await import('./src/template.js');
    const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=2000;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1440,2000);ctx.fillStyle='#111';
    ctx.font='30px Arial';ctx.fillText('2032.04.16, 08:35',580,360);
    for(const [index,y] of [700,756,812,1020,1076].entries()) {
      for(const x of [400,454,508])ctx.fillRect(x,y,50,12);
      ctx.font='40px Arial';ctx.fillText(['74.8','29.6','18.7','24.4','25.0'][index],630,y+12);
    }
    ctx.fillRect(240,1600,760,2);ctx.fillRect(240,1700,760,2);
    const word=(text,x,y,width=.07,height=.015)=>({text,x,y,width,height,confidence:95});
    const words=[word('人体成分分析',.1,.17,.12),word('肌肉脂肪分析',.1,.32,.12),
      word('InBody评分',.72,.15,.12),word('体重控制',.72,.32,.12)];
    for(const [index,value] of ['41.2','10.8','4.10','18.7','74.8'].entries()) {
      const y=.2+index*.02;words.push(word(index?'(kg)':'(L)',.4,y,.025,.012));
      ctx.font='26px Arial';ctx.fillText(value,630,y*2000+20);
    }
    ctx.font='74px Arial';ctx.fillText('79',1100,480);
    ctx.font='26px Arial';ctx.fillText('/100',1190,480);
    const doc={lines:words.map(item=>({...item,words:[item]}))};
    const image=()=>new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const good=await recognizeTemplate(await image(),'independent-synthetic',doc);
    ctx.fillStyle='#fff';ctx.fillRect(620,510,130,40);ctx.fillStyle='#111';ctx.font='26px Arial';ctx.fillText('17.7',630,540);
    const conflict=await recognizeTemplate(await image(),'independent-conflict',doc);
    ctx.fillStyle='#fff';ctx.fillRect(1030,330,400,300);
    ctx.fillStyle='#aaa';ctx.fillRect(1350,330,50,310);
    ctx.fillStyle='#bbb';ctx.font='74px Arial';ctx.fillText('79',1100,480);
    ctx.font='26px Arial';ctx.fillText('/100',1190,480);
    const faint=await recognizeTemplate(await image(),'synthetic-faint-score',doc);
    ctx.fillStyle='#111';ctx.font='74px Arial';ctx.fillText('67',1250,480);
    const competing=await recognizeTemplate(await image(),'synthetic-competing-score',doc);
    canvas.width=1;canvas.height=1;return {good,conflict,faint,competing};
  });
  for(const [key,value] of Object.entries({water:41.2,protein:10.8,minerals:4.1,score:79}))
    assert.equal(independent.good.metrics[key]?.value,value,`Independent synthetic cell ${key}`);
  assert.equal(independent.conflict.accepted,false);
  assert.equal(independent.conflict.metrics.fat,undefined);
  assert.ok(independent.conflict.issues.some(issue=>issue.includes('体脂肪独立位置存在矛盾')));
  assert.equal(independent.faint.metrics.score?.value,79,'Faint numeral excludes full-height paper border and smaller denominator');
  assert.equal(independent.competing.metrics.score,undefined,'Competing same-size score numerators are not guessed');
  checks.push('Actual independent composition/score crop OCR; conflicting printed fat cannot enter a record');
  await page.locator('#photo-input').setInputFiles(input);
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('没有重复新增'));
  assert.equal(await page.evaluate(async()=>{const {snapshot}=await import('./src/storage.js');return (await snapshot()).reports.length;}),1);
  checks.push('Identical photo does not create duplicate records');

  const storage=await page.evaluate(async pixels=>{
    const api=await import('./src/storage.js');
    const before=await api.snapshot(),first=before.reports[0],full=structuredClone(first.points.find(point=>point.kind==='complete'));
    const original=await api.exportBackup();
    const parsed={accepted:true,measuredAt:full.measuredAt,metrics:full.metrics,issues:[],current:full,history:[]};
    const canvas=document.createElement('canvas');canvas.width=20;canvas.height=20;
    canvas.getContext('2d').fillRect(0,0,20,20);
    const other=await new Promise(resolve=>canvas.toBlob(resolve));
    await api.saveScan(other,{accepted:false,measuredAt:null,metrics:{},issues:['synthetic pending'],history:[]},'retry-source');
    await api.saveScan(other,parsed,'new-attempt-id');
    let state=await api.snapshot();
    if(state.reports.length!==2||state.reports.some(source=>source.status!=='saved')||
      state.measurements[0].sourceIDs.length!==2)throw new Error('Pending retry failed');
    const extra=structuredClone(full);extra.metrics.bmr={value:1600,confidence:95};
    const canvas2=document.createElement('canvas');canvas2.width=21;canvas2.height=20;
    canvas2.getContext('2d').fillRect(0,0,21,20);
    const third=await new Promise(resolve=>canvas2.toBlob(resolve));
    await api.saveScan(third,{...parsed,metrics:extra.metrics,current:extra},'extra-source');
    await api.removeReport('extra-source');
    state=await api.snapshot();
    if(state.measurements[0].metrics.bmr)throw new Error('Deleted source left orphan metric');
    const backup=await api.exportBackup(),oldJSON=JSON.stringify((await api.snapshot()).measurements);
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){
      if(this.name==='measurements')throw new DOMException('Synthetic quota failure','QuotaExceededError');
      return put.apply(this,args);
    };
    let rejected=false;
    try {await api.restoreBackup(original);}catch(error){rejected=error.message.includes('空间不足');}
    finally {IDBObjectStore.prototype.put=put;}
    if(!rejected||JSON.stringify((await api.snapshot()).measurements)!==oldJSON)throw new Error('Quota rollback failed');
    const corrupt=JSON.parse(await backup.text());corrupt.checksum='0'.repeat(64);
    let bad=false;try {await api.restoreBackup(new Blob([JSON.stringify(corrupt)]));}catch {bad=true;}
    if(!bad||JSON.stringify((await api.snapshot()).measurements)!==oldJSON)throw new Error('Corrupt backup altered original');
    await api.eraseAll();await api.restoreBackup(backup);await api.restoreBackup(backup);
    state=await api.snapshot();
    if(state.reports.length!==2||state.measurements.length!==1)throw new Error('Atomic restore/dedup failed');
    const tampered=JSON.parse(await backup.text());tampered.payload.measurements[0].metrics.pbf.value=44;
    tampered.checksum=await api.digest(new Blob([JSON.stringify(tampered.payload)]));
    bad=false;try {await api.restoreBackup(new Blob([JSON.stringify(tampered)]));}catch {bad=true;}
    if(!bad)throw new Error('Contradictory backup accepted');
    const invalid=JSON.parse(await backup.text()),fake=new Blob(['not an image'],{type:'image/png'});
    invalid.payload.reports[0].image.base64=btoa('not an image');
    invalid.payload.reports[0].digest=await api.digest(fake);
    invalid.checksum=await api.digest(new Blob([JSON.stringify(invalid.payload)]));
    bad=false;try {await api.restoreBackup(new Blob([JSON.stringify(invalid)]));}catch {bad=true;}
    if(!bad)throw new Error('Undecodable photo accepted');
    await api.eraseAll();
    return {pendingRetry:true,deleteProvenance:true,quotaRollback:true,corruptRejected:true,restoreDedup:true,consistencyRejected:true,photoRejected:true};
  },pixels);
  assert.ok(Object.values(storage).every(Boolean));
  checks.push('Pending retry, source-aware deletion, atomic backup/restore, quota rollback and corrupt-file rejection');
  await page.evaluate(async()=>{const {releaseOCR}=await import('./src/ocr.js');await releaseOCR();});
  await context.setOffline(true);
  await page.reload();await page.waitForSelector('[data-action="demo"]');
  await page.locator('#photo-input').setInputFiles(input);
  await page.waitForFunction(()=>window.__syntheticScan,null,{timeout:180000});
  assert.equal(await page.evaluate(()=>window.__syntheticScan.accepted),true);
  checks.push('Offline reload AND fresh local OCR worker with cached Chinese/English models');
  const cachesSafe=await page.evaluate(async()=>{
    for(const name of await caches.keys())for(const request of await (await caches.open(name)).keys()) {
      const url=new URL(request.url);
      if(url.search||url.protocol!=='http:'||/private|fixture|backup|report-photo/i.test(url.pathname))return false;
    }
    return true;
  });
  assert.equal(cachesSafe,true);assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
  checks.push('No external or upload requests; service-worker cache contains only static assets');
  const blank=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=800;canvas.height=1100;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,800,1100);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.evaluate(()=>{window.__syntheticScan=null;});
  await page.locator('#photo-input').setInputFiles({name:'synthetic-blank.png',mimeType:'image/png',buffer:Buffer.from(blank)});
  await page.waitForFunction(()=>window.__syntheticScan,null,{timeout:180000});
  assert.equal(await page.evaluate(()=>window.__syntheticScan.accepted),false);
  assert.equal(await page.evaluate(async()=>{const {snapshot}=await import('./src/storage.js');return (await snapshot()).measurements.length;}),1);
  checks.push('Actual blank-image OCR is rejected and cannot add a measurement');
  await page.evaluate(async()=>{const {eraseAll}=await import('./src/storage.js');await eraseAll();});
  await page.reload();await page.waitForSelector('[data-action="demo"]');
  await page.locator('[data-action="demo"]').click();
  await mkdir(resolve('WebApp','artifacts'),{recursive:true});
  await page.screenshot({path:resolve('WebApp','artifacts','pwa-synthetic-home.png'),fullPage:true});
  await page.locator('[data-tab="trends"]').click();
  await page.screenshot({path:resolve('WebApp','artifacts','pwa-synthetic-trends.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Mobile horizontal overflow');
  checks.push('390 × 844 mobile viewport with explicitly synthetic screenshots');
  console.log(JSON.stringify({browser:await browser.version(),checks,passed:checks.length,externalRequests:unexpected.length,pageErrors:errors.length},null,2));
} finally {
  try {await page.evaluate(async()=>{const {eraseAll}=await import('./src/storage.js');await eraseAll();});}
  finally {try {await context.close();}finally {await browser.close();}}
}
