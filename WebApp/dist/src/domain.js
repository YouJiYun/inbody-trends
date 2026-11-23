const basic = [
  ['weight','体重','kg','核心',15,350,1], ['muscle','骨骼肌','kg','核心',5,100,1],
  ['fat','体脂肪','kg','核心',0.5,200,1], ['bmi','BMI','kg/m²','核心',8,80,1],
  ['pbf','体脂率','%','核心',1,70,1], ['score','InBody 评分','分','人体成分',0,150,0],
  ['water','身体总水分','L','人体成分',5,150,1], ['protein','蛋白质','kg','人体成分',1,50,1],
  ['minerals','无机盐','kg','人体成分',0.5,15,2], ['target','目标体重','kg','体重控制',15,350,1],
  ['weightControl','体重控制','kg','体重控制',-150,150,1],
  ['fatControl','脂肪控制','kg','体重控制',-150,150,1],
  ['muscleControl','肌肉控制','kg','体重控制',-80,80,1],
  ['whr','腰臀比','','研究项目',0.4,1.5,2], ['visceral','内脏脂肪等级','级','研究项目',1,30,0],
  ['ffm','去脂体重','kg','研究项目',10,200,1], ['bmr','基础代谢率','kcal','研究项目',400,5000,0],
  ['obesity','肥胖度','%','研究项目',30,300,0], ['smi','SMI','kg/m²','研究项目',1,25,1],
  ['calories','建议热量摄入','kcal','研究项目',500,7000,0]
];
export const limbs = [['leftArm','左上肢'],['rightArm','右上肢'],['trunk','躯干'],['leftLeg','左下肢'],['rightLeg','右下肢']];
export const definitions = basic.map(([id,name,unit,group,min,max,decimals]) => ({id,name,unit,group,min,max,decimals}));
for (const [limb,name] of limbs) {
  for (const kind of ['lean','fat']) for (const unit of ['kg','percent']) {
    definitions.push({id:`${kind}.${limb}.${unit}`,name:`${name}${kind === 'lean' ? '肌肉' : '脂肪'}${unit === 'percent' ? '比例' : ''}`,
      unit:unit === 'kg' ? 'kg' : '%',group:kind === 'lean' ? '分段肌肉' : '分段脂肪',
      min:unit === 'kg' ? 0 : 1,max:unit === 'kg' ? 100 : 900,decimals:1});
  }
  for (const freq of [20,100]) definitions.push({id:`z.${freq}.${limb}`,name:`${name} · ${freq} kHz`,
    unit:'Ω',group:'生物电阻抗',min:1,max:2000,decimals:1});
}
export const definition = id => definitions.find(item => item.id === id);
export const coreKeys = ['weight','muscle','fat','bmi','pbf'];
export const compact = text => text.replace(/\s/g,'').replaceAll('（','(').replaceAll('）',')').replaceAll('−','-');
export const formatValue = (id,value) => value.toFixed(definition(id)?.decimals ?? 1);
export const printDate = timestamp => {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}.${String(date.getUTCMonth()+1).padStart(2,'0')}.${String(date.getUTCDate()).padStart(2,'0')} ${String(date.getUTCHours()).padStart(2,'0')}:${String(date.getUTCMinutes()).padStart(2,'0')}`;
};
export function parseDate(text, short = false) {
  const regex = short ? /(?<!\d)(\d{4}|\d{2})[./-](\d{2})[./-](\d{2})(?:\s+|[.,，]\s*)(\d{2}):(\d{2})(?!\d)/g
    : /(?<!\d)(\d{4})[./-](\d{2})[./-](\d{2})(?:\s+|[.,，]\s*)(\d{2}):(\d{2})(?!\d)/g;
  const dates = [];
  for (const match of text.matchAll(regex)) {
    const [,yy,mm,dd,hh,minute] = match;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    const timestamp = Date.UTC(year,Number(mm)-1,Number(dd),Number(hh),Number(minute));
    if (year < 2000 || year > 2099 || Number(hh)>23 || Number(minute)>59) continue;
    const date = new Date(timestamp);
    if (date.getUTCMonth()+1 !== Number(mm) || date.getUTCDate() !== Number(dd)) continue;
    dates.push(timestamp);
  }
  const unique = [...new Set(dates)];
  return unique.length === 1 ? unique[0] : null;
}
export function documentFromTSV(tsv,width,height,offset = {x:0,y:0},scale = {x:1,y:1}) {
  const groups = new Map();
  for (const row of tsv.split('\n').slice(1)) {
    const parts = row.split('\t');
    if (parts.length<12 || Number(parts[0])!==5 || !parts.slice(11).join('\t').trim()) continue;
    const [x,y,w,h,confidence] = parts.slice(6,11).map(Number);
    if (![x,y,w,h,confidence].every(Number.isFinite) || confidence<0) continue;
    const word = {text:parts.slice(11).join('\t'),confidence,x:offset.x+x/width*scale.x,
      y:offset.y+y/height*scale.y,width:w/width*scale.x,height:h/height*scale.y};
    const key = parts.slice(1,5).join(':');
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(word);
  }
  return {lines:[...groups.values()].map(words => {
    words.sort((a,b)=>a.x-b.x);
    const x=Math.min(...words.map(w=>w.x)),y=Math.min(...words.map(w=>w.y));
    return {words,text:words.map(w=>w.text).join(' '),x,y,
      width:Math.max(...words.map(w=>w.x+w.width))-x,height:Math.max(...words.map(w=>w.y+w.height))-y,
      confidence:words.reduce((n,w)=>n+w.confidence*w.text.length,0)/words.reduce((n,w)=>n+w.text.length,0)};
  })};
}
export function documentFromBlocks(blocks,width,height,offset={x:0,y:0},scale={x:1,y:1}) {
  const geometry=box=>({x:offset.x+box.x0/width*scale.x,y:offset.y+box.y0/height*scale.y,
    width:(box.x1-box.x0)/width*scale.x,height:(box.y1-box.y0)/height*scale.y});
  const lines=[];
  for(const block of blocks)for(const paragraph of block.paragraphs)for(const line of paragraph.lines) {
    const words=line.words.filter(word=>word.text.trim()).map(word=>({text:word.text,confidence:word.confidence,
      ...geometry(word.bbox),symbols:word.symbols.map(symbol=>({text:symbol.text,confidence:symbol.confidence,...geometry(symbol.bbox)}))}));
    if(words.length)lines.push({words,text:words.map(word=>word.text).join(' '),confidence:line.confidence,...geometry(line.bbox)});
  }
  return {lines};
}
const midX = box => box.x+box.width/2, midY = box => box.y+box.height/2;
function labelBox(line,label) {
  const needle=compact(label).toLowerCase();
  let all='',spans=[];
  for(const word of line.words) {
    const start=all.length;all+=compact(word.text).toLowerCase();spans.push({word,start,end:all.length});
  }
  const start=all.indexOf(needle);
  if(start<0)return null;
  const end=start+needle.length, selected=spans.filter(s=>s.end>start&&s.start<end);
  const parts=[];
  for(const span of selected) {
    if(span.word.symbols?.map(symbol=>compact(symbol.text).toLowerCase()).join('')===compact(span.word.text).toLowerCase()) {
      let position=span.start;
      for(const symbol of span.word.symbols) {
        const left=position;position+=compact(symbol.text).length;
        if(position>start&&left<end)parts.push(symbol);
      }
    } else {
      const x=span.word.x+span.word.width*Math.max(0,start-span.start)/(span.end-span.start);
      const right=span.word.x+span.word.width*Math.min(span.end-span.start,end-span.start)/(span.end-span.start);
      parts.push({...span.word,x,width:right-x});
    }
  }
  const x=Math.min(...parts.map(part=>part.x)),y=Math.min(...parts.map(part=>part.y));
  return {text:label,x,y,width:Math.max(...parts.map(part=>part.x+part.width))-x,
    height:Math.max(...parts.map(part=>part.y+part.height))-y,confidence:Math.min(...selected.map(s=>s.word.confidence))};
}
const rowCache=new WeakMap();
function labelLines(doc) {
  const cached=rowCache.get(doc);
  if(cached?.length===doc.lines.length)return cached.lines;
  const rows=[];
  for(const line of doc.lines) {
    const row=rows.find(row=>Math.abs(midY(row[0])-midY(line))<Math.max(row[0].height,line.height)*0.65);
    if(row)row.push(line);else rows.push([line]);
  }
  const joined=[];
  for(const row of rows) {
    const words=row.flatMap(line=>line.words).sort((a,b)=>a.x-b.x),groups=[];
    for(const word of words) {
      let group=groups.at(-1),previous=group?.at(-1);
      if(!group||word.x-(previous.x+previous.width)>.06){group=[];groups.push(group);}
      if(previous&&compact(previous.text)===compact(word.text)&&Math.abs(previous.x-word.x)<.003)continue;
      group.push(word);
    }
    for(const words of groups)if(words.length>1) {
      const x=Math.min(...words.map(w=>w.x)),y=Math.min(...words.map(w=>w.y));
      joined.push({words,text:words.map(w=>w.text).join(' '),x,y,
        width:Math.max(...words.map(w=>w.x+w.width))-x,height:Math.max(...words.map(w=>w.height)),
        confidence:words.reduce((n,w)=>n+w.confidence*w.text.length,0)/words.reduce((n,w)=>n+w.text.length,0)});
    }
  }
  const lines=[...doc.lines,...joined];rowCache.set(doc,{length:doc.lines.length,lines});return lines;
}
function editDistance(a,b) {
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++) {
    let previous=row[0];row[0]=i;
    for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));previous=old;}
  }
  return row[b.length];
}
function anchor(doc,labels,region,fuzzy=false) {
  const candidates=[];
  for(const line of labelLines(doc))for(const label of labels) {
    const box=labelBox(line,label);
    if(box&&box.confidence>=35&&(!region||region(box)))candidates.push(box);
  }
  if(!candidates.length&&fuzzy)for(const line of labelLines(doc))for(const label of labels) {
    const text=compact(line.text),distance=editDistance(text,compact(label));
    if(line.confidence>=50&&distance<=Math.floor(label.length/3)&&Math.abs(text.length-label.length)<=1&&(!region||region(line))) {
      candidates.push({...line,text:label,approximate:true});
    }
  }
  return candidates.sort((a,b)=>Math.abs(a.y-b.y)<0.003?a.width-b.width:a.y-b.y)[0]??null;
}
export function locateAnchors(doc) {
  const composition=anchor(doc,['人体成分分析'],box=>box.x<.5,true);
  const left=box=>box.x<.5&&(!composition||Math.abs(box.x-composition.x)<.13);
  const muscle=anchor(doc,['肌肉脂肪分析'],left,true);
  const obesity=anchor(doc,['肥胖分析'],left,true),segment=anchor(doc,['肌肉均衡','节段肌肉','分段肌肉'],left,true);
  const control=anchor(doc,['体重控制'],box=>box.x>0.5);
  const score=anchor(doc,['InBody评分','InBody得分'],box=>box.x>0.5);
  const history=anchor(doc,['人体成分测试历史记录','人体成分测试历史'],box=>box.x<.5&&box.y>.6,true);
  return {composition,muscle,obesity,segment,control,score,history};
}
export function locateLayout(doc) {
  const {composition,muscle,obesity,segment,control,score}=locateAnchors(doc);
  const right=score??control;
  if(!composition||!muscle||!obesity||!segment||!right||!(composition.y<muscle.y&&muscle.y<obesity.y&&obesity.y<segment.y))return null;
  const divider=right.x-0.012;
  if(divider<composition.x+0.3)return null;
  return {composition,muscle,obesity,segment,control,score,divider};
}
export function headerRegions(doc) {
  const anchors=locateAnchors(doc),result=[];
  for(const [key,label] of [['composition','人体成分分析'],['muscle','肌肉脂肪分析'],['obesity','肥胖分析'],['segment','肌肉均衡']]) {
    if(anchors[key]&&!anchors[key].approximate)continue;
    const candidates=doc.lines.filter(line=>line.x<.3&&line.y>.06&&line.y<.8&&line.height>.008&&!/\d/.test(line.text)&&
      (!anchors.composition||Math.abs(line.x-anchors.composition.x)<.13)&&Math.abs(compact(line.text).length-label.length)<=1)
      .map(line=>({line,distance:editDistance(compact(line.text),label)})).filter(item=>item.distance<=Math.ceil(label.length/2))
      .sort((a,b)=>a.distance-b.distance||a.line.y-b.line.y);
    if(candidates[0])result.push(candidates[0].line);
  }
  return result;
}
export function numberTokens(doc) {
  const tokens=[];
  const unitWords=doc.lines.flatMap(line=>line.words).filter(word=>word.confidence>=50).map(word=>({
    ...word,unit:({kg:'kg',l:'L','%':'%',cm:'cm',kcal:'kcal','kg/m²':'kg/m²','kg/m2':'kg/m²',khz:'kHz'})[compact(word.text).toLowerCase().replace(/[()]/g,'')]
  })).filter(word=>word.unit);
  for(const line of doc.lines) {
    let preceding='';
    const words=[];
    for(let index=0;index<line.words.length;index++) {
      const word=line.words[index],next=line.words[index+1];
      if(next&&/^\d{1,3}\.$/.test(compact(word.text))&&/^\d{1,2}$/.test(compact(next.text))&&word.numberSource===next.numberSource&&
        next.x-word.x-word.width>=-.002&&next.x-word.x-word.width<Math.max(word.width/compact(word.text).length,next.width/compact(next.text).length)*.8&&
        Math.abs(midY(word)-midY(next))<Math.max(word.height,next.height)*.6) {
        const y=Math.min(word.y,next.y);
        words.push({...word,text:compact(word.text)+compact(next.text),width:next.x+next.width-word.x,y,
          height:Math.max(word.y+word.height,next.y+next.height)-y,confidence:Math.min(word.confidence,next.confidence),symbols:[]});
        index++;
      } else words.push(word);
    }
    for(const word of words) {
      const normalized=compact(word.text);
      const withoutUnits=normalized.replace(/\((?:kg\/m[²2]|kcal|khz|kg|cm|l)\)|(?<=\d)(?:kg\/m[²2]|kcal|khz|kg|cm|l)(?![a-z])/gi,'');
      if(word.numberSource===false||/[a-z]/i.test(withoutUnits)) {preceding+=normalized;continue;}
      for(const match of normalized.matchAll(/(?<![\d.])[+-]?\d+(?:\.\d+)?(?![\d.])/g)) {
        const prefix=preceding+normalized.slice(0,match.index);
        const lastOpen=prefix.lastIndexOf('('),lastClose=prefix.lastIndexOf(')');
        const value=Number(match[0]);
        const suffix=normalized.slice(match.index+match[0].length);
        const unitText=suffix||prefix.slice(-10);
        let unit=/kg\/m|kg\/㎡/i.test(unitText)?'kg/m²':/\bkg\b|kg\)/i.test(unitText)?'kg':
          /kcal/i.test(unitText)?'kcal':/khz/i.test(unitText)?'kHz':/%/.test(unitText)?'%':/\(l\)|^l\b/i.test(unitText)?'L':/cm/i.test(unitText)?'cm':null;
        let box={x:word.x+word.width*match.index/normalized.length,y:word.y,
          width:word.width*match[0].length/normalized.length,height:word.height},confidence=word.confidence;
        if(word.symbols?.map(symbol=>compact(symbol.text)).join('')===normalized) {
          let position=0;
          const selected=word.symbols.filter(symbol=>{
            const start=position;position+=compact(symbol.text).length;
            return position>match.index&&start<match.index+match[0].length;
          });
          const x=Math.min(...selected.map(s=>s.x)),y=Math.min(...selected.map(s=>s.y));
          box={x,y,width:Math.max(...selected.map(s=>s.x+s.width))-x,height:Math.max(...selected.map(s=>s.y+s.height))-y};
        }
        if(!unit) {
          const nearby=unitWords.filter(word=>Math.abs(midY(word)-midY(box))<Math.max(word.height,box.height)*.8&&
            Math.max(word.x-box.x-box.width,box.x-word.x-word.width)>=-.01&&
            Math.max(word.x-box.x-box.width,box.x-word.x-word.width)<.065);
          const units=[...new Set(nearby.map(word=>word.unit))];if(units.length===1)unit=units[0];
        }
        tokens.push({text:match[0],value,confidence,...box,reference:lastOpen>lastClose,unit});
      }
      preceding+=normalized;
    }
  }
  const unique=[];
  for(const token of tokens) {
    const index=unique.findIndex(other=>other.value===token.value&&other.reference===token.reference&&
      Math.abs(midX(other)-midX(token))<Math.max(other.width,token.width)*0.3&&
      Math.abs(midY(other)-midY(token))<Math.max(other.height,token.height)*0.4);
    if(index<0)unique.push(token);else if(token.confidence>unique[index].confidence)unique[index]=token;
  }
  return unique;
}
export function parseReport(doc,sourceID) {
  const metrics={},issues=[],layout=locateLayout(doc),history=[];
  let measuredAt=null;
  const add=(key,token) => {
    const def=definition(key);
    if(!def||!Number.isFinite(token.value)||token.value<def.min||token.value>def.max) {
      issues.push(`${def?.name??key}数值范围异常`);return;
    }
    if(metrics[key]&&Math.abs(metrics[key].value-token.value)>0.051) {issues.push(`${def.name}在不同区域矛盾`);return;}
    metrics[key]={value:token.value,confidence:token.confidence};
  };
  if(!layout)return {accepted:false,measuredAt,metrics,history,issues:['分析分区/多列布局未可靠识别，请重拍完整清晰报告']};
  const {composition,muscle,obesity,segment,divider,control,score}=layout;
  const numbers=numberTokens(doc).filter(n=>!n.reference&&n.confidence>=70);
  const contains=(left,right,top,bottom)=>box=>midX(box)>=left&&midX(box)<right&&midY(box)>=top&&midY(box)<bottom;
  const header=labelLines(doc).filter(line=>line.y<composition.y&&line.words.some(w=>w.confidence>=70));
  const dateCandidates=[];
  for(const line of header) {
    let text='',spans=[];
    for(const word of line.words){const start=text.length;text+=`${word.text} `;spans.push({start,end:text.length-1,word});}
    for(const match of text.matchAll(/(?<!\d)\d{4}[./-]\d{2}[./-]\d{2}(?:\s+|[.,，]\s*)\d{2}:\d{2}(?!\d)/g)) {
      if(spans.filter(span=>span.end>match.index&&span.start<match.index+match[0].length).some(span=>span.word.confidence<70))continue;
      const date=parseDate(match[0]);if(date!==null)dateCandidates.push(date);
    }
  }
  const dates=[...new Set(dateCandidates)];
  if(dates.length===1)measuredAt=dates[0];else issues.push('日期时间缺失、低置信度或不唯一');
  const rowValue=(labels,region,unit) => {
    const label=anchor(doc,labels,region);
    if(!label)return null;
    const row=numbers.filter(n=>region(n)&&midX(n)>label.x+Math.min(label.width,0.06)&&
      Math.abs(midY(n)-midY(label))<Math.max(n.height,label.height)*0.8);
    const candidates=row.filter(n=>!unit||n.unit===unit);
    return candidates.length===1?candidates[0]:null;
  };
  const compositionRegion=contains(composition.x-0.02,divider,composition.y+composition.height,muscle.y);
  for(const [key,labels,unit] of [['water',['身体总水分','体内总水分'],'L'],['protein',['蛋白质'],'kg'],
    ['minerals',['无机盐'],'kg'],['fat',['体脂肪'],'kg'],['weight',['体重'],'kg']]) {
    const value=rowValue(labels,compositionRegion,unit);if(value)add(key,value);
  }
  const decimalRows=region=>{
    let values=numbers.filter(n=>region(n)&&n.text.includes('.'));
    const height=Math.max(0,...values.map(n=>n.height));
    values=values.filter(n=>n.height>=height*0.78).sort((a,b)=>midY(a)-midY(b));
    const rows=[];
    for(const n of values) {
      const row=rows.find(row=>Math.abs(midY(row[0])-midY(n))<Math.max(row[0].height,n.height)*0.65);
      if(row)row.push(n);else rows.push([n]);
    }
    return rows.every(r=>r.length===1)?rows.map(r=>r[0]):[];
  };
  const bars=decimalRows(contains(composition.x+0.04,divider,muscle.y+muscle.height,obesity.y));
  if(bars.length===3)for(const [index,key] of ['weight','muscle','fat'].entries())add(key,bars[index]);
  else issues.push('体重/骨骼肌/脂肪结果与刻度无法可靠区分');
  const obesityBars=decimalRows(contains(composition.x+0.04,divider,obesity.y+obesity.height,segment.y));
  if(obesityBars.length===2){add('bmi',obesityBars[0]);add('pbf',obesityBars[1]);}
  else issues.push('BMI/体脂率与小字刻度无法可靠区分');
  const rightRegion=contains(divider,1,score?.y??composition.y,1);
  if(score&&control) {
    const candidates=numbers.filter(n=>rightRegion(n)&&n.y>score.y&&midY(n)<control.y&&!n.text.includes('.')&&n.value<=150);
    const largest=candidates.sort((a,b)=>b.height-a.height)[0];
    if(largest&&candidates.filter(n=>n.height>largest.height*0.8).length===1)add('score',largest);
  }
  if(control) {
    const bottom=anchor(doc,['肥胖评估'],rightRegion)?.y??control.y+0.14;
    const region=contains(divider,1,control.y+control.height,bottom);
    for(const [key,label] of [['target','目标体重'],['weightControl','体重控制'],['fatControl','脂肪控制'],['muscleControl','肌肉控制']]) {
      const value=rowValue([label],region,'kg');if(value)add(key,value);
    }
  }
  for(const [key,labels,unit] of [['ffm',['去脂体重'],'kg'],['bmr',['基础代谢率'],'kcal'],
    ['obesity',['肥胖度'],'%'],['smi',['SMI'],'kg/m²'],['calories',['建议的热量摄入','建议热量摄入'],'kcal']]) {
    const value=rowValue(labels,rightRegion,unit);if(value)add(key,value);
  }
  const whr=anchor(doc,['腰臀比'],rightRegion),visceral=anchor(doc,['内脏脂肪等级'],rightRegion);
  if(whr&&visceral) {
    const values=numbers.filter(n=>rightRegion(n)&&n.y>whr.y+whr.height&&midY(n)<visceral.y&&n.value>=0.4&&n.value<=1.5);
    const maxHeight=Math.max(0,...values.map(n=>n.height));
    const large=values.filter(n=>n.height>maxHeight*0.8);
    if(large.length===1)add('whr',large[0]);
    const region=contains(divider,1,visceral.y+visceral.height,anchor(doc,['研究项目'],rightRegion)?.y??visceral.y+0.08);
    const value=rowValue(['等级'],region);if(value)add('visceral',value);
  }
  parseSegments(doc,numbers,layout,add,issues);
  parseImpedance(doc,numbers,rightRegion,add,issues);
  if(coreKeys.some(key=>!metrics[key]))issues.push('核心指标不完整');
  else issues.push(...consistencyIssues(metrics));
  const accepted=measuredAt!==null&&coreKeys.every(key=>metrics[key])&&!issues.some(issue=>/矛盾|不一致|核心指标|日期时间|刻度|范围异常/.test(issue));
  if(accepted)history.push(...parseHistory(doc,numbers,layout,measuredAt,sourceID));
  const missing=basic.filter(([key])=>!metrics[key]).map(([,name])=>name);
  return {accepted,measuredAt,metrics,history,issues:[...issues,...(missing.length?[`未可靠识别：${missing.join('、')}`]:[])],
    current:accepted?{id:crypto.randomUUID(),measuredAt,kind:'complete',metrics,sourceIDs:[sourceID]}:null};
}
function parseSegments(doc,numbers,layout,add,issues) {
  const {segment,divider}=layout,left=box=>midX(box)<divider&&box.y>segment.y;
  const fatTitle=anchor(doc,['节段脂肪分析','分段脂肪分析','部位脂肪分析'],left),history=anchor(doc,['人体成分测试历史'],left);
  if(!fatTitle||!history){issues.push('分段图边界不清晰，未识别');return;}
  for(const [kind,l,r] of [['lean',segment.x-0.02,fatTitle.x-0.01],['fat',fatTitle.x-0.01,divider]]) {
    const region=box=>midX(box)>l&&midX(box)<r&&box.y>Math.max(segment.y+segment.height,fatTitle.y+fatTitle.height)&&midY(box)<history.y;
    const masses=numbers.filter(n=>region(n)&&n.unit==='kg').sort((a,b)=>midY(a)-midY(b));
    const percents=numbers.filter(n=>region(n)&&n.unit==='%');
    const leftLabel=anchor(doc,['左'],region),rightLabel=anchor(doc,['右'],region);
    if(masses.length!==5||percents.length!==5||!leftLabel||!rightLabel||leftLabel.x>=rightLabel.x){issues.push('分段重量、比例或左右标记不可靠');continue;}
    const upper=masses.slice(0,2).sort((a,b)=>midX(a)-midX(b)),lower=masses.slice(3).sort((a,b)=>midX(a)-midX(b));
    const center=masses[2];
    if(Math.abs(midY(upper[0])-midY(upper[1]))>0.04||Math.abs(midY(lower[0])-midY(lower[1]))>0.04||
      midX(center)<=midX(upper[0])||midX(center)>=midX(upper[1])){issues.push('分段人体图布局不明确');continue;}
    for(const [index,mass] of [...upper,center,...lower].entries()) {
      const ratios=percents.filter(n=>Math.abs(midX(n)-midX(mass))<0.035&&midY(n)>midY(mass)&&midY(n)-midY(mass)<0.035);
      if(ratios.length===1){add(`${kind}.${limbs[index][0]}.kg`,mass);add(`${kind}.${limbs[index][0]}.percent`,ratios[0]);}
    }
  }
}
function parseImpedance(doc,numbers,rightRegion,add,issues) {
  const title=anchor(doc,['生物电阻抗'],rightRegion);
  if(!title){issues.push('阻抗表未识别');return;}
  const region=box=>rightRegion(box)&&box.y>title.y+title.height;
  const keys=['rightArm','leftArm','trunk','rightLeg','leftLeg'];
  const labels=['右上肢','左上肢','躯干','右下肢','左下肢'].map(label=>anchor(doc,[label],region));
  if(labels.some(label=>!label)||labels.some((label,i)=>i&&label.x<=labels[i-1].x)){issues.push('阻抗表头不完整，未猜测顺序');return;}
  for(const frequency of [20,100]) {
    const row=anchor(doc,[`${frequency}kHz`],region);if(!row)continue;
    const values=numbers.filter(n=>region(n)&&n.unit!=='kHz'&&midX(n)>row.x+0.03&&
      Math.abs(midY(n)-midY(row))<Math.max(n.height,row.height)*0.8).sort((a,b)=>a.x-b.x);
    if(values.length!==5)continue;
    for(const [index,value] of values.entries()) {
      const distances=labels.map(label=>Math.abs(midX(label)-midX(value)));
      if(distances[index]===Math.min(...distances))add(`z.${frequency}.${keys[index]}`,value);
    }
  }
}
function parseHistory(doc,numbers,layout,current,sourceID) {
  const title=anchor(doc,['人体成分测试历史']);if(!title)return [];
  const region=box=>box.y>title.y+title.height&&midX(box)<layout.divider;
  const result=[];
  for(const line of doc.lines.filter(region))for(const word of line.words) {
    if(word.confidence<70||!/(?:\d{4}|\d{2})[./-]\d{2}[./-]\d{2}/.test(word.text))continue;
    const times=doc.lines.flatMap(l=>l.words).filter(w=>region(w)&&w.confidence>=70&&/\d{2}:\d{2}/.test(w.text)&&
      Math.abs(midX(w)-midX(word))<0.025&&Math.abs(midY(w)-midY(word))<0.04);
    if(times.length!==1)continue;
    const date=parseDate(`${word.text} ${times[0].text}`,true);
    if(date===null||date>=current)continue;
    const values=numbers.filter(n=>region(n)&&n.y<word.y&&n.text.includes('.')&&Math.abs(midX(n)-midX(word))<0.025).sort((a,b)=>a.y-b.y);
    if(values.length!==3||values[1].value>=values[0].value)continue;
    const metrics={};let valid=true;
    for(const [index,key] of ['weight','muscle','pbf'].entries()) {
      const def=definition(key),n=values[index];if(n.value<def.min||n.value>def.max)valid=false;
      metrics[key]={value:n.value,confidence:n.confidence};
    }
    if(valid&&!result.some(point=>point.measuredAt===date))result.push({id:crypto.randomUUID(),measuredAt:date,kind:'history',metrics,sourceIDs:[sourceID]});
  }
  return result;
}
export function mergeMeasurements(existing,incoming) {
  for(const point of [...existing,...incoming])validateMeasurement(point);
  const result=structuredClone(existing);
  for(const item of incoming) {
    const previous=result.find(point=>point.measuredAt===item.measuredAt);
    if(!previous){result.push(structuredClone(item));continue;}
    const shared=Object.keys(previous.metrics).filter(key=>item.metrics[key]);
    if((previous.kind===item.kind||previous.kind!=='history'&&item.kind!=='history')&&shared.some(key=>Math.abs(previous.metrics[key].value-item.metrics[key].value)>0.051)) {
      throw new Error('同一测量时间存在矛盾的报告或历史摘要，未覆盖原记录');
    }
    previous.sourceIDs=[...new Set([...previous.sourceIDs,...item.sourceIDs])];
    if(item.kind==='complete'||previous.kind!=='complete'&&item.kind!=='history'||previous.kind==='history') {
      for(const [key,metric] of Object.entries(item.metrics))if(!previous.metrics[key]||metric.confidence>=previous.metrics[key].confidence)
        previous.metrics[key]=structuredClone(metric);
      if(item.kind==='complete')previous.kind='complete';
      else if(item.kind==='partial'&&previous.kind==='history')previous.kind='partial';
    }
  }
  return result.sort((a,b)=>a.measuredAt-b.measuredAt);
}
function consistencyIssues(metrics) {
  const issues=[],get=key=>metrics[key].value;
  if(['muscle','fat','weight'].every(key=>metrics[key])&&get('muscle')+get('fat')>=get('weight')||
    ['fat','weight','pbf'].every(key=>metrics[key])&&Math.abs(get('fat')/get('weight')*100-get('pbf'))>0.3)issues.push('脂肪重量与体脂率不一致');
  if(['water','protein','minerals','fat','weight'].every(key=>metrics[key])&&
    Math.abs(get('water')+get('protein')+get('minerals')+get('fat')-get('weight'))>0.5)issues.push('人体成分总和与体重不一致');
  if(metrics.ffm&&metrics.fat&&metrics.weight&&Math.abs(get('ffm')+get('fat')-get('weight'))>0.3)issues.push('去脂体重与体重不一致');
  return issues;
}
export function validateMeasurement(item) {
  if(!item||typeof item.id!=='string'||!Number.isInteger(item.measuredAt)||parseDate(printDate(item.measuredAt))!==item.measuredAt||
    !['complete','partial','history'].includes(item.kind)||!Array.isArray(item.sourceIDs)||!item.sourceIDs.length||
    item.sourceIDs.some(id=>typeof id!=='string'||!id.length||id.length>128)||new Set(item.sourceIDs).size!==item.sourceIDs.length||
    !item.metrics||typeof item.metrics!=='object'||Array.isArray(item.metrics))throw new Error('备份测量结构无效');
  for(const [key,metric] of Object.entries(item.metrics)) {
    const def=definition(key);
    if(!def||!metric||!Number.isFinite(metric.value)||metric.value<def.min||metric.value>def.max||
      !Number.isFinite(metric.confidence)||metric.confidence<0||metric.confidence>100)throw new Error('备份指标或单位范围无效');
  }
  if(item.kind==='complete'&&coreKeys.some(key=>!item.metrics[key]))throw new Error('备份完整记录缺少核心指标');
  if(item.kind==='complete'&&consistencyIssues(item.metrics).length)throw new Error('备份完整记录的人体成分矛盾');
  if(item.kind==='partial'&&(Object.keys(item.metrics).length<2||consistencyIssues(item.metrics).length||
    Object.values(item.metrics).some(metric=>metric.confidence<70||!['composition-cell','score-numerator'].includes(metric.evidence))))
    throw new Error('部分记录缺少独立复核来源或存在矛盾');
  if(item.kind==='history'&&(Object.keys(item.metrics).length!==3||['weight','muscle','pbf'].some(key=>!item.metrics[key])||
    item.metrics.muscle.value>=item.metrics.weight.value))throw new Error('备份历史摘要的指标不完整或矛盾');
}
