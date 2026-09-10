import path from 'node:path';
import { promises as fs } from 'node:fs';
import { putObject } from './r2';
import { conferenceRecordsDir, type PortalJob } from './conferencePortal';
const manifestWrites = new Map<string, number>();
export async function backupPresentation(job: PortalJob, talkId: string) {
  const talk=job.talks.find(t=>t.id===talkId);
  if(!talk?.published || !talk.symbol) return;
  const period=`conference-${job.id}-${talk.id}`;
  const bytes=await fs.readFile(path.join(conferenceRecordsDir(),talk.symbol,`${period}.json`));
  await putObject(`site-data/conferences/${job.id}/${talk.symbol}/${period}.json`,bytes,'application/json',15000);
  const records=job.talks.filter(t=>t.published&&t.symbol&&(t.backedUp||t.id===talkId)).map(t=>({symbol:t.symbol,period:`conference-${job.id}-${t.id}`}));
  // Publications are serialized by the worker route. Pace overwrites of the shared manifest.
  const delay = 1200 - (Date.now() - (manifestWrites.get(job.id) || 0));
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  try { await putObject(`site-data/conferences/${job.id}/manifest.json`,Buffer.from(JSON.stringify({id:job.id,title:job.title,records,updatedAt:new Date().toISOString()})),'application/json',12000); }
  finally { manifestWrites.set(job.id, Date.now()); }
  talk.backedUp=true;
}
