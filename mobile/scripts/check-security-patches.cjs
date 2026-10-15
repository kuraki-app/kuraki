const assert=require('node:assert/strict');
const braces=require('braces');
for(const method of ['compile','expand','stringify']){
 assert.throws(()=>braces[method]('{'.repeat(4000)+'a,b'+'}'.repeat(4000)),/nesting exceeds/);
 let ast={type:'text',value:'x'};for(let i=0;i<100;i++)ast={type:'root',nodes:[ast]};
 assert.throws(()=>braces[method](ast),/nesting exceeds/);
}
assert.deepEqual(braces.expand('assets/{photo,video}/*.jpg'),['assets/photo/*.jpg','assets/video/*.jpg']);
const forge=require('node-forge');
const {privateKey,publicKey}=forge.pki.rsa.generateKeyPair({bits:1024,e:3});
const md=()=>forge.md.sha256.create().update('kuraki security regression');
assert.equal(publicKey.verify(md().digest().getBytes(),privateKey.sign(md())),true);
const a=forge.asn1;
const create=(type,constructed,value)=>a.create(a.Class.UNIVERSAL,type,constructed,value);
const digest=create(a.Type.SEQUENCE,true,[
 create(a.Type.SEQUENCE,true,[create(a.Type.OID,false,a.oidToDer(forge.oids.sha256).getBytes()),create(a.Type.NULL,false,''),create(a.Type.OCTETSTRING,false,'extra')]),
 create(a.Type.OCTETSTRING,false,md().digest().getBytes()),
]);
const malformed=privateKey.sign(a.toDer(digest).getBytes(),'NONE');
assert.throws(()=>publicKey.verify(md().digest().getBytes(),malformed),/DigestInfo/);
const query=require('query-string');
assert.equal(query.parse('city=%E6%9D%B1%E4%BA%AC').city,'東京');
assert.equal(query.parse('bad='+'%FF'.repeat(20000)).bad.length,60000);
console.log('Security regressions: bounded brace walkers, strict RSA DigestAlgorithm and safe CommonJS URI decoding pass.');
