import{b as z,i as P,a as y,d as B,c as L}from"./In_r4Pg7.js";import{h as s,c as C,f as k,an as M,b as R,E as j,Q as F,K as G,a3 as I,e as E,d as m,m as V,X as q,R as D,ao as K,p as O,a as Q,G as v,n as X,C as Z,o as H,Z as J,q as U,V as N,ap as Y}from"./BkxjBBuX.js";import{h as S,e as $,j as ee,f as te}from"./BNU3oQhZ.js";import{B as ae,p as d,r as se}from"./BPAE2Pgv.js";function re(n,e,o,c,u,_){let b=s;s&&C();var t=null;s&&k.nodeType===M&&(t=k,C());var i=s?k:n,h=new ae(i,!1);R(()=>{const a=e()||null;var f=D;if(a===null){h.ensure(null,null);return}return h.ensure(a,g=>{if(a){if(t=s?t:F(a,f),z(t,t),c){var r=null;s&&P(a)&&t.append(r=document.createComment(""));var l=s?G(t):t.appendChild(I());s&&(l===null?E(!1):m(l)),c(t,l),r==null||r.remove()}V.nodes.end=t,g.before(t)}s&&m(g)}),()=>{}},j),q(()=>{}),b&&(E(!0),m(i))}/**
 * @file
 * @license @lucide/svelte v1.24.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const oe={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"};/**
 * @file
 * @license @lucide/svelte v1.24.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ne=n=>{for(const e in n)if(e.startsWith("aria-")||e==="role"||e==="title")return!0;return!1};/**
 * @file
 * @license @lucide/svelte v1.24.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ie=Symbol("lucide-context"),le=()=>K(ie);var de=new Set(["$$slots","$$events","$$legacy","name","color","size","strokeWidth","absoluteStrokeWidth","iconNode","children"]),ce=B("<svg><!><!></svg>");function _e(n,e){O(e,!0);const o=le()??{},c=d(e,"color",19,()=>o.color??"currentColor"),u=d(e,"size",19,()=>o.size??24),_=d(e,"strokeWidth",19,()=>o.strokeWidth??2),b=d(e,"absoluteStrokeWidth",19,()=>o.absoluteStrokeWidth??!1),t=d(e,"iconNode",19,()=>[]),i=se(e,de),h=N(()=>b()?Number(_())*24/Number(u()):_());var a=ce();S(a,r=>({...oe,...r,...i,width:u(),height:u(),stroke:c(),"stroke-width":v(h),class:["lucide-icon lucide",o.class,e.name&&`lucide-${e.name}`,e.class]}),[()=>!e.children&&!ne(i)&&{"aria-hidden":"true"}]);var f=X(a);$(f,17,t,te,(r,l)=>{var w=N(()=>Y(v(l),2));let W=()=>v(w)[0],p=()=>v(w)[1];var x=L(),A=Z(x);re(A,W,!0,(T,ue)=>{S(T,()=>({...p()}))}),y(r,x)});var g=H(f);ee(g,()=>e.children??J),U(a),y(n,a),Q()}export{_e as I};
