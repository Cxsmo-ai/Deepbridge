import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { decodeFrame, encodeFrame } from "../dist/newshosting/protocol.js";

async function writeChunks(stream, buffer, sizes) {
  let offset = 0;
  for (const size of sizes) {
    if (offset >= buffer.length) break;
    stream.write(buffer.subarray(offset, Math.min(offset + size, buffer.length)));
    offset += size;
    await new Promise(resolve => setImmediate(resolve));
  }
  if (offset < buffer.length) stream.write(buffer.subarray(offset));
}

async function testSplitFrame() {
  const xml = `<response><groups items="1"><group><title>Chunked Frame</title></group></groups></response>`;
  const wire = encodeFrame(xml);
  const stream = new PassThrough();
  const decoded = decodeFrame(stream, 5000);
  await writeChunks(stream, wire, [1, 2, 1, 7, 3, 2, 11, 5, 13]);
  assert.equal(await decoded, xml);
}

async function testBackToBackFrames() {
  const first = `<response><login valid="true"/></response>`;
  const second = `<response><file><articles><article bytes="1" number="1"><message-id>x@y</message-id></article></articles></file></response>`;
  const stream = new PassThrough();
  stream.write(Buffer.concat([encodeFrame(first), encodeFrame(second)]));
  assert.equal(await decodeFrame(stream, 5000), first);
  assert.equal(await decodeFrame(stream, 5000), second);
}

await testSplitFrame();
await testBackToBackFrames();
console.log("Newshosting protocol tests passed");
