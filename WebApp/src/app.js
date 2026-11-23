import { definitions, definition, formatValue, printDate, parseReport } from './domain.js';
import { snapshot, saveScan, digest, removeReport, eraseAll, exportBackup, restoreBackup } from './storage.js';
import { recognize, releaseOCR } from './ocr.js';
import { recognizeTemplate } from './template.js';

const main=document.querySelector('#main'),notice=document.querySelector('#notice'),dialog=document.querySelector('#detail');
let state={reports:[],measurements:[]},tab='home',busy=false,offlineReady=false,demo=false,offlineRegistration,reloadForUpdate=false;
const urls=new Set();
const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const message=(text,error=false)=>{notice.textContent=text;notice.className=error?'notice error':'notice';};
const chart=(points,id,large=false)=>{
  if(!points.length)return '<div class="empty-inline">尚未识别此指标</div>';
  const values=points.map(p=>p.metrics[id].value),min=Math.min(...values),max=Math.max(...values);
  const span=Math.max(max-min,1),width=320,height=large?150:52;
  const timeSpan=points.at(-1).measuredAt-points[0].measuredAt;
  const coords=values.map((v,i)=>[timeSpan?12+(points[i].measuredAt-points[0].measuredAt)*296/timeSpan:160,height-12-(v-min)/span*(height-24)]);
  return `<svg class="${large?'large-chart':'sparkline'}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(definition(id).name)}，${points.length===1?'仅一次测量，尚无趋势':`${points.length} 次真实记录`}">
    ${points.length>1?`<polyline points="${coords.map(p=>p.join(',')).join(' ')}" fill="none" stroke="currentColor" stroke-width="${large?3:2}" stroke-linecap="round" stroke-linejoin="round"/>`:''}
    ${coords.map(([x,y])=>`<circle cx="${x}" cy="${y}" r="${large?4:3}" fill="currentColor"/>`).join('')}</svg>`;
};
const metricPoints=id=>state.measurements.filter(point=>point.metrics[id]).sort((a,b)=>a.measuredAt-b.measuredAt);
const localPill=()=>`<span class="pill"><i></i>仅本机${offlineReady?' · 可离线':''}</span>`;
function intro(eyebrow,title,description) {
  return `<div class="intro"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p>${localPill()}</div>`;
}
function renderHome() {
  const latest=state.measurements.at(-1);
  let html=intro('YOUR BODY, YOUR RECORD','看见每一次变化','把报告变成记录，慢慢了解自己的身体。');
  if(demo)html+='<div class="demo-banner">合成演示 · 不是你的报告或识别成果</div>';
  if(!latest) {
    html+=`<section class="hero empty"><div class="scan-symbol">⌁</div><h2>从第一张报告开始</h2><p>拍照或选图，设备内自动识别。<br>无需填写数字，也不会上传报告。</p><button class="primary" data-go="scan">扫描体测报告 <span>↗</span></button></section>`;
  } else {
    html+=`<div class="section-heading"><h2>最近一次测量</h2><span>${printDate(latest.measuredAt)}</span></div><div class="core-grid">`;
    for(const id of ['weight','muscle','pbf']) {
      const points=metricPoints(id),current=points.at(-1),previous=points.at(-2),def=definition(id);
      if(!current)continue;
      const delta=previous?current.metrics[id].value-previous.metrics[id].value:null;
      html+=`<button class="metric-card ${id==='weight'?'featured':''}" data-metric="${id}"><span class="metric-label">${def.name} <span>↗</span></span>
        <div class="metric-value">${formatValue(id,current.metrics[id].value)}<small>${def.unit}</small></div>
        <span class="delta">${delta===null?'首次记录':`${delta>0?'+':''}${delta.toFixed(1)} ${id==='pbf'?'百分点':def.unit} · 较上次`}</span>
        ${chart(points.slice(-8),id)}</button>`;
    }
    html+='</div>';
    html+=`<button class="wide-action" data-go="trends"><span><strong>全部指标趋势</strong><small>仅展示报告中实际识别的指标</small></span><b>↗</b></button>`;
  }
  html+=`<section class="tip"><span>◷</span><div><h3>让比较更有意义</h3><p>尽量在相近时间、饮水与运动条件下测量。单次变化不代表好坏，也不是医疗诊断。</p></div></section>
    <section class="backup-reminder"><strong>本地记录，也需要备份</strong><p>清理网站数据、换手机或系统回收空间可能丢失记录。备份到「文件」或 iCloud Drive 是手动文件备份，不是自动同步。</p><button class="text-button" data-action="settings">管理备份 →</button></section>`;
  if(!latest)html+='<button class="text-button muted" data-action="demo">查看合成界面演示</button>';
  main.innerHTML=html;
}
function renderScan() {
  main.innerHTML=intro('SCAN WITHOUT TYPING','一张照片，自动记录','可靠日期下，只保存经过复核的指标；缺失或冲突的值不进入趋势。')+
    `<section class="hero scan-hero"><div class="viewfinder"><span></span><div class="paper"><i></i><i></i><i></i><i></i><b>↗</b></div></div>
      <h2>对准整张报告</h2><p>铺平报告，避免阴影、反光和裁切。<br>日期、正文和底部历史都要保留。</p>
      <button class="primary" data-action="camera" ${busy?'disabled':''}>拍摄报告</button><button class="secondary" data-action="photo" ${busy?'disabled':''}>从相册选择</button>
      <div id="scan-progress" data-state="idle" role="status"></div></section>
    <section class="tip"><span>◉</span><div><h3>图片不会离开设备</h3><p>首次需要下载中文/英文模型和离线资源，约几十 MB。下载完成后可离线识别；复杂报告可能需要较长时间，请保持页面打开。</p></div></section>
    <p class="footnote">可保存独立核实的部分指标，并明确标记缺失。日期不可靠时仅保留原图；可在「报告」使用原图重新识别，不需手填。</p>`;
}
function renderTrends() {
  const available=definitions.filter(def=>metricPoints(def.id).length);
  main.innerHTML=intro('EVERY RECOGNIZED METRIC','变化，不止体重','按报告的测量时间排序，而不是照片导入时间。')+
    (demo?'<div class="demo-banner">以下数据均为独立合成演示</div>':'')+
    (!available.length?'<section class="empty"><h2>还没有趋势记录</h2><p>先扫描报告；未识别的值不填零、不反推。</p><button class="primary" data-go="scan">扫描第一张报告</button></section>':
      [...new Set(available.map(def=>def.group))].map(group=>`<div class="section-heading"><h2>${group}</h2></div><div class="trend-list">`+
        available.filter(def=>def.group===group).map(def=>{
          const points=metricPoints(def.id),last=points.at(-1);
          return `<button class="trend-row" data-metric="${esc(def.id)}"><div><strong>${def.name}</strong><span>${points.length} 次记录${points.length===1?' · 单点无趋势':''}</span></div>${chart(points.slice(-8),def.id)}
            <div class="trend-value">${formatValue(def.id,last.metrics[def.id].value)}<small>${def.unit}</small></div></button>`;
        }).join('')+'</div>').join(''));
}
function renderReports() {
  main.innerHTML=intro('TRACEABLE & LOCAL','每一条，都有来源','原图保存在本机；待识别报告不会伪装成成功。')+
    (!state.reports.length?'<section class="empty"><h2>报告库是空的</h2><p>真实照片不会在演示中自动预载。</p></section>':
      [...state.reports].sort((a,b)=>b.importedAt-a.importedAt).map(report=>`<button class="report-card" data-report="${esc(report.id)}"><span class="report-icon">▤</span><div>
        <strong>${report.measuredAt===null?'待识别报告':printDate(report.measuredAt)}</strong>
        <small>${report.status==='saved'?'已保存 · 可查看原图与识别范围':report.status==='partial'?'部分保存 · 仅可信指标进入趋势':'待识别 · 原图保留，可重新识别'}</small></div><span class="status-tag ${report.status}">${report.status==='saved'?'已记录':report.status==='partial'?'部分保存':'待识别'}</span></button>`).join(''))+
    '<section class="backup-reminder"><strong>卸载或清理数据前，先导出备份</strong><p>浏览器存储不是永久保险箱。请定期保存到私密位置。</p><button class="text-button" data-action="export">导出备份 →</button></section>';
}
function render() {
  for(const url of urls)URL.revokeObjectURL(url);urls.clear();
  document.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle('active',button.dataset.tab===tab));
  ({home:renderHome,scan:renderScan,trends:renderTrends,reports:renderReports})[tab]();
}
function showSettings() {
  const content=document.querySelector('#detail-content');
  content.innerHTML=`<div class="eyebrow">LOCAL FIRST</div><h2>本地存储与备份</h2><p>没有账户、后台或自动云同步。记录和照片存于浏览器 IndexedDB。</p>
    <div class="settings-count"><strong>${state.measurements.length}</strong> 次测量 · <strong>${state.reports.length}</strong> 张报告</div>
    <button class="primary" data-action="export">导出备份文件</button><button class="secondary" data-action="restore">从文件合并恢复</button>
    <p class="warning">备份包含健康资料与原图，未加密。请放在「文件」或 iCloud Drive 的私密位置，不要公开分享。</p>
    <button class="secondary" data-action="persist">申请持久存储</button><p id="persist-status" class="footnote">浏览器可以拒绝申请；即使获准也不能保证永不丢失。</p>
    <button class="secondary" data-action="update">检查并加载应用更新</button><p class="footnote">更新只替换应用资源，不删除照片和记录。正在识别时不能加载更新。</p>
    <button class="danger" data-action="erase" ${demo?'disabled':''}>删除全部本地数据</button>
    <h3>添加到 iPhone 主屏幕</h3><p>正式 HTTPS 网页发布后，用 Safari 打开，点「分享」→「添加到主屏幕」。当前本地电脑预览不能替代 iPhone Safari 真机验收。</p>`;
  dialog.showModal();
}
function showMetric(id,months=0) {
  const def=definition(id),all=metricPoints(id);if(!def||!all.length)return;
  const last=all.at(-1).measuredAt;
  const points=months?all.filter(point=>point.measuredAt>=last-months*31*86400000):all;
  document.querySelector('#detail-content').innerHTML=`<div class="eyebrow">${def.group}</div><h2>${def.name}</h2>
    <div class="detail-value">${formatValue(id,all.at(-1).metrics[id].value)} <small>${def.unit}</small></div>
    <div class="range-tabs">${[[1,'1 个月'],[3,'3 个月'],[12,'1 年'],[0,'全部']].map(([value,label])=>`<button data-range="${value}" data-for="${esc(id)}" class="${value===months?'selected':''}">${label}</button>`).join('')}</div>
    ${chart(points,id,true)}<p class="footnote">${points.length===1?'仅一次测量，不能判断趋势。':'点击下方单次记录查看来源。'} 时间窗口以最新测量为基准。</p>
    ${[...points].reverse().map(point=>`<button class="point-row" data-point="${esc(point.id)}"><span>${printDate(point.measuredAt)}<small>${point.kind==='history'?'报告底部历史摘要':point.kind==='partial'?'部分指标 · 独立复核':'核心完整报告'}</small></span><strong>${formatValue(id,point.metrics[id].value)} ${def.unit}</strong></button>`).join('')}
    <p class="footnote">${id==='pbf'?'体脂率变化使用百分点；分段比例不是体脂率。':'指标是设备估计值，不提供诊断或饮食处方。'}</p>`;
  if(!dialog.open)dialog.showModal();
}
function showReport(id) {
  const report=state.reports.find(item=>item.id===id);if(!report)return;
  const url=URL.createObjectURL(report.image);urls.add(url);
  document.querySelector('#detail-content').innerHTML=`<div class="eyebrow">${report.status==='saved'?'报告来源':report.status==='partial'?'部分保存 · 缺失和冲突未入库':'待识别 · 原图保留'}</div>
    <h2>${report.measuredAt===null?'报告待识别':printDate(report.measuredAt)}</h2><img class="source-photo" src="${url}" alt="仅本机保存的报告原图">
    <p>${report.status==='partial'?'已保存独立核实的指标，其他值仍缺失。':report.status==='pending'?'尚未满足日期或指标复核要求，原图仍在本机。':'已保存可信记录。'}使用下方按钮更新识别，不需重拍或清理网站数据。</p>
    <h3>识别范围与质量</h3><ul>${report.issues.map(issue=>`<li>${esc(issue)}</li>`).join('')||'<li>核心一致性检查通过</li>'}</ul>
    <p class="footnote">未识别项目不填零。可信冲突不会覆盖原记录；再次识别不会重复新增这张图。</p>
    <button class="primary" data-retry="${esc(id)}" ${busy?'disabled':''}>使用已存原图重新识别</button>
    <button class="secondary" data-action="photo">重新选图</button><button class="danger" data-delete="${esc(id)}">删除此报告及仅由它提供的记录</button>`;
  if(!dialog.open)dialog.showModal();
}
async function refresh() {state=await snapshot();render();}
async function scan(file,retry=false) {
  if(!file||busy)return;
  if(demo){demo=false;state=await snapshot();}
  busy=true;tab='scan';dialog.close();render();
  const progress=document.querySelector('#scan-progress');
  progress.dataset.state='working';
  try {
    const hash=await digest(file),existing=state.reports.find(report=>report.digest===hash);
    if(existing?.status==='saved'&&!retry){message('这张照片已经保存，没有重复新增。');return;}
    const sourceID=crypto.randomUUID(),started=performance.now();
    const doc=await recognize(file,({status,progress:value})=>{
      progress.textContent=`${status} · ${Math.round(value*100)}%`;
    });
    let parsed=parseReport(doc,sourceID);
    if(!parsed.accepted) {
      await releaseOCR();
      const template=await recognizeTemplate(file,sourceID,doc,({status,progress:value})=>{
        progress.textContent=`${status} · ${Math.round(value*100)}%`;
      });
      if(template)parsed=template;
    }
    const result=await saveScan(file,parsed,sourceID,retry);
    await refresh();tab='reports';render();
    message(result.status==='partial'?'已部分保存：仅独立核实的指标进入趋势，缺失或冲突值未保存。':
      result.status==='saved'?`已保存可信记录，识别耗时 ${Math.round((performance.now()-started)/1000)} 秒。`:
      '原图已保留，日期或可信指标仍不足；可在报告中使用原图重新识别。',result.status==='pending');
    document.dispatchEvent(new CustomEvent('scan-finished',{detail:{accepted:result.status!=='pending',partial:result.status==='partial'}}));
  } catch(error) {
    message(error.message==='同一测量时间存在矛盾的完整报告，未覆盖原记录'?error.message:
      `未完成保存：${error.message}`,true);
    document.dispatchEvent(new CustomEvent('scan-finished',{detail:{accepted:false,error:true}}));
  } finally {
    busy=false;const element=document.querySelector('#scan-progress');if(element)element.dataset.state='finished';
    document.querySelectorAll('[data-action="camera"],[data-action="photo"]').forEach(button=>button.disabled=false);
  }
}
async function downloadBackup() {
  if(demo){message('合成演示不会写入或导出你的真实数据库');return;}
  if(!confirm('备份含健康资料及原图，未加密。请保存到私密的「文件」或 iCloud Drive；这不是自动云同步。是否继续？'))return;
  const blob=await exportBackup(),name=`inbody-backup-${new Date().toISOString().slice(0,10)}.json`;
  const file=new File([blob],name,{type:'application/json'});
  if(navigator.canShare?.({files:[file]})) {
    try {await navigator.share({files:[file],title:'私密体测备份'});}
    catch(error){if(error.name!=='AbortError')throw new Error('系统分享失败，请重新导出并选择保存位置');else message('已取消分享，原数据保留');}
  } else {
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;
    link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
}
const actions={
  update:async()=>{
    if(busy)throw new Error('正在识别，请完成后再更新应用');
    if(!offlineRegistration)throw new Error('离线注册尚未完成，请保持联网后重试');
    await offlineRegistration.update();
    if(offlineRegistration.waiting){reloadForUpdate=true;offlineRegistration.waiting.postMessage('ACTIVATE');}
    else if(offlineRegistration.installing)message('新版本资源正在下载，完成后再次点更新；照片和记录保持不变。');
    else message('已检查更新；若界面仍为旧版，请关闭再打开，不要清理网站数据。');
  },
  settings:showSettings,camera:()=>document.querySelector('#camera-input').click(),photo:()=>document.querySelector('#photo-input').click(),
  export:downloadBackup,restore:()=>{if(busy)throw new Error('正在识别，请完成后再恢复备份');document.querySelector('#backup-input').click();},
  persist:async()=>{
    const granted=await navigator.storage?.persist?.();
    document.querySelector('#persist-status').textContent=granted?'浏览器已获准持久存储，但仍请备份；清理数据或卸载仍可能丢失。':'浏览器未保证持久存储，请定期备份。';
  },
  erase:async()=>{if(busy)throw new Error('正在识别，请完成后再删除数据');if(confirm('删除全部本地照片与记录？请先导出备份。此操作不能撤销。')){await eraseAll();dialog.close();await refresh();message('本地记录已删除');}},
  demo:async()=>{
    if(busy)return;demo=!demo;
    if(!demo){await refresh();return;}
    const dates=['2032.01.16 08:35','2032.02.16 08:35','2032.03.16 08:35','2032.04.16 08:35'];
    const {parseDate}=await import('./domain.js');
    state={reports:[],measurements:dates.map((date,index)=>({id:`demo-${index}`,measuredAt:parseDate(date),kind:'complete',sourceIDs:[],
      metrics:Object.fromEntries(Object.entries({weight:77.2-index*0.8,muscle:28.4+index*0.4,fat:21.3-index*0.85,bmi:25.2-index*0.25,pbf:27.6-index*0.87,score:76+index})
        .map(([key,value])=>[key,{value,confidence:100}]))}))};render();
  }
};
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  try {
    if(button.dataset.tab||button.dataset.go){tab=button.dataset.tab??button.dataset.go;render();window.scrollTo(0,0);}
    else if(button.dataset.action)await actions[button.dataset.action]?.();
    else if(button.dataset.metric)showMetric(button.dataset.metric);
    else if(button.dataset.range)showMetric(button.dataset.for,Number(button.dataset.range));
    else if(button.dataset.report)showReport(button.dataset.report);
    else if(button.dataset.retry) {
      const report=state.reports.find(item=>item.id===button.dataset.retry);
      if(!report)throw new Error('原图来源不存在，请重新打开报告列表');
      await scan(report.image,true);
    }
    else if(button.dataset.point) {
      const point=state.measurements.find(item=>item.id===button.dataset.point),source=point?.sourceIDs[0];
      if(source)showReport(source);else message('这是合成演示，不包含真实原图');
    } else if(button.dataset.delete&&confirm('删除这张报告？请确保已有私密备份。')) {
      if(busy)throw new Error('正在识别，请完成后再删除报告');
      await removeReport(button.dataset.delete);dialog.close();await refresh();message('报告已删除');
    }
  } catch(error){message(error.message,true);}
});
document.querySelector('#settings').addEventListener('click',showSettings);
document.querySelector('#close-detail').addEventListener('click',()=>{dialog.close();for(const url of urls)URL.revokeObjectURL(url);urls.clear();});
for(const id of ['camera-input','photo-input'])document.querySelector(`#${id}`).addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';await scan(file);
});
document.querySelector('#backup-input').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  try {demo=false;const result=await restoreBackup(file);dialog.close();await refresh();message(`校验后合并恢复：${result.measurements} 次测量、${result.reports} 张报告。`);}
  catch(error){message(`恢复失败：${error.message}。原库未清空。`,true);}
});
document.addEventListener('visibilitychange',()=>document.body.classList.toggle('privacy-cover',document.hidden));
window.addEventListener('pagehide',()=>{for(const url of urls)URL.revokeObjectURL(url);urls.clear();});
async function prepareOffline() {
  if(!('serviceWorker' in navigator)){message('此浏览器不支持离线准备；请使用现代 Safari/Chrome。',true);return;}
  try {
    const registration=await navigator.serviceWorker.register('./sw.js');
    offlineRegistration=registration;
    registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',()=>{
      if(registration.waiting)message('离线版本已更新，完成当前操作后关闭并重新打开应用。');
    }));
    await navigator.serviceWorker.ready;offlineReady=true;
    if(!busy)render();message('应用与 OCR 模型已完整缓存，可离线使用。请仍定期备份记录。');
  } catch {message('离线资源尚未准备完成；需要联网首次下载，未保证离线识别。',true);}
}
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(reloadForUpdate&&!busy)location.reload();
});
try {await refresh();prepareOffline();}catch(error){message(error.message,true);main.innerHTML='<section class="empty"><h1>无法打开本地数据库</h1><p>请检查浏览器隐私模式、存储权限和剩余空间。未将失败伪装为空报告库。</p></section>';}
window.addEventListener('beforeunload',()=>{if(busy)releaseOCR();});
