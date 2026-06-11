import { createNewshostingNzb } from "./direct";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

(async () => {
  const input = JSON.parse(await readStdin());
  const nzb = await createNewshostingNzb(input.encodedId, input.userConfig);
  process.stdout.write(nzb);
})().catch(error => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
