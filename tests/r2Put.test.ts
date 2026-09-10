import test from 'node:test';
import assert from 'node:assert/strict';
test('R2 PUT supplies the exact UTF-8 byte length through signing', async () => {
  process.env.LAKE_S3_ENDPOINT='example.com';process.env.LAKE_S3_BUCKET='test';
  process.env.LAKE_S3_KEY_ID='test';process.env.LAKE_S3_SECRET='test';
  const original=globalThis.fetch;
  const bytes=Buffer.from('Freshpet — café');let checked=false;
  globalThis.fetch=async (input,init)=>{const req=new Request(input,init);assert.equal(req.headers.get('content-length'),String(bytes.byteLength));assert.deepEqual(Buffer.from(await req.arrayBuffer()),bytes);checked=true;return new Response('',{status:200});};
  try {const {putObject}=await import('../lib/r2');await putObject('test.json',bytes,'application/json');assert.ok(checked);}
  finally {globalThis.fetch=original;}
});
