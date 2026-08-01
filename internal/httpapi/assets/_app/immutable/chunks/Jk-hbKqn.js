import{g as T,i as B,j as v,a as W,k as L,c as M}from"./DWp1jGEc.js";import{h as s,c as E,g as w,aq as j,b as F,E as I,W as O,P as R,a6 as q,e as N,d as m,n as D,$ as G,X as V,ar as X,p as Z,a as H,A as _,y as J,f as K,z as Q,Z as U,B as Y,O as S,as as $}from"./CLW2Up5e.js";import{a as C,e as ee,g as te,f as ae}from"./CGAxi3Ov.js";import{B as se,p as d,r as re}from"./B3uFsK-5.js";function oe(n,e,o,c,u,k){let b=s;s&&E();var t=null;s&&w.nodeType===j&&(t=w,E());var i=s?w:n,h=new se(i,!1);F(()=>{const a=e()||null;var f=V;if(a===null){h.ensure(null,null),v(!0);return}return h.ensure(a,g=>{if(a){if(t=s?t:O(a,f),T(t,t),c){var r=null;s&&B(a)&&t.append(r=document.createComment(""));var l=s?R(t):t.appendChild(q());s&&(l===null?N(!1):m(l)),c(t,l),r==null||r.remove()}D.nodes.end=t,g.before(t)}s&&m(g)}),v(!0),()=>{a&&v(!1)}},I),G(()=>{v(!0)}),b&&(N(!0),m(i))}/**
 * @file
 * @license @lucide/svelte v1.24.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ne={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};/**
 * @file
 * @license @lucide/svelte v1.24.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ie=n=>{for(const e in n)if(e.startsWith("aria-")||e==="role"||e==="title")return!0;return!1};/**
 * @file
 * @license @lucide/svelte v1.24.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const le=Symbol("lucide-context"),de=()=>X(le);var ce=new Set(["$$slots","$$events","$$legacy","name","color","size","strokeWidth","absoluteStrokeWidth","iconNode","children"]),ue=L("<svg><!><!></svg>");function ke(n,e){Z(e,!0);const o=de()??{},c=d(e,"color",19,()=>o.color??"currentColor"),u=d(e,"size",19,()=>o.size??24),k=d(e,"strokeWidth",19,()=>o.strokeWidth??2),b=d(e,"absoluteStrokeWidth",19,()=>o.absoluteStrokeWidth??!1),t=d(e,"iconNode",19,()=>[]),i=re(e,ce),h=S(()=>b()?Number(k())*24/Number(u()):k());var a=ue();C(a,r=>({...ne,...r,...i,width:u(),height:u(),stroke:c(),"stroke-width":_(h),class:["lucide-icon lucide",o.class,e.name&&`lucide-${e.name}`,e.class]}),[()=>!e.children&&!ie(i)&&{"aria-hidden":"true"}]);var f=J(a);ee(f,17,t,ae,(r,l)=>{var x=S(()=>$(_(l),2));let A=()=>_(x)[0],p=()=>_(x)[1];var y=M(),z=K(y);oe(z,A,!0,(P,he)=>{C(P,()=>({...p()}))}),W(r,y)});var g=Q(f);te(g,()=>e.children??U),Y(a),W(n,a),H()}export{ke as I};
