import test from 'node:test';
import assert from 'node:assert/strict';
import { precedingEarnings, verifiedChanges } from '../lib/callComparison';
import type { CallRecord } from '../lib/callsArchive';
test('comparison selects preceding earnings, excludes future and conference records',()=>{
  const rec=(period:string,date:string,eventType?:'conference')=>({symbol:'FRPT',fiscalPeriod:period,callDate:date,eventType}) as CallRecord;
  const selected=rec('conference-1-2','2026-09-10','conference');
  const prior=rec('2026-Q2','2026-08-05');
  assert.equal(precedingEarnings([rec('2026-Q3','2026-11-01'),rec('conference-1-1','2026-09-01','conference'),prior,rec('2026-Q1','2026-05-01')],selected),prior);
  assert.equal(precedingEarnings([selected],selected),undefined);
});
test('comparison drops invented, swapped and truncated quotations',()=>{
  const before='Our adjusted margin target is at least 49%.',after='We reiterate the adjusted margin target of 49%.';
  const good={topic:'Margin target reaffirmed',change:'The target remains unchanged.',beforeQuote:before,afterQuote:after};
  assert.deepEqual(verifiedChanges({changes:[good,{...good,afterQuote:'We have raised our margin target to 55%.'},{...good,beforeQuote:after,afterQuote:before}]},before,after),[good]);
  assert.deepEqual(verifiedChanges({changes:[{...good,afterQuote:'...49%'}]},before,after),[]);
});
