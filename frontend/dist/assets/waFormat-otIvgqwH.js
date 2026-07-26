import{c as g}from"./index-D2eAJMsX.js";import{j as d}from"./vendor-query-lt1T2TzN.js";/**
 * @license lucide-react v1.22.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const x=[["path",{d:"M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8",key:"mg9rjx"}]],S=g("bold",x);/**
 * @license lucide-react v1.22.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p=[["line",{x1:"19",x2:"10",y1:"4",y2:"4",key:"15jd3p"}],["line",{x1:"14",x2:"5",y1:"20",y2:"20",key:"bu0au3"}],["line",{x1:"15",x2:"9",y1:"4",y2:"20",key:"uljnxc"}]],j=g("italic",p);/**
 * @license lucide-react v1.22.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y=[["path",{d:"M16 4H9a3 3 0 0 0-2.83 4",key:"43sutm"}],["path",{d:"M14 12a4 4 0 0 1 0 8H6",key:"nlfj13"}],["line",{x1:"4",x2:"20",y1:"12",y2:"12",key:"1e0a9i"}]],T=g("strikethrough",y),f=[{re:/```([^`]+)```/,Tag:"code",rekursif:!1,style:{fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",background:"var(--bg-inset, rgba(0,0,0,0.06))",padding:"1px 4px",borderRadius:4,fontSize:"0.92em"}},{re:/\*([^*\n]+)\*/,Tag:"strong",rekursif:!0},{re:/_([^_\n]+)_/,Tag:"em",rekursif:!0},{re:/~([^~\n]+)~/,Tag:"del",rekursif:!0}];function k(i){let t=null;for(const n of f){const e=n.re.exec(i);e&&(t===null||e.index<t.m.index)&&(t={m:e,pola:n})}return t}function b(i,t=0){if(!i)return null;const n=[];let e=String(i),a=0;for(;e.length>0;){const s=k(e);if(!s){n.push(e);break}const{m:o,pola:r}=s;o.index>0&&n.push(e.slice(0,o.index));const{Tag:l,rekursif:u,style:c}=r,h=o[1];n.push(d.jsx(l,{style:c,children:u&&t<2?b(h,t+1):h},a++)),e=e.slice(o.index+o[0].length)}return n}const M={bold:"*",italic:"_",strike:"~"};function W(i,t,n){const e=i.selectionStart??t.length,a=i.selectionEnd??t.length,s=t.slice(e,a),o=s.length>=n.length*2&&s.startsWith(n)&&s.endsWith(n);let r,l,u;if(o){const c=s.slice(n.length,s.length-n.length);r=t.slice(0,e)+c+t.slice(a),l=e,u=e+c.length}else{const c=n+s+n;r=t.slice(0,e)+c+t.slice(a),l=e+n.length,u=l+s.length}return{nextText:r,selStart:l,selEnd:u}}export{S as B,j as I,T as S,M as W,b as p,W as t};
