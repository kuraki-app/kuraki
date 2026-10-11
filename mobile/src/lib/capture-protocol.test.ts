import { beforeEach, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({secrets:new Map<string,string>(), close:vi.fn(), read:vi.fn(async()=>new ArrayBuffer(4))}));
vi.mock('expo-secure-store',()=>({getItemAsync:async(k:string)=>h.secrets.get(k)??null,setItemAsync:async(k:string,v:string)=>{h.secrets.set(k,v)},deleteItemAsync:async(k:string)=>{h.secrets.delete(k)},AFTER_FIRST_UNLOCK:'after'}));
vi.mock('@/lib/media-source',()=>({openSource:async()=>({size:4,readChunk:h.read,close:h.close})}));
const settings={baseURL:'https://server.test',deviceToken:'A',serverID:'s',ownerID:'o'};
const proof={asset_id:'original',content_hash:'a'.repeat(64),size_bytes:4};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const hooks=()=>({load:vi.fn(async()=>null as null|{sessionId:string;sizeBytes:number;offsetBytes:number}),save:vi.fn(async()=>{}),clear:vi.fn(async()=>{})});
beforeEach(async()=>{vi.resetModules();h.secrets.clear();h.read.mockClear();h.close.mockClear();await (await import('./settings')).saveCaptureSettings(settings)});
it.each([null,'0'])('rejects a missing or nonadvancing conflict receipt (%s) without looping',async offset=>{
 const fetcher=vi.fn().mockResolvedValueOnce(json({id:'session',received_bytes:0})).mockResolvedValue(new Response('{}',{status:409,headers:offset?{'Upload-Offset':offset}:{}}));vi.stubGlobal('fetch',fetcher);
 const {uploadFile}=await import('./capture-api');await expect(uploadFile(settings,{uri:'file:///x',filename:'x.jpg'})).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(2);expect(h.close).toHaveBeenCalledOnce();
});
it('resolves a completed-byte receipt without creating or retransmitting an upload',async()=>{
 const resume=hooks();resume.load.mockResolvedValue({sessionId:'old',sizeBytes:4,offsetBytes:4});const fetcher=vi.fn().mockResolvedValue(json({status:'completed',proof}));vi.stubGlobal('fetch',fetcher);
 const {uploadFile}=await import('./capture-api');const done=await uploadFile(settings,{uri:'file:///x',filename:'x.jpg'},undefined,undefined,resume,{requireReceipt:true});expect(done.proof).toEqual(proof);expect(fetcher).toHaveBeenCalledOnce();expect(h.read).not.toHaveBeenCalled();expect(resume.clear).toHaveBeenCalledOnce();
});
it.each([404,410])('restarts a terminal resumed session once (%s), persists zero and then confirms bytes',async status=>{
 const resume=hooks();resume.load.mockResolvedValueOnce({sessionId:'old',sizeBytes:4,offsetBytes:4}).mockResolvedValue(null);
 const fetcher=vi.fn().mockResolvedValueOnce(json({error:'original_unavailable'},status)).mockResolvedValueOnce(json({id:'new',received_bytes:0})).mockResolvedValueOnce(new Response(null,{status:204,headers:{'Upload-Offset':'4'}})).mockResolvedValueOnce(json({id:'new',status:'queued'})).mockResolvedValueOnce(json({status:'completed',proof}));vi.stubGlobal('fetch',fetcher);
 const {uploadFile}=await import('./capture-api');const done=await uploadFile(settings,{uri:'file:///x',filename:'x.jpg'},undefined,undefined,resume,{requireReceipt:true});expect(done.proof).toEqual(proof);expect(resume.save.mock.calls[0]).toEqual([{sessionId:'new',sizeBytes:4,offsetBytes:0}]);expect(fetcher).toHaveBeenCalledTimes(5);
});
it('does not start HTTP work after canceled source resolution',async()=>{
 const controller=new AbortController();controller.abort();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const {uploadFile}=await import('./capture-api');await expect(uploadFile(settings,{uri:'file:///x',filename:'x.jpg'},undefined,controller.signal)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
});
