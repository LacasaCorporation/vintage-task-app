import{a as $}from"./index-DckmbRuV.js";const w=[["path",{d:"M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2",key:"wrbu53"}],["path",{d:"M15 18H9",key:"1lyqi6"}],["path",{d:"M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14",key:"lysw3i"}],["circle",{cx:"17",cy:"18",r:"2",key:"332jqn"}],["circle",{cx:"7",cy:"18",r:"2",key:"19iecd"}]],z=$("truck",w),v={quotation:"QUOTATION",invoice:"INVOICE",delivery:"DELIVERY NOTE"},k={quotation:"Offer issued — not a demand for payment",invoice:"Payment due as shown below",delivery:"Goods received in good condition? Please sign below"},m=t=>new Date(t).toLocaleDateString(void 0,{day:"2-digit",month:"short",year:"numeric"}),a=t=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"),P=t=>Number.isInteger(t)?String(t):t.toFixed(2).replace(/\.?0+$/,"");function D(t){const e=t.lines.reduce((r,c)=>r+c.qty*c.unitPrice,0),n=Math.min(100,Math.max(0,t.discountPct??0)),i=Math.max(0,t.taxPct??0),d=e-e*n/100,l=d*i/100,p=d+l,o=r=>Math.round(r*100)/100;return{net:o(e),discount:o(e*n/100),discountPct:n,tax:o(l),taxPct:i,grand:o(p)}}const I=`
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif; color: #111827; font-size: 12px;
    line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { max-width: 210mm; margin: 0 auto; padding: 8mm 6mm; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
    gap: 16px; border-bottom: 2px solid #111827; padding-bottom: 14px; }
  .brand { display: flex; gap: 12px; align-items: flex-start; }
  .logo { width: 52px; height: 52px; object-fit: contain; border-radius: 8px; }
  .brand h1 { margin: 0; font-size: 17px; letter-spacing: -0.01em; }
  .brand .contact { margin-top: 4px; color: #4b5563; font-size: 11px; }
  .brand .contact div { display: block; }
  .doc { text-align: right; }
  .doc .kind { font-size: 22px; font-weight: 700; letter-spacing: 0.08em; }
  .doc .sub { color: #6b7280; font-size: 10.5px; margin-top: 2px; }
  .doc .num { margin-top: 8px; font-size: 13px; font-weight: 600; }
  .parties { display: flex; gap: 24px; margin: 18px 0 6px; }
  .party { flex: 1; }
  .label { font-size: 9.5px; letter-spacing: 0.09em; text-transform: uppercase;
    color: #6b7280; font-weight: 600; }
  .party .name { font-weight: 600; font-size: 13px; margin-top: 4px; }
  .party .lines { color: #374151; margin-top: 2px; font-size: 11.5px; }
  .meta { display: flex; gap: 24px; margin: 14px 0 18px; }
  .meta .block { min-width: 120px; }
  .meta .v { font-weight: 600; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { text-align: left; font-size: 9.5px; letter-spacing: 0.07em; text-transform: uppercase;
    color: #6b7280; border-bottom: 1px solid #d1d5db; padding: 7px 8px; }
  th.r, td.r { text-align: right; }
  td { padding: 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  td.name { font-weight: 600; }
  td.muted { color: #6b7280; font-size: 11px; }
  .totals { display: flex; justify-content: flex-end; margin-top: 16px; }
  .totals table { width: 260px; }
  .totals td { border: none; padding: 4px 8px; }
  .totals tr.grand td { border-top: 2px solid #111827; font-size: 15px;
    font-weight: 700; padding-top: 8px; }
  .totals tr.due td { font-size: 13px; font-weight: 700; }
  .paid-stamp { display: inline-block; border: 2px solid #047857; color: #047857;
    font-weight: 700; letter-spacing: 0.1em; padding: 3px 10px; border-radius: 4px;
    font-size: 11px; }
  .notes { margin-top: 22px; display: flex; gap: 24px; }
  .notes > div { flex: 1; }
  .notes p { margin: 4px 0 0; color: #374151; font-size: 11.5px; white-space: pre-wrap; }
  .sign { margin-top: 26px; display: flex; gap: 40px; }
  .sign > div { flex: 1; }
  .sign .rule { margin-top: 34px; border-top: 1px solid #9ca3af; padding-top: 4px;
    color: #6b7280; font-size: 10.5px; }
  .foot { margin-top: 26px; border-top: 1px solid #e5e7eb; padding-top: 10px;
    color: #6b7280; font-size: 10px; text-align: center; }
  .warn { margin-top: 14px; border: 1px solid #d1d5db; border-left: 3px solid #111827;
    padding: 8px 12px; font-size: 11px; color: #374151; background: #f9fafb; }
  .due { color: #b91c1c; font-weight: 600; }
`;function R(t,e,n){const i=D(t),d=s=>`${n}${s.toLocaleString(void 0,{minimumFractionDigits:2,maximumFractionDigits:2})}`,l=t.customerName.trim()||"Customer",p=Date.now(),o=[e?.address,e?.phone,e?.email,e?.website,e?.taxId?`Tax ID ${e.taxId}`:void 0].filter(s=>!!(s&&s.trim())),r=`
    <div class="head">
      <div class="brand">
        ${e?.logo?`<img class="logo" src="${e.logo}" alt="" />`:""}
        <div>
          <h1>${a(e?.name||"Your business")}</h1>
          <div class="contact">${o.map(s=>`<div>${a(s)}</div>`).join("")}</div>
        </div>
      </div>
      <div class="doc">
        <div class="kind">${v[t.kind]}</div>
        <div class="sub">${a(k[t.kind])}</div>
        <div class="num">${a(t.number)}</div>
      </div>
    </div>`,c=`
    <div class="parties">
      <div class="party">
        <div class="label">${t.kind==="delivery"?"Deliver to":"Bill to"}</div>
        <div class="name">${a(l)}</div>
        <div class="lines">
          ${(t.customerAddress??"").split(`
`).filter(s=>s.trim()).map(s=>`<div>${a(s)}</div>`).join("")}
          ${t.customerEmail?`<div>${a(t.customerEmail)}</div>`:""}
        </div>
      </div>
      <div class="party" style="max-width: 46mm;">
        <div class="label">Reference</div>
        <div class="lines" style="margin-top: 4px;">
          ${t.poRef?`<div>PO ${a(t.poRef)}</div>`:""}
          ${t.fromRef?`<div>From ${a(t.fromRef)}</div>`:""}
          ${t.docketRef?`<div>Docket ${a(t.docketRef)}</div>`:""}
          ${t.kind==="delivery"&&t.status?`<div>Status: ${a(t.status)}</div>`:""}
        </div>
      </div>
    </div>`,u=`
    <div class="meta">
      <div class="block">
        <div class="label">${t.kind==="quotation"?"Quoted on":t.kind==="invoice"?"Invoice date":"Delivered on"}</div>
        <div class="v">${m(t.date)}</div>
      </div>
      ${t.secondaryDate!==void 0?`<div class="block">
              <div class="label">${a(t.secondaryLabel)}</div>
              <div class="v${t.kind==="invoice"&&t.secondaryDate<p?" due":""}">${m(t.secondaryDate)}</div>
            </div>`:""}
      ${t.deliveredBy?`<div class="block"><div class="label">Delivered by</div><div class="v">${a(t.deliveredBy)}</div></div>`:""}
    </div>`,x=`
    <table>
      <thead>
        <tr>
          <th style="width: 8mm;">#</th>
          <th>Description</th>
          <th class="r" style="width: 18mm;">Qty</th>
          <th style="width: 16mm;">Unit</th>
          <th class="r" style="width: 26mm;">Rate</th>
          <th class="r" style="width: 30mm;">Amount</th>
        </tr>
      </thead>
      <tbody>${t.lines.map((s,f)=>`
      <tr>
        <td style="width: 8mm;" class="muted">${f+1}</td>
        <td class="name">${a(s.name)}</td>
        <td class="r" style="width: 18mm;">${P(s.qty)}</td>
        <td class="muted" style="width: 16mm;">${a(s.unit??"")}</td>
        <td class="r" style="width: 26mm;">${d(s.unitPrice)}</td>
        <td class="r" style="width: 30mm; font-weight: 600;">${d(s.qty*s.unitPrice)}</td>
      </tr>`).join("")}</tbody>
    </table>`,g=t.kind==="delivery"?`
      <div class="totals">
        <table>
          <tr><td>Value of goods delivered</td><td class="r">${d(i.net)}</td></tr>
        </table>
      </div>
      <div class="warn">
        This is a delivery note. It records goods handed over only — it is not an
        invoice and nothing is payable on account of it. The invoice above
        reference is the document that states what is owed.
      </div>`:`
      <div class="totals">
        <table>
          <tr><td>Sub total</td><td class="r">${d(i.net)}</td></tr>
          ${i.discountPct>0?`<tr><td>Discount (${i.discountPct}%)</td><td class="r">−${d(i.discount)}</td></tr>`:""}
          ${i.taxPct>0?`<tr><td>Tax amount (${i.taxPct}%)</td><td class="r">${d(i.tax)}</td></tr>`:""}
          <tr class="grand"><td>Total</td><td class="r">${d(i.grand)}</td></tr>
          ${t.kind==="invoice"&&(t.paid??0)>0?`<tr><td>Paid</td><td class="r">−${d(t.paid??0)}</td></tr>
                 <tr class="due"><td>Balance due</td><td class="r">${d(i.grand-(t.paid??0))}</td></tr>`:""}
        </table>
      </div>`,b=t.kind==="invoice"&&(t.paid??0)>=i.grand&&i.grand>0,y=`
    <div class="notes">
      ${t.note?`<div><div class="label">Notes</div><p>${a(t.note)}</p></div>`:""}
      ${t.terms?`<div><div class="label">${t.kind==="quotation"?"Terms":"Payment terms"}</div><p>${a(t.terms)}</p></div>`:""}
    </div>`,h=t.kind==="delivery"?`
      <div class="sign">
        <div><div class="label">Received by</div><div class="rule">Name and signature</div></div>
        <div><div class="label">Date</div><div class="rule">&nbsp;</div></div>
        <div><div class="label">Condition on arrival</div><div class="rule">&nbsp;</div></div>
      </div>`:`
      <div class="sign">
        <div><div class="label">Accepted for ${a(e?.name||"the supplier")}</div><div class="rule">Name, signature and date</div></div>
      </div>`;return`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${v[t.kind]} ${a(t.number)}</title>
<style>${I}</style>
</head>
<body>
  <div class="sheet">
    ${r}
    ${c}
    ${u}
    ${x}
    ${g}
    ${b?'<div style="margin-top:14px"><span class="paid-stamp">PAID IN FULL</span></div>':""}
    ${y}
    ${h}
    <div class="foot">
      ${a(e?.name||"")}${e?.email?` · ${a(e.email)}`:""}${e?.phone?` · ${a(e.phone)}`:""}
      ${e?.taxId?` · Tax ID ${a(e.taxId)}`:""}
    </div>
  </div>
</body>
</html>`}function L(t,e,n){const i=window.open("","_blank","width=900,height=1000");return i?(i.document.open(),i.document.write(R(t,e,n)),i.document.close(),i.setTimeout(()=>{i.focus(),i.print()},300),!0):!1}const B={quotation:"bg-sky-500/10 text-sky-700 dark:text-sky-400",invoice:"bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",delivery:"bg-violet-500/10 text-violet-700 dark:text-violet-400"},E={quotation:"Print the quotation for the customer",invoice:"Print the invoice for the customer",delivery:"Print the delivery note for the driver to sign"};function j(t){return{kind:"quotation",number:t.number,date:t.quotedAt,secondaryDate:t.validUntil,secondaryLabel:"Valid until",poRef:t.poRef,customerName:t.customerName??"Customer",customerAddress:t.customerAddress,note:t.note,terms:t.terms,status:t.status,currency:t.currency??"",lines:t.lines,discountPct:t.discountPct,taxPct:t.taxPct}}function S(t){return{kind:"invoice",number:t.number,date:t.soldAt,secondaryDate:t.dueAt,secondaryLabel:"Payment due",poRef:t.poRef,customerName:t.customerName??"Customer",customerAddress:t.customerAddress,note:t.note,terms:t.terms,fromRef:t.quotationId,currency:t.currency??"",lines:t.lines,discountPct:t.discountPct,taxPct:t.taxPct,paid:t.isPaid===!0?t.total:0}}function M(t){return{kind:"delivery",number:t.number,date:t.deliveredAt,secondaryLabel:"Received on",poRef:t.docketRef??t.poRef,customerName:t.customerName??"Customer",customerAddress:t.customerAddress,note:t.note,deliveredBy:t.deliveredBy,docketRef:t.docketRef,receivedBy:t.receivedBy,receivedAt:t.receivedAt,status:t.status,currency:t.currency??"",lines:t.lines}}export{B as D,E as P,z as T,S as a,M as b,j as c,L as p};
