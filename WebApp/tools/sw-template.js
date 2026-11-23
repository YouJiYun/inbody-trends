const PREFIX=`inbody-shell-${encodeURIComponent(self.registration.scope)}-`;
const CACHE=`${PREFIX}__VERSION__`;
let allowed;
async function manifest(cache) {
  const response=await cache.match(new URL('asset-manifest.json',self.registration.scope));
  if(!response)throw new Error('Offline asset manifest missing');
  return response.json();
}
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const base=self.registration.scope;
    const response=await fetch(new URL('asset-manifest.json',base),{cache:'no-store'});
    if(!response.ok)throw new Error('Cannot download asset manifest');
    const info=await response.clone().json(),cache=await caches.open(CACHE);
    for(const asset of info.assets) {
      const url=new URL(asset.path,base);
      if(url.origin!==self.location.origin||!url.href.startsWith(base))throw new Error('Invalid offline asset');
      const file=await fetch(url,{cache:'no-store'});
      if(!file.ok)throw new Error('Offline asset download failed');
      const data=await file.clone().arrayBuffer();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(b=>b.toString(16).padStart(2,'0')).join('');
      if(data.byteLength!==asset.bytes||hash!==asset.sha256)throw new Error('Offline asset integrity mismatch');
      await cache.put(url,file);
    }
    await cache.put(new URL('asset-manifest.json',base),response);
  })());
});
self.addEventListener('message',event=>{if(event.data==='ACTIVATE')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==CACHE)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||url.search)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(!allowed)allowed=new Set((await manifest(cache)).assets.map(asset=>new URL(asset.path,self.registration.scope).href));
    if(allowed.has(url.href))return await cache.match(url)??fetch(event.request);
    if(event.request.mode==='navigate'&&url.href.startsWith(self.registration.scope))return await cache.match(new URL('index.html',self.registration.scope))??fetch(event.request);
    return fetch(event.request);
  })());
});
