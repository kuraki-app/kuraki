import{b as T,i as B,a as y,d as P,c as L}from"./Bc7W5Dix.js";import{h as s,b as N,f as b,an as M,c as R,E as j,N as F,G,a3 as I,e as E,d as m,k as O,X as D,O as V,ao as X,p as Y,a as q,B as v,l as H,z as J,m as K,Y as Q,n as U,R as S,ap as Z}from"./DXAbhbgU.js";import{h as W,e as $,j as ee,f as te}from"./C0O6lC9w.js";import{B as ae,p as d,r as se}from"./CMr7KEDl.js";function re(n,e,o,c,u,_){let k=s;s&&N();var t=null;s&&b.nodeType===M&&(t=b,N());var i=s?b:n,h=new ae(i,!1);R(()=>{const a=e()||null;var f=V;if(a===null){h.ensure(null,null);return}return h.ensure(a,g=>{if(a){if(t=s?t:F(a,f),T(t,t),c){var r=null;s&&B(a)&&t.append(r=document.createComment(""));var l=s?G(t):t.appendChild(I());s&&(l===null?E(!1):m(l)),c(t,l),r==null||r.remove()}O.nodes.end=t,g.before(t)}s&&m(g)}),()=>{}},j),D(()=>{}),k&&(E(!0),m(i))}/**
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
 */const ie=Symbol("lucide-context"),le=()=>X(ie);var de=new Set(["$$slots","$$events","$$legacy","name","color","size","strokeWidth","absoluteStrokeWidth","iconNode","children"]),ce=P("<svg><!><!></svg>");function _e(n,e){Y(e,!0);const o=le()??{},c=d(e,"color",19,()=>o.color??"currentColor"),u=d(e,"size",19,()=>o.size??24),_=d(e,"strokeWidth",19,()=>o.strokeWidth??2),k=d(e,"absoluteStrokeWidth",19,()=>o.absoluteStrokeWidth??!1),t=d(e,"iconNode",19,()=>[]),i=se(e,de),h=S(()=>k()?Number(_())*24/Number(u()):_());var a=ce();W(a,r=>({...oe,...r,...i,width:u(),height:u(),stroke:c(),"stroke-width":v(h),class:["lucide-icon lucide",o.class,e.name&&`lucide-${e.name}`,e.class]}),[()=>!e.children&&!ne(i)&&{"aria-hidden":"true"}]);var f=H(a);$(f,17,t,te,(r,l)=>{var w=S(()=>Z(v(l),2));let C=()=>v(w)[0],p=()=>v(w)[1];var x=L(),A=J(x);re(A,C,!0,(z,ue)=>{W(z,()=>({...p()}))}),y(r,x)});var g=K(f);ee(g,()=>e.children??Q),U(a),y(n,a),q()}export{_e as I};
