import{b as r}from"./matriksAksi-Dll8XOWu.js";import{c as n,Q as o,ai as l}from"./index-UE65BoDY.js";import{P as s}from"./paperclip-DIvd-m8m.js";import{S as c}from"./shield-alert-DpHudB4H.js";import{B as m}from"./ban-C8H6n6d5.js";import{H as f}from"./history-C8SuzqQo.js";import{P as t}from"./pencil-BC60iwDT.js";/**
 * @license lucide-react v1.22.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const k=[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M9 15h6",key:"cctwl0"}]],u=n("file-minus",k),p={edit:t,koreksi:t,riwayat:f,batal:m,catatUlang:l,kembali:o,tolak:c,lampirkan:s,notaKredit:u};function M(){try{return r(JSON.parse(localStorage.getItem("user")||"null"))}catch{return!1}}function S(e,i={}){return e.map(a=>({key:a.key,label:a.label,icon:p[a.aksi],destructive:a.destructive,disabled:!a.aktif,alasan:a.aktif?null:a.alasan,hint:a.aktif?a.hint:null,onClick:a.aktif?i[a.key]:void 0}))}export{u as F,M as a,S as b};
