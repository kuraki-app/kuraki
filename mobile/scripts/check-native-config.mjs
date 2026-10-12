import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const platform=process.argv[2];
if(platform==='android'){
 const manifest=readFileSync('android/app/src/main/AndroidManifest.xml','utf8');
 const permissions=[...manifest.matchAll(/<uses-permission\b[^>]*>/g)].map(match=>match[0]);
 assert(permissions.some(permission=>permission.includes('android.permission.CAMERA')&&!permission.includes('tools:node="remove"')),'QR camera permission must remain available');
 for(const name of ['RECORD_AUDIO','READ_MEDIA_AUDIO'])assert(!permissions.some(permission=>permission.includes(`android.permission.${name}`)&&!permission.includes('tools:node="remove"')),`Unused ${name} permission must not be requested`);
}else if(platform==='ios'){
 const plist=JSON.parse(execFileSync('plutil',['-convert','json','-o','-','ios/Kuraki/Info.plist'],{encoding:'utf8'}));
 assert(typeof plist.NSCameraUsageDescription==='string'&&plist.NSCameraUsageDescription.includes('QR'),'QR camera description is required');
 assert(typeof plist.NSPhotoLibraryUsageDescription==='string'&&plist.NSPhotoLibraryUsageDescription.includes('photos'),'Photo access must explain backup use');
 assert(!plist.NSMicrophoneUsageDescription,'Unused microphone permission must not be requested');
 assert.equal(plist.NSAppTransportSecurity.NSAllowsArbitraryLoads,false);
}else throw new Error('Provide android or ios');
console.log(`${platform} native permission contract verified.`);
