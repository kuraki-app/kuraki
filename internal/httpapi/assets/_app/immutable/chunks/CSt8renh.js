import{a as L,i as M,j as v,b as N,k as P,c as B}from"./BSQ5w_vH.js";import{h as s,b as E,d as w,aq as j,l as F,E as I,i as O,g as R,a6 as q,o as S,s as m,c as D,$ as G,N as K,ar as V,p as Y,a as Z,M as _,K as H,k as J,L as Q,Z as U,O as X,Y as W,as as $}from"./DjTD-D_2.js";import{a as C,e as ee,g as te,f as ae}from"./BbI6WOyt.js";import{B as se,p as d,r as re}from"./DRSTU_Vb.js";function oe(n,e,o,c,u,k){let b=s;s&&E();var t=null;s&&w.nodeType===j&&(t=w,E());var i=s?w:n,h=new se(i,!1);F(()=>{const a=e()||null;var f=K;if(a===null){h.ensure(null,null),v(!0);return}return h.ensure(a,g=>{if(a){if(t=s?t:O(a,f),L(t,t),c){var r=null;s&&M(a)&&t.append(r=document.createComment(""));var l=s?R(t):t.appendChild(q());s&&(l===null?S(!1):m(l)),c(t,l),r==null||r.remove()}D.nodes.end=t,g.before(t)}s&&m(g)}),v(!0),()=>{a&&v(!1)}},I),G(()=>{v(!0)}),b&&(S(!0),m(i))}/**
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
 */const le=Symbol("lucide-context"),de=()=>V(le);var ce=new Set(["$$slots","$$events","$$legacy","name","color","size","strokeWidth","absoluteStrokeWidth","iconNode","children"]),ue=P("<svg><!><!></svg>");function ke(n,e){Y(e,!0);const o=de()??{},c=d(e,"color",19,()=>o.color??"currentColor"),u=d(e,"size",19,()=>o.size??24),k=d(e,"strokeWidth",19,()=>o.strokeWidth??2),b=d(e,"absoluteStrokeWidth",19,()=>o.absoluteStrokeWidth??!1),t=d(e,"iconNode",19,()=>[]),i=re(e,ce),h=W(()=>b()?Number(k())*24/Number(u()):k());var a=ue();C(a,r=>({...ne,...r,...i,width:u(),height:u(),stroke:c(),"stroke-width":_(h),class:["lucide-icon lucide",o.class,e.name&&`lucide-${e.name}`,e.class]}),[()=>!e.children&&!ie(i)&&{"aria-hidden":"true"}]);var f=H(a);ee(f,17,t,ae,(r,l)=>{var x=W(()=>$(_(l),2));let p=()=>_(x)[0],A=()=>_(x)[1];var y=B(),T=J(y);oe(T,p,!0,(z,he)=>{C(z,()=>({...A()}))}),N(r,y)});var g=Q(f);te(g,()=>e.children??U),X(a),N(n,a),Z()}export{ke as I};
