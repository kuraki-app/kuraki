const {spawnSync}=require('node:child_process');
// Upstream has no release for these exact advisories. Reviewed local patches
// are source-hash checked and exercised before accepting these two IDs.
require('./patch-dependencies.cjs');
require('./check-security-patches.cjs');
const result=spawnSync('npm',['audit','--json'],{encoding:'utf8',cwd:require('node:path').join(__dirname,'..')});
let report;
try{report=JSON.parse(result.stdout);}catch{throw new Error('Dependency advisory service did not return valid audit evidence.');}
if(report.error)throw new Error(`Dependency audit failed: ${JSON.stringify(report.error)}`);
const mitigated=new Set(['GHSA-vfj7-8cjw-p6xm','GHSA-86w9-cpqp-85rv']);
const findings=new Map();
for(const vulnerability of Object.values(report.vulnerabilities||{}))for(const advisory of vulnerability.via)if(typeof advisory!=='string'){
 const id=advisory.url?.split('/').pop();if(!mitigated.has(id))findings.set(id,`${advisory.name}: ${advisory.title} (${advisory.severity})`);
}
if(findings.size){for(const finding of findings.values())console.error(finding);process.exit(1);}
console.log('No unmitigated mobile advisories. Two upstream advisories remain explicitly covered by verified local patches.');
