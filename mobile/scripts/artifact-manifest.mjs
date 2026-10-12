import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, lstatSync, readlinkSync, writeFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
const [artifact,output,platform,profile]=process.argv.slice(2);
if(!artifact||!output||!['android','ios'].includes(platform)||!profile)throw new Error('Usage: artifact-manifest.mjs ARTIFACT OUTPUT android|ios PROFILE');
const root=resolve('..');
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dirty=!!execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim();
const hash=createHash('sha256');
const isDirectory=lstatSync(resolve(artifact)).isDirectory();
function walk(file){
 const stat=lstatSync(file);
 if(stat.isDirectory())for(const entry of readdirSync(file).sort())walk(join(file,entry));
 else if(isDirectory){
  const content=stat.isSymbolicLink()?Buffer.from(readlinkSync(file)):readFileSync(file);
  hash.update(JSON.stringify([relative(resolve(artifact),file),stat.mode&0o777,stat.isSymbolicLink(),content.length])+'\n');hash.update(content);
 }else hash.update(readFileSync(file));
}
walk(resolve(artifact));
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const lock=readFileSync('package-lock.json');
writeFileSync(output,JSON.stringify({commit:sha,dirty,platform,profile,artifact:artifact.split('/').pop(),sha256:hash.digest('hex'),hashFormat:isDirectory?'directory-path-mode-content-v1':'file-sha256',lockSHA256:createHash('sha256').update(lock).digest('hex'),builtAt:new Date().toISOString(),version:pkg.version,expo:pkg.dependencies.expo,reactNative:pkg.dependencies['react-native'],worklets:pkg.dependencies['react-native-worklets'],distribution:'QA only; store signing and physical-device certification required'},null,2)+'\n');
