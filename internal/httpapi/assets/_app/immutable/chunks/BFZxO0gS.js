import{g as z,i as B,j as v,a as E,k as I,c as L}from"./BOkvs-TI.js";import{q as s,y as N,I as w,ar as M,x as j,E as F,X as G,Q as R,a6 as q,H as S,G as x,B as D,a1 as H,Y as O,as as Q,p as V,a as X,g as _,c as Y,f as J,e as K,_ as U,r as Z,P as W,at as $}from"./84wJH_fd.js";import{a as C,e as ee,g as te,d as ae}from"./Pub7YKRL.js";import{B as se,p as d,r as re}from"./7Adr9IWM.js";function oe(n,e,o,c,u,k){let b=s;s&&N();var t=null;s&&w.nodeType===M&&(t=w,N());var i=s?w:n,h=new se(i,!1);j(()=>{const a=e()||null;var f=O;if(a===null){h.ensure(null,null),v(!0);return}return h.ensure(a,g=>{if(a){if(t=s?t:G(a,f),z(t,t),c){var r=null;s&&B(a)&&t.append(r=document.createComment(""));var l=s?R(t):t.appendChild(q());s&&(l===null?S(!1):x(l)),c(t,l),r==null||r.remove()}D.nodes.end=t,g.before(t)}s&&x(g)}),v(!0),()=>{a&&v(!1)}},F),H(()=>{v(!0)}),b&&(S(!0),x(i))}/**
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
 */const le=Symbol("lucide-context"),de=()=>Q(le);var ce=new Set(["$$slots","$$events","$$legacy","name","color","size","strokeWidth","absoluteStrokeWidth","iconNode","children"]),ue=I("<svg><!><!></svg>");function ke(n,e){V(e,!0);const o=de()??{},c=d(e,"color",19,()=>o.color??"currentColor"),u=d(e,"size",19,()=>o.size??24),k=d(e,"strokeWidth",19,()=>o.strokeWidth??2),b=d(e,"absoluteStrokeWidth",19,()=>o.absoluteStrokeWidth??!1),t=d(e,"iconNode",19,()=>[]),i=re(e,ce),h=W(()=>b()?Number(k())*24/Number(u()):k());var a=ue();C(a,r=>({...ne,...r,...i,width:u(),height:u(),stroke:c(),"stroke-width":_(h),class:["lucide-icon lucide",o.class,e.name&&`lucide-${e.name}`,e.class]}),[()=>!e.children&&!ie(i)&&{"aria-hidden":"true"}]);var f=Y(a);ee(f,17,t,ae,(r,l)=>{var m=W(()=>$(_(l),2));let p=()=>_(m)[0],A=()=>_(m)[1];var y=L(),P=J(y);oe(P,p,!0,(T,he)=>{C(T,()=>({...A()}))}),E(r,y)});var g=K(f);te(g,()=>e.children??U),Z(a),E(n,a),X()}export{ke as I};
