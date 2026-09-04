import{n as g}from"./index-DlibJaiY.js";import{j as p}from"./vendor-query-lt1T2TzN.js";/**
 * @license lucide-react v1.22.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const x=[["path",{d:"M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8",key:"mg9rjx"}]],M=g("bold",x);/**
 * @license lucide-react v1.22.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const k=[["line",{x1:"19",x2:"10",y1:"4",y2:"4",key:"15jd3p"}],["line",{x1:"14",x2:"5",y1:"20",y2:"20",key:"bu0au3"}],["line",{x1:"15",x2:"9",y1:"4",y2:"20",key:"uljnxc"}]],F=g("italic",k);/**
 * @license lucide-react v1.22.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m=[["path",{d:"M16 4H9a3 3 0 0 0-2.83 4",key:"43sutm"}],["path",{d:"M14 12a4 4 0 0 1 0 8H6",key:"nlfj13"}],["line",{x1:"4",x2:"20",y1:"12",y2:"12",key:"1e0a9i"}]],R=g("strikethrough",m),y=[{re:/```([^`]+)```/,Tag:"code",rekursif:!1,style:{fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",background:"var(--bg-inset, rgba(0,0,0,0.06))",padding:"1px 4px",borderRadius:4,fontSize:"0.92em"}},{re:/(https?:\/\/[^\s<]+)/,isLink:!0,rekursif:!1},{re:/\*([^*\n]+)\*/,Tag:"strong",rekursif:!0},{re:/_([^_\n]+)_/,Tag:"em",rekursif:!0},{re:/~([^~\n]+)~/,Tag:"del",rekursif:!0}];function b(s){let n=null;for(const t of y){const e=t.re.exec(s);e&&(n===null||e.index<n.m.index)&&(n={m:e,pola:t})}return n}function _(s,n=0){if(!s)return null;const t=[];let e=String(s),l=0;for(;e.length>0;){const i=b(e);if(!i){t.push(e);break}const{m:o,pola:c}=i;o.index>0&&t.push(e.slice(0,o.index));const{Tag:a,rekursif:u,style:r,isLink:h}=c,d=o[1];t.push(h?p.jsx("a",{href:d,target:"_blank",rel:"noreferrer",className:"bubble-link",onClick:f=>f.stopPropagation(),children:d},l++):p.jsx(a,{style:r,children:u&&n<2?_(d,n+1):d},l++)),e=e.slice(o.index+o[0].length)}return t}const S=[/google\.[a-z.]+\/maps\/?\?q=(-?\d+\.\d+),(-?\d+\.\d+)/i,/google\.[a-z.]+\/maps\/@(-?\d+\.\d+),(-?\d+\.\d+)/i,/google\.[a-z.]+\/maps\/place\/[^/]*\/@(-?\d+\.\d+),(-?\d+\.\d+)/i,/maps\.apple\.com\/\?ll=(-?\d+\.\d+),(-?\d+\.\d+)/i,/^geo:(-?\d+\.\d+),(-?\d+\.\d+)/i];function W(s){if(!s)return null;const n=s.trim();if(!/^(https?:\/\/|geo:)/i.test(n)||/\s/.test(n))return null;for(const t of S){const e=t.exec(n);if(e)return{lat:parseFloat(e[1]),lng:parseFloat(e[2])}}return null}const A={bold:"*",italic:"_",strike:"~"};function E(s,n,t){const e=s.selectionStart??n.length,l=s.selectionEnd??n.length,i=n.slice(e,l),o=i.length>=t.length*2&&i.startsWith(t)&&i.endsWith(t);let c,a,u;if(o){const r=i.slice(t.length,i.length-t.length);c=n.slice(0,e)+r+n.slice(l),a=e,u=e+r.length}else{const r=t+i+t;c=n.slice(0,e)+r+n.slice(l),a=e+t.length,u=a+i.length}return{nextText:c,selStart:a,selEnd:u}}export{M as B,F as I,R as S,A as W,W as e,_ as p,E as t};
