import{b as B,i as P,d as v,a as W,g as I,c as L}from"./Cj8fpFot.js";import{q as s,x as E,I as w,ar as M,w as F,E as G,V as O,O as R,a6 as V,H as N,G as x,B as j,a1 as q,W as D,as as H,p as Z,a as J,g as _,c as K,f as Q,e as U,y as X,r as Y,Z as S,at as $}from"./DHWLhpiP.js";import{a as C,e as ee,s as te,d as ae}from"./CQfn4eCS.js";import{B as se,p as d,r as re}from"./Bt_S5hGO.js";function oe(n,e,o,c,u,k){let b=s;s&&E();var t=null;s&&w.nodeType===M&&(t=w,E());var i=s?w:n,f=new se(i,!1);F(()=>{const a=e()||null;var h=o||a==="svg"?D:void 0;if(a===null){f.ensure(null,null),v(!0);return}return f.ensure(a,g=>{if(a){if(t=s?t:O(a,h),B(t,t),c){var r=null;s&&P(a)&&t.append(r=document.createComment(""));var l=s?R(t):t.appendChild(V());s&&(l===null?N(!1):x(l)),c(t,l),r==null||r.remove()}j.nodes.end=t,g.before(t)}s&&x(g)}),v(!0),()=>{a&&v(!1)}},G),q(()=>{v(!0)}),b&&(N(!0),x(i))}/**
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
 */const le=Symbol("lucide-context"),de=()=>H(le);var ce=new Set(["$$slots","$$events","$$legacy","name","color","size","strokeWidth","absoluteStrokeWidth","iconNode","children"]),ue=I("<svg><!><!></svg>");function ke(n,e){Z(e,!0);const o=de()??{},c=d(e,"color",19,()=>o.color??"currentColor"),u=d(e,"size",19,()=>o.size??24),k=d(e,"strokeWidth",19,()=>o.strokeWidth??2),b=d(e,"absoluteStrokeWidth",19,()=>o.absoluteStrokeWidth??!1),t=d(e,"iconNode",19,()=>[]),i=re(e,ce),f=S(()=>b()?Number(k())*24/Number(u()):k());var a=ue();C(a,r=>({...ne,...r,...i,width:u(),height:u(),stroke:c(),"stroke-width":_(f),class:["lucide-icon lucide",o.class,e.name&&`lucide-${e.name}`,e.class]}),[()=>!e.children&&!ie(i)&&{"aria-hidden":"true"}]);var h=K(a);ee(h,17,t,ae,(r,l)=>{var m=S(()=>$(_(l),2));let p=()=>_(m)[0],A=()=>_(m)[1];var y=L(),T=Q(y);oe(T,p,!0,(z,fe)=>{C(z,()=>({...A()}))}),W(r,y)});var g=U(h);te(g,()=>e.children??X),Y(a),W(n,a),J()}export{ke as I,oe as e};
