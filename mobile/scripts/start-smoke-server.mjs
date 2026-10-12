// Creates an empty, disposable server and short-lived pairing code for native CI.
import { spawn } from 'node:child_process';
import { mkdtempSync, openSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const port=39218;
const dir=mkdtempSync(join(tmpdir(),'kuraki-native-smoke-'));
const log=openSync(join(dir,'server.log'),'a');
const child=spawn(resolve('../bin/kuraki'),['serve'],{
 cwd:dir,env:{...process.env,KURAKI_DATA_DIR:join(dir,'data'),KURAKI_ADDR:`127.0.0.1:${port}`},stdio:['ignore',log,log],detached:true,
});
child.unref();
const origin=`http://127.0.0.1:${port}`;
for(let attempt=0;attempt<60;attempt++){
 try{if((await fetch(origin+'/healthz',{signal:AbortSignal.timeout(1000)})).ok)break;}catch{}
 if(attempt===59)throw new Error(`Smoke server did not become healthy; ${dir}/server.log`);
 await new Promise(resolve=>setTimeout(resolve,500));
}
const setup=await fetch(origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'native-smoke',password:'native-smoke-test-password'})});
if(!setup.ok)throw new Error(`Setup failed: ${setup.status}`);
const {user}=await setup.json();
const cookie=setup.headers.get('set-cookie').split(';')[0];
const pair=await fetch(origin+'/api/devices/pair',{method:'POST',headers:{Cookie:cookie,'X-Kuraki-Owner-ID':user.id}});
if(!pair.ok)throw new Error(`Pairing failed: ${pair.status}`);
const {code}=await pair.json();
const file=process.argv[2];if(!file)throw new Error('Provide an output env-file path.');
writeFileSync(file,`export PAIR_CODE='${code}'\nexport SMOKE_SERVER_PID='${child.pid}'\nexport SMOKE_SERVER_DIR='${dir}'\n`);
console.log(`Disposable smoke server ready; connection info in ${file}`);
