import{b as B,i as P,d as v,a as C,g as I,c as L}from"./6JsGSbOS.js";import{h as s,c as E,f as m,ao as M,b as R,E as j,Q as F,J as V,a4 as q,e as N,d as w,m as D,Y as G,R as J,ap as O,p as Q,a as Y,A as _,B as H,y as K,C as U,_ as X,I as Z,V as S,aq as $}from"./D1I8hOgq.js";import{h as W,e as ee,j as te,d as ae}from"./yta9nY_a.js";import{B as se,p as d,r as re}from"./opoCodhO.js";function oe(n,e,o,c,u,b){let k=s;s&&E();var t=null;s&&m.nodeType===M&&(t=m,E());var i=s?m:n,h=new se(i,!1);R(()=>{const a=e()||null;var f=J;if(a===null){h.ensure(null,null),v(!0);return}return h.ensure(a,g=>{if(a){if(t=s?t:F(a,f),B(t,t),c){var r=null;s&&P(a)&&t.append(r=document.createComment(""));var l=s?V(t):t.appendChild(q());s&&(l===null?N(!1):w(l)),c(t,l),r==null||r.remove()}D.nodes.end=t,g.before(t)}s&&w(g)}),v(!0),()=>{a&&v(!1)}},j),G(()=>{v(!0)}),k&&(N(!0),w(i))}/**
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
 */const le=Symbol("lucide-context"),de=()=>O(le);var ce=new Set(["$$slots","$$events","$$legacy","name","color","size","strokeWidth","absoluteStrokeWidth","iconNode","children"]),ue=I("<svg><!><!></svg>");function be(n,e){Q(e,!0);const o=de()??{},c=d(e,"color",19,()=>o.color??"currentColor"),u=d(e,"size",19,()=>o.size??24),b=d(e,"strokeWidth",19,()=>o.strokeWidth??2),k=d(e,"absoluteStrokeWidth",19,()=>o.absoluteStrokeWidth??!1),t=d(e,"iconNode",19,()=>[]),i=re(e,ce),h=S(()=>k()?Number(b())*24/Number(u()):b());var a=ue();W(a,r=>({...ne,...r,...i,width:u(),height:u(),stroke:c(),"stroke-width":_(h),class:["lucide-icon lucide",o.class,e.name&&`lucide-${e.name}`,e.class]}),[()=>!e.children&&!ie(i)&&{"aria-hidden":"true"}]);var f=H(a);ee(f,17,t,ae,(r,l)=>{var x=S(()=>$(_(l),2));let p=()=>_(x)[0],A=()=>_(x)[1];var y=L(),T=K(y);oe(T,p,!0,(z,he)=>{W(z,()=>({...A()}))}),C(r,y)});var g=U(f);te(g,()=>e.children??X),Z(a),C(n,a),Y()}export{be as I};
