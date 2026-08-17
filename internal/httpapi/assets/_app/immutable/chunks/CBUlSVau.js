import{a as m,g as C,c as N}from"./CDcvpCic.js";import{aq as z,p as A,a as I,g as s,c as L,f as P,e as j,y as q,r as B,a0 as f,ar as D}from"./DfptlsUT.js";import{a as g,e as E,s as F,d as G}from"./CWUNwnW1.js";import{e as H}from"./BANdi2eS.js";import{p as o,r as J}from"./CO2TWCLC.js";/**
 * @file
 * @license @lucide/svelte v1.24.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const K={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};/**
 * @file
 * @license @lucide/svelte v1.24.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const M=a=>{for(const e in a)if(e.startsWith("aria-")||e==="role"||e==="title")return!0;return!1};/**
 * @file
 * @license @lucide/svelte v1.24.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const O=Symbol("lucide-context"),Q=()=>z(O);var R=new Set(["$$slots","$$events","$$legacy","name","color","size","strokeWidth","absoluteStrokeWidth","iconNode","children"]),T=C("<svg><!><!></svg>");function ee(a,e){A(e,!0);const t=Q()??{},v=o(e,"color",19,()=>t.color??"currentColor"),i=o(e,"size",19,()=>t.size??24),c=o(e,"strokeWidth",19,()=>t.strokeWidth??2),k=o(e,"absoluteStrokeWidth",19,()=>t.absoluteStrokeWidth??!1),b=o(e,"iconNode",19,()=>[]),l=J(e,R),w=f(()=>k()?Number(c())*24/Number(i()):c());var r=T();g(r,n=>({...K,...n,...l,width:i(),height:i(),stroke:v(),"stroke-width":s(w),class:["lucide-icon lucide",t.class,e.name&&`lucide-${e.name}`,e.class]}),[()=>!e.children&&!M(l)&&{"aria-hidden":"true"}]);var d=L(r);E(d,17,b,G,(n,x)=>{var u=f(()=>D(s(x),2));let _=()=>s(u)[0],S=()=>s(u)[1];var h=N(),p=P(h);H(p,_,!0,(y,U)=>{g(y,()=>({...S()}))}),m(n,h)});var W=j(d);F(W,()=>e.children??q),B(r),m(a,r),I()}export{ee as I};
