import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, parseReport, mergeMeasurements, validateMeasurement, documentFromTSV, numberTokens } from '../src/domain.js';
import { locateTemplatePixels,equalGrid,reconcileMetric,compositionCells,verifiedTimestamp,independentPartial } from '../src/template.js';
const date=parseDate('2032.04.16 08:35');
const word=(text,x,y,width=.04,height=.015,confidence=95)=>({text,x,y,width,height,confidence});
const line=words=>({words,text:words.map(w=>w.text).join(' '),x:Math.min(...words.map(w=>w.x)),
  y:Math.min(...words.map(w=>w.y)),width:Math.max(...words.map(w=>w.x+w.width))-Math.min(...words.map(w=>w.x)),
  height:Math.max(...words.map(w=>w.height)),confidence:95});
function fixture() {
  const lines=[
    line([word('2032.04.16',.42,.12,.12),word('08:35',.56,.12)]),
    ...[['人体成分分析',.18],['肌肉脂肪分析',.4],['肥胖分析',.57],['肌肉均衡',.75]].map(([text,y])=>line([word(text,.07,y,.14)])),
    line([word('InBody评分',.68,.2,.15)]),line([word('体重控制',.68,.32,.13)]),
    line([word('79',.73,.245,.05,.035)]),line([word('/100',.86,.28,.06,.012)]),
    ...[['身体总水分','(L)','41.2'],['蛋白质','(kg)','10.8'],['无机盐','(kg)','4.10'],['体脂肪','(kg)','18.7'],['体重','(kg)','74.8']].map(([label,unit,value],i)=>
      line([word(label,.23,.23+i*.03,.13),word(unit,.38,.23+i*.03,.04),word(value,.44,.23+i*.03,.04),word('(10.0~85.0)',.52,.23+i*.03,.09)])),
    ...['74.8','29.6','18.7'].map((value,i)=>line([word('100',.3,.445+i*.045,.025,.009),word(value,.42,.445+i*.045,.045,.021)])),
    ...['24.4','25.0'].map((value,i)=>line([word('18.5',.3,.63+i*.06,.03,.009),word(value,.42,.63+i*.06,.045,.022)])),
    line([word('99.9',.84,.63,.045,.025)])
  ];
  return {lines};
}
test('strict wall-clock dates reject rollover and ambiguous dates',()=>{
  assert.equal(parseDate('2032.02.30 08:35'),null);
  assert.equal(parseDate('2032.04.16 25:00'),null);
  assert.equal(parseDate('32.04.16 08:35'),null);
  assert.equal(parseDate('32.04.16 08:35',true),date);
  assert.equal(parseDate('2032.04.16 08:35 2032.04.17 08:35'),null);
});
test('date locators cannot veto two trusted crop reads; genuine conflicts and weak confirmations are rejected',()=>{
  const first=parseDate('2040.02.29 17:06'),other=parseDate('2035.09.08 06:42');
  const reading=(date,confidence)=>({date,confidence});
  assert.deepEqual(verifiedTimestamp(reading(other,54),[reading(first,81)],[reading(first,94)]),{date:first,conflict:false});
  assert.deepEqual(verifiedTimestamp(reading(other,90),[reading(first,81)],[reading(first,94)]),{date:null,conflict:true});
  assert.equal(verifiedTimestamp(reading(first,90),[reading(first,69)],[reading(first,94)]).date,null);
  assert.equal(verifiedTimestamp(reading(first,90),[reading(first,81)],[reading(other,94)]).conflict,true);
  assert.equal(verifiedTimestamp(reading(other,54),[reading(first,81)],[]).date,null);
});
test('spatial parser ignores references, chart ticks and right-column decoys',()=>{
  const result=parseReport(fixture(),'synthetic-source');
  assert.equal(result.accepted,true);
  for(const [key,value] of Object.entries({weight:74.8,muscle:29.6,fat:18.7,bmi:24.4,pbf:25,score:79,water:41.2,protein:10.8,minerals:4.1}))
    assert.equal(result.metrics[key]?.value,value,key);
});
test('missing date, missing core and contradictory values cannot be saved',()=>{
  const missing=fixture();missing.lines.shift();assert.equal(parseReport(missing,'s').accepted,false);
  const core=fixture();core.lines=core.lines.filter(l=>!l.text.includes('29.6'));assert.equal(parseReport(core,'s').accepted,false);
  const conflict=fixture();conflict.lines.find(l=>l.text.includes('体重')&&l.text.includes('74.8')).words[2].text='82.6';
  assert.equal(parseReport(conflict,'s').accepted,false);
});
test('full reports upgrade history, retain order, reject conflicts without mutating input',()=>{
  const history={id:'h',kind:'history',measuredAt:date,sourceIDs:['a'],metrics:{
    weight:{value:74.8,confidence:95},muscle:{value:29.6,confidence:95},pbf:{value:25,confidence:95}}};
  const full={...parseReport(fixture(),'b').current,id:'full'};
  const result=mergeMeasurements([history],[full]);
  assert.equal(result[0].kind,'complete');assert.equal(result[0].metrics.muscle.value,29.6);
  assert.deepEqual(result[0].sourceIDs,['a','b']);assert.equal(history.kind,'history');
  const wrong=structuredClone(full);wrong.metrics.weight.value=82.6;
  assert.throws(()=>mergeMeasurements([full],[wrong]),/矛盾/);assert.equal(full.metrics.weight.value,74.8);
  assert.equal(mergeMeasurements([full],[history])[0].kind,'complete');
});
test('backup measurement checks reject NaN, unknown metrics and incomplete full records',()=>{
  const full=parseReport(fixture(),'b').current;validateMeasurement(full);
  const wrong=structuredClone(full);wrong.metrics.weight.value=NaN;assert.throws(()=>validateMeasurement(wrong));
  wrong.metrics.weight.value=74.8;wrong.metrics.fake={value:3,confidence:95};assert.throws(()=>validateMeasurement(wrong));
});
test('partial records require independent evidence and preserve reliable values across complete upgrades',()=>{
  const partial={id:'partial',kind:'partial',measuredAt:date,sourceIDs:['s'],metrics:{
    weight:{value:74.8,confidence:95,evidence:'composition-cell'},
    protein:{value:10.8,confidence:90,evidence:'composition-cell'}}};
  validateMeasurement(partial);
  const noEvidence=structuredClone(partial);delete noEvidence.metrics.weight.evidence;assert.throws(()=>validateMeasurement(noEvidence));
  const weak=structuredClone(partial);weak.metrics.protein.confidence=69;assert.throws(()=>validateMeasurement(weak));
  const single=structuredClone(partial);delete single.metrics.protein;assert.throws(()=>validateMeasurement(single));
  const full=parseReport(fixture(),'s').current;full.metrics.weight.confidence=80;
  const upgraded=mergeMeasurements([partial],[full]);
  assert.equal(upgraded.length,1);assert.equal(upgraded[0].kind,'complete');assert.equal(upgraded[0].metrics.weight.confidence,95);
  const conflict=structuredClone(full);conflict.metrics.weight.value=80;
  assert.throws(()=>mergeMeasurements([partial],[conflict]),/矛盾/);
});
test('screenshot crop mismatch symptoms retain only independent fields; identity and trusted conflicts still veto',()=>{
  const independent={
    weight:{value:74.8,confidence:92,evidence:'composition-cell'},
    fat:{value:18.7,confidence:94,evidence:'composition-cell'},
    score:{value:79,confidence:95,evidence:'score-numerator'}};
  const current={id:'screenshot',kind:'complete',measuredAt:date,sourceIDs:['s'],metrics:{...independent,muscle:{value:29.6,confidence:95}}};
  const issues=['体重整行与字段裁图未一致','体重局部裁图重复复核未一致','体脂肪整行与字段裁图未一致'];
  const partial=independentPartial(current,independent,issues,true);
  assert.deepEqual(Object.keys(partial.metrics),['weight','fat','score']);assert.equal(partial.metrics.muscle,undefined);
  assert.equal(independentPartial(current,independent,issues,false),null);
  assert.equal(independentPartial({...current,measuredAt:null},independent,issues,true),null);
  assert.equal(independentPartial(current,independent,[...issues,'独立日期时间存在矛盾'],true),null);
  const conflict=independentPartial(current,independent,[...issues,'体重独立位置存在矛盾'],true);
  assert.equal(conflict.metrics.weight,undefined);assert.deepEqual(Object.keys(conflict.metrics),['fat','score']);
  assert.equal(independentPartial(current,independent,[...issues,'体重独立位置存在矛盾','体脂肪局部裁图存在矛盾'],true),null);
});
test('TSV word geometry is mapped through general crop coordinates',()=>{
  const tsv='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t10\t20\t30\t10\t95\t24.4';
  const doc=documentFromTSV(tsv,100,100,{x:.2,y:.3},{x:.5,y:.4});
  assert.equal(doc.lines[0].words[0].x,.25);assert.equal(doc.lines[0].words[0].y,.38);
});
test('split headings and separate units preserve geometry; unrelated weak header text does not invalidate the timestamp',()=>{
  const doc=fixture(),title=doc.lines.find(l=>l.text==='人体成分分析');
  doc.lines.splice(doc.lines.indexOf(title),1,line([word('人体成分',.07,.18,.09)]),line([word('分析',.17,.18,.04)]));
  doc.lines[0].words.unshift(word('uncertain123',.1,.12,.1,.015,20));
  doc.lines[0].text=doc.lines[0].words.map(word=>word.text).join(' ');
  const body=doc.lines.find(l=>l.text.includes('蛋白质'));
  doc.lines.splice(doc.lines.indexOf(body),1,...body.words.map(word=>line([word])));
  assert.equal(parseReport(doc,'synthetic-split').accepted,true);
  assert.equal(parseReport(doc,'synthetic-split').metrics.protein.value,10.8);
  assert.equal(numberTokens({lines:[line([word('B2/100',.5,.5)])]}).length,0);
});
test('history requires exactly the printed three metrics and conflicts are not silently replaced',()=>{
  const full=parseReport(fixture(),'s').current;
  const history={...full,kind:'history',metrics:Object.fromEntries(['weight','muscle','pbf'].map(key=>[key,full.metrics[key]]))};
  validateMeasurement(history);
  const missing=structuredClone(history);delete missing.metrics.pbf;assert.throws(()=>validateMeasurement(missing));
  const wrong=structuredClone(history);wrong.metrics.weight.value=80;
  assert.throws(()=>mergeMeasurements([history],[wrong]),/矛盾/);
});
test('printed comma/dot timestamp separators are accepted without inventing missing date characters',()=>{
  assert.equal(parseDate('2032.04.16, 08:35'),date);
  assert.equal(parseDate('2032.04.16.08:35'),date);
  assert.equal(parseDate('2032.04.1608:35'),null);
  assert.equal(parseDate('2032.04.16, 08:35 2032.04.17, 08:35'),null);
  const doc=fixture();doc.lines[0].words[0].text+='，';
  assert.equal(parseReport(doc,'synthetic-comma').measuredAt,date);
});
test('decimal fragments join only when the printed dot and adjacent fractional digits actually exist',()=>{
  const adjacent={lines:[line([word('29.',.4,.4,.03),word('6',.435,.4,.01)])]};
  assert.equal(numberTokens(adjacent)[0].value,29.6);
  adjacent.lines[0].words[1].confidence=30;assert.equal(numberTokens(adjacent)[0].confidence,30);
  const distant={lines:[line([word('29.',.1,.4,.03),word('6',.7,.4,.01)])]};
  assert.ok(!numberTokens(distant).some(token=>token.value===29.6));
  const absent={lines:[line([word('29',.4,.4,.03),word('6',.435,.4,.01)])]};
  assert.ok(!numberTokens(absent).some(token=>token.value===29.6));
});
test('template locator requires a unique three-plus-two bar pattern and separate bottom grid lines',()=>{
  const w=720,h=1000,gray=new Uint8Array(w*h);gray.fill(255);
  const rect=(x,y,width,height)=>{for(let yy=y;yy<y+height;yy++)gray.fill(50,yy*w+x,yy*w+x+width);};
  for(const y of [350,378,406,510,538])for(const x of [200,227,254])rect(x,y,25,6);
  assert.equal(locateTemplatePixels(gray,w,h),null);
  assert.ok(locateTemplatePixels(gray,w,h,true));
  rect(120,800,380,1);rect(120,850,380,1);
  const layout=locateTemplatePixels(gray,w,h);assert.equal(layout.group.length,5);assert.equal(layout.grids,2);
  gray.fill(255);assert.equal(locateTemplatePixels(gray,w,h),null);
  for(const y of [250,270,290,350,370,470,490,510,570,590])
    for(const x of [200,227,254])rect(x,y,25,6);
  assert.equal(locateTemplatePixels(gray,w,h,true),null);
});
test('independent metric disagreement removes the candidate and cannot be overwritten by a later source',()=>{
  const metrics={weight:{value:74.8,confidence:95}},issues=[];
  reconcileMetric(metrics,'weight',{value:72.8,confidence:99},issues);
  assert.equal(metrics.weight,undefined);assert.ok(issues.some(issue=>issue.includes('独立位置存在矛盾')));
  reconcileMetric(metrics,'weight',{value:74.8,confidence:100},issues);
  assert.equal(metrics.weight,undefined);
  const missing=['体脂肪未可靠识别'];
  reconcileMetric(metrics,'fat',{value:18.7,confidence:92},missing);
  assert.equal(metrics.fat.value,18.7);assert.equal(missing.length,0);
});
test('composition cells require five equally spaced aligned printed units, not guessed missing rows',()=>{
  const units=Array.from({length:5},(_,index)=>({text:index?'(kg)':'(L)',x:.4,y:.2+index*.02,width:.025,height:.01,confidence:85}));
  const doc={lines:units.map(word=>({words:[word]}))},anchors={composition:{x:.1,y:.15,height:.02},muscle:{y:.32},score:{x:.7}};
  const layout={group:[{y:700}],gap:50};
  assert.equal(compositionCells(doc,anchors,layout,2000,2600).length,5);
  assert.equal(compositionCells({lines:doc.lines.slice(1)},anchors,layout,2000,2600).length,0);
  assert.equal(equalGrid([10,30,50,100],3,10,30)?.length,3);
  assert.equal(equalGrid([10,30,50,100,120,140],3,10,30),null);
});
