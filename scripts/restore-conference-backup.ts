/** Preview by default; --apply restores only missing/older records into the durable web overlay. */
import { getObject } from '../lib/r2';
import { conferenceRecordsDir, readJson, writeJson } from '../lib/conferencePortal';
import type { CallRecord } from '../lib/callsArchive';
import path from 'node:path';
async function main() {
  const id=process.argv[2],apply=process.argv.includes('--apply');
  if(!/^\d{1,16}$/.test(id||''))throw Error('Supply a conference ID.');
  const manifest=JSON.parse((await getObject(`site-data/conferences/${id}/manifest.json`)).toString()) as {records:{symbol:string;period:string}[]};
  for(const item of manifest.records) {
    if(!/^[A-Z0-9][A-Z0-9.^=-]{0,19}$/.test(item.symbol)||!new RegExp(`^conference-${id}-\\d+$`).test(item.period))throw Error('Invalid backup identity.');
    const rec=JSON.parse((await getObject(`site-data/conferences/${id}/${item.symbol}/${item.period}.json`)).toString()) as CallRecord;
    if(rec.symbol!==item.symbol||rec.fiscalPeriod!==item.period||rec.eventType!=='conference'||!rec.transcript?.text||!rec.digest)throw Error('Invalid backup record.');
    const file=path.join(conferenceRecordsDir(),item.symbol,`${item.period}.json`),old=await readJson<CallRecord>(file);
    if(old&&(old.digestedAt||'')>=(rec.digestedAt||''))continue;
    console.log(`${apply?'Restoring':'Would restore'} ${item.symbol} ${item.period}`);
    if(apply)await writeJson(file,rec);
  }
}
main().catch(e=>{console.error((e as Error).message);process.exitCode=1;});
