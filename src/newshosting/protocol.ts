import { inflateSync, deflateSync } from "zlib";

export function encodeFrame(xml: string): Buffer {
  const xmlBytes = Buffer.from(xml, "utf8");
  const compressed = deflateSync(xmlBytes);
  const body = Buffer.allocUnsafe(4 + compressed.length);
  body.writeUInt32BE(xmlBytes.length, 0);
  compressed.copy(body, 4);
  return Buffer.concat([Buffer.from(`C${body.length}\r\n`, "ascii"), body]);
}

async function readExactly(stream: NodeJS.ReadableStream, size: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  while (total < size) {
    const chunk = stream.read(size - total) as Buffer | null;
    if (chunk) {
      chunks.push(chunk);
      total += chunk.length;
      continue;
    }

    await new Promise<void>((resolve, reject) => {
      const onReadable = () => cleanup(resolve);
      const onError = (error: Error) => cleanup(() => reject(error));
      const onEnd = () => cleanup(() => reject(new Error("newshosting_stream_ended")));
      const cleanup = (done: () => void) => {
        stream.off("readable", onReadable);
        stream.off("error", onError);
        stream.off("end", onEnd);
        done();
      };
      stream.once("readable", onReadable);
      stream.once("error", onError);
      stream.once("end", onEnd);
    });
  }

  return Buffer.concat(chunks, total);
}

export async function decodeFrame(stream: NodeJS.ReadableStream): Promise<string> {
  const headerBytes: number[] = [];
  while (true) {
    const byte = await readExactly(stream, 1);
    headerBytes.push(byte[0]);
    if (headerBytes.length >= 2 && headerBytes[headerBytes.length - 2] === 13 && headerBytes[headerBytes.length - 1] === 10) {
      break;
    }
  }

  const header = Buffer.from(headerBytes.slice(0, -2)).toString("ascii").trim();
  const bodyLength = Number.parseInt(header.startsWith("C") ? header.slice(1) : header, 10);
  if (!Number.isFinite(bodyLength) || bodyLength <= 4) {
    throw new Error("newshosting_invalid_frame_length");
  }

  const body = await readExactly(stream, bodyLength);
  return inflateSync(body.subarray(4)).toString("utf8");
}
