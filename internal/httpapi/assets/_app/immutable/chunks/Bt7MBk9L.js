import{a as m,d as C,c as N}from"./BPvQnNUS.js";import{a2 as z,p as A,a as I,g as s,c as L,f as P,e as j,v as B,r as Y,Y as f,a3 as q}from"./mGOlDe_G.js";import{a as g,e as D,s as E,g as F,f as G}from"./tuU8E55e.js";import{p as o,r as H}from"./BdTmAp5M.js";/**
 * @file
 * @license @lucide/svelte v1.24.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const J={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};/**
 * @file
 * @license @lucide/svelte v1.24.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const K=a=>{for(const e in a)if(e.startsWith("aria-")||e==="role"||e==="title")return!0;return!1};/**
 * @file
 * @license @lucide/svelte v1.24.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const M=Symbol("lucide-context"),O=()=>z(M);var Q=new Set(["$$slots","$$events","$$legacy","name","color","size","strokeWidth","absoluteStrokeWidth","iconNode","children"]),R=C("<svg><!><!></svg>");function $(a,e){A(e,!0);const t=O()??{},v=o(e,"color",19,()=>t.color??"currentColor"),i=o(e,"size",19,()=>t.size??24),c=o(e,"strokeWidth",19,()=>t.strokeWidth??2),k=o(e,"absoluteStrokeWidth",19,()=>t.absoluteStrokeWidth??!1),b=o(e,"iconNode",19,()=>[]),l=H(e,Q),w=f(()=>k()?Number(c())*24/Number(i()):c());var r=R();g(r,n=>({...J,...n,...l,width:i(),height:i(),stroke:v(),"stroke-width":s(w),class:["lucide-icon lucide",t.class,e.name&&`lucide-${e.name}`,e.class]}),[()=>!e.children&&!K(l)&&{"aria-hidden":"true"}]);var d=L(r);D(d,17,b,G,(n,x)=>{var u=f(()=>q(s(x),2));let _=()=>s(u)[0],S=()=>s(u)[1];var h=N(),p=P(h);F(p,_,!0,(y,T)=>{g(y,()=>({...S()}))}),m(n,h)});var W=j(d);E(W,()=>e.children??B),Y(r),m(a,r),I()}export{$ as I};
