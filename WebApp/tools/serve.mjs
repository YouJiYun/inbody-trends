import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root=resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json','.webmanifest':'application/manifest+json','.wasm':'application/wasm','.png':'image/png',
  '.svg':'image/svg+xml','.gz':'application/octet-stream','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(request,response)=>{
  if(!['GET','HEAD'].includes(request.method)){response.writeHead(405);response.end();return;}
  let path;
  try {path=decodeURIComponent(new URL(request.url,'http://localhost').pathname);}catch {response.writeHead(400);response.end();return;}
  let file=resolve(root,`.${path}`);
  if(file!==root&&!file.startsWith(root+sep)){response.writeHead(403);response.end();return;}
  try {
    if((await stat(file)).isDirectory())file=resolve(file,'index.html');
    const content=await readFile(file);
    response.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream',
      'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    response.end(request.method==='HEAD'?undefined:content);
  } catch(error) {
    if(error.code==='ENOENT'||error.code==='EISDIR'){response.writeHead(404);response.end('Not found');}
    else {response.writeHead(500);response.end('Local static server error');}
  }
});
server.listen(Number(process.env.PORT??8787),'127.0.0.1',()=>console.log(`Local-only PWA: http://127.0.0.1:${server.address().port}`));
