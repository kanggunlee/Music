import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window={addEventListener(){}};
const {isInstalled,isAppleMobile}=await import('../dist/install.js');
test('standalone installation detection recognizes iOS and display mode',()=>{
 assert.equal(isInstalled({matchMedia:()=>({matches:true}),navigator:{}}),true);
 assert.equal(isInstalled({matchMedia:()=>({matches:false}),navigator:{standalone:true}}),true);
 assert.equal(isInstalled({matchMedia:()=>({matches:false}),navigator:{}}),false);
});
test('iOS installation guidance covers iPhone and desktop-mode iPad',()=>{
 assert.equal(isAppleMobile({userAgent:'iPhone',platform:'iPhone',maxTouchPoints:5}),true);
 assert.equal(isAppleMobile({userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5}),true);
 assert.equal(isAppleMobile({userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:0}),false);
});
