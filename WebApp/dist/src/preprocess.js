function quadArea(points) {
  return Math.abs(points.reduce((sum,p,i)=>sum+p.x*points[(i+1)%4].y-p.y*points[(i+1)%4].x,0))/2;
}
function paperCorners(canvas) {
  const scale=Math.min(1,550/Math.max(canvas.width,canvas.height));
  const small=document.createElement('canvas');small.width=Math.round(canvas.width*scale);small.height=Math.round(canvas.height*scale);
  const context=small.getContext('2d',{willReadFrequently:true});context.drawImage(canvas,0,0,small.width,small.height);
  const {data}=context.getImageData(0,0,small.width,small.height),w=small.width,h=small.height;
  const mask=new Uint8Array(w*h),seen=new Uint8Array(w*h),queue=new Int32Array(w*h);
  for(let i=0;i<mask.length;i++) {
    const [r,g,b]=data.subarray(i*4,i*4+3),luma=.299*r+.587*g+.114*b;
    mask[i]=luma>185&&Math.max(r,g,b)-Math.min(r,g,b)<75?1:0;
  }
  let largest=null;
  for(let start=0;start<mask.length;start++) {
    if(!mask[start]||seen[start])continue;
    let read=0,count=1;queue[0]=start;seen[start]=1;
    const extremes=[{x:w,y:h},{x:0,y:h},{x:0,y:0},{x:w,y:0}];
    let minSum=Infinity,maxDifference=-Infinity,maxSum=-Infinity,minDifference=Infinity;
    while(read<count) {
      const index=queue[read++],x=index%w,y=Math.floor(index/w);
      if(x+y<minSum){minSum=x+y;extremes[0]={x,y};}
      if(x-y>maxDifference){maxDifference=x-y;extremes[1]={x,y};}
      if(x+y>maxSum){maxSum=x+y;extremes[2]={x,y};}
      if(x-y<minDifference){minDifference=x-y;extremes[3]={x,y};}
      for(const next of [x?index-1:-1,x<w-1?index+1:-1,y?index-w:-1,y<h-1?index+w:-1]) {
        if(next>=0&&mask[next]&&!seen[next]){seen[next]=1;queue[count++]=next;}
      }
    }
    if(!largest||count>largest.count)largest={count,points:extremes};
  }
  if(!largest||largest.count<w*h*.22)return null;
  const points=largest.points,area=quadArea(points);
  if(area<w*h*.25||largest.count/area<.6)return null;
  const width=(Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)+Math.hypot(points[2].x-points[3].x,points[2].y-points[3].y))/2;
  const height=(Math.hypot(points[3].x-points[0].x,points[3].y-points[0].y)+Math.hypot(points[2].x-points[1].x,points[2].y-points[1].y))/2;
  if(width/height<.42||width/height>1.1||width<w*.35||height<h*.4)return null;
  if(points.every(p=>(p.x<3||p.x>w-4)&&(p.y<3||p.y>h-4)))return null;
  const center={x:points.reduce((n,p)=>n+p.x,0)/4,y:points.reduce((n,p)=>n+p.y,0)/4};
  return points.map(p=>({x:Math.max(0,Math.min(canvas.width-1,(center.x+(p.x-center.x)*1.025)/scale)),
    y:Math.max(0,Math.min(canvas.height-1,(center.y+(p.y-center.y)*1.025)/scale))}));
}
function homography(points) {
  const destinations=[[0,0],[1,0],[1,1],[0,1]],matrix=[];
  for(let i=0;i<4;i++) {
    const [u,v]=destinations[i],{x,y}=points[i];
    matrix.push([u,v,1,0,0,0,-u*x,-v*x,x],[0,0,0,u,v,1,-u*y,-v*y,y]);
  }
  for(let column=0;column<8;column++) {
    let pivot=column;
    for(let row=column+1;row<8;row++)if(Math.abs(matrix[row][column])>Math.abs(matrix[pivot][column]))pivot=row;
    [matrix[column],matrix[pivot]]=[matrix[pivot],matrix[column]];
    const divisor=matrix[column][column];if(Math.abs(divisor)<1e-10)return null;
    for(let j=column;j<=8;j++)matrix[column][j]/=divisor;
    for(let row=0;row<8;row++)if(row!==column) {
      const factor=matrix[row][column];
      for(let j=column;j<=8;j++)matrix[row][j]-=factor*matrix[column][j];
    }
  }
  return matrix.map(row=>row[8]);
}
async function warp(canvas,points) {
  const h=homography(points);if(!h)return canvas;
  const width=(Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)+Math.hypot(points[2].x-points[3].x,points[2].y-points[3].y))/2;
  const height=(Math.hypot(points[3].x-points[0].x,points[3].y-points[0].y)+Math.hypot(points[2].x-points[1].x,points[2].y-points[1].y))/2;
  const output=document.createElement('canvas');output.height=2600;output.width=Math.round(2600*width/height);
  const original=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,canvas.width,canvas.height);
  const context=output.getContext('2d',{willReadFrequently:true}),image=context.createImageData(output.width,output.height);
  for(let y=0;y<output.height;y++) {
    const v=y/(output.height-1);
    for(let x=0;x<output.width;x++) {
      const u=x/(output.width-1),denominator=h[6]*u+h[7]*v+1;
      const sx=(h[0]*u+h[1]*v+h[2])/denominator,sy=(h[3]*u+h[4]*v+h[5])/denominator;
      const x0=Math.floor(sx),y0=Math.floor(sy),target=(y*output.width+x)*4;
      if(x0<0||y0<0||x0>=canvas.width-1||y0>=canvas.height-1){image.data.fill(255,target,target+4);continue;}
      const fx=sx-x0,fy=sy-y0;
      for(let channel=0;channel<3;channel++) {
        const a=(y0*canvas.width+x0)*4+channel,b=a+4,c=a+canvas.width*4,d=c+4;
        image.data[target+channel]=(1-fy)*((1-fx)*original.data[a]+fx*original.data[b])+fy*((1-fx)*original.data[c]+fx*original.data[d]);
      }
      image.data[target+3]=255;
    }
    if(y%160===0)await new Promise(requestAnimationFrame);
  }
  context.putImageData(image,0,0);return output;
}
function normalizeLighting(canvas) {
  const context=canvas.getContext('2d',{willReadFrequently:true}),image=context.getImageData(0,0,canvas.width,canvas.height);
  const w=canvas.width,h=canvas.height,gray=new Uint8Array(w*h),integral=new Uint32Array((w+1)*(h+1));
  for(let y=0;y<h;y++) {
    let sum=0;
    for(let x=0;x<w;x++) {
      const pixel=y*w+x,offset=pixel*4;gray[pixel]=.299*image.data[offset]+.587*image.data[offset+1]+.114*image.data[offset+2];
      sum+=gray[pixel];integral[(y+1)*(w+1)+x+1]=integral[y*(w+1)+x+1]+sum;
    }
  }
  const radius=24;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const l=Math.max(0,x-radius),r=Math.min(w,x+radius+1),t=Math.max(0,y-radius),b=Math.min(h,y+radius+1);
    const mean=(integral[b*(w+1)+r]-integral[t*(w+1)+r]-integral[b*(w+1)+l]+integral[t*(w+1)+l])/((r-l)*(b-t));
    const value=Math.min(255,gray[y*w+x]*255/Math.max(mean,110)),offset=(y*w+x)*4;
    image.data[offset]=image.data[offset+1]=image.data[offset+2]=value;
  }
  context.putImageData(image,0,0);
}
export async function prepareDocument(canvas) {
  const corners=paperCorners(canvas),output=corners?await warp(canvas,corners):canvas;
  normalizeLighting(output);
  return {canvas:output,corrected:!!corners,sourceWidth:canvas.width,sourceHeight:canvas.height,
    width:output.width,height:output.height};
}
