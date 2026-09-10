"use client";
import { useState } from "react";
import type { CallComparison } from "@/lib/callComparison";
export default function CallComparisonPanel({ symbol, period }: { symbol: string; period: string }) {
  const [result,setResult] = useState<CallComparison|null>(null), [busy,setBusy] = useState(false), [error,setError] = useState("");
  async function compare() {
    setBusy(true);setError("");
    try {
      const query=new URLSearchParams({symbol,period});
      let response=await fetch(`/api/conferences/compare?${query}`,{cache:"no-store"}), data=await response.json();
      if (!response.ok) throw Error(data.error);
      if (!data.comparison) { response=await fetch('/api/conferences/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol,period})});data=await response.json(); }
      if (!response.ok) throw Error(data.error);setResult(data.comparison);
    } catch(e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  const evidenceLink=(period:string,quote:string)=>`?q=${encodeURIComponent(period)}#:~:text=${encodeURIComponent(quote)}`;
  return <section style={{margin:'20px 0',padding:18,border:'1px solid var(--border)',borderRadius:12,lineHeight:1.6}}>
    <h2 style={{fontSize:17,fontWeight:700}}>What changed?</h2>
    <p style={{fontSize:14,color:'var(--text-3)',margin:'6px 0 12px'}}>Compare this presentation with the preceding earnings call, with evidence from both transcripts.</p>
    {!result && <button disabled={busy} onClick={()=>void compare()} style={{padding:'9px 14px',borderRadius:8,background:'var(--accent)',color:'#fff',fontWeight:600}}>{busy?'Reading both transcripts…':'Compare with previous earnings call'}</button>}
    {error && <p role="alert" style={{fontSize:14}}>{error}</p>}
    {result && <>
      <p style={{fontSize:13,color:'var(--text-3)'}}>{result.before.date} → {result.after.date} · AI comparison; supporting quotations checked against both transcripts.</p>
      <ul style={{listStyle:'disc',paddingLeft:22,display:'grid',gap:20,marginTop:16}}>{result.changes.map((c,i)=><li key={i}>
        <h3 style={{fontSize:15,fontWeight:700}}>{c.topic}</h3><p style={{fontSize:14,marginTop:6}}>{c.change}</p>
        <details style={{fontSize:13,marginTop:8,color:'var(--text-3)'}}><summary style={{cursor:'pointer'}}>Read the evidence from both calls</summary>
          <p style={{margin:'8px 0'}}><b>{result.before.date}:</b> <a style={{color:'var(--accent)'}} href={evidenceLink(result.before.period,c.beforeQuote)}>“{c.beforeQuote}”</a></p>
          <p><b>{result.after.date}:</b> <a style={{color:'var(--accent)'}} href={evidenceLink(result.after.period,c.afterQuote)}>“{c.afterQuote}”</a></p>
        </details>
      </li>)}</ul>
    </>}
  </section>;
}
