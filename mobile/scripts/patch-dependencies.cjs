// Two advisories have no upstream release. Apply narrow, reproducible fixes;
// reject unexpected dependency source rather than silently skipping a patch.
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const patches=require('./dependency-patches.json');
for(const patch of patches){
 const file=path.join(__dirname,'../node_modules',patch.file);
 const original=fs.readFileSync(file,'utf8');
 const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
 if(hash(original)===patch.patchedSHA256)continue;
 if(hash(original)!==patch.originalSHA256)throw new Error(`Review security patch for changed dependency ${patch.file}`);
 let result=original;
 for(const [before,after] of patch.replacements){
  if(!result.includes(before))throw new Error(`Patch anchor missing: ${patch.file}`);
  result=result.replace(before,after);
 }
 if(hash(result)!==patch.patchedSHA256)throw new Error(`Patch integrity failed: ${patch.file}`);
 fs.writeFileSync(file,result);
}
console.log('Mobile dependency security and CommonJS patches verified.');
