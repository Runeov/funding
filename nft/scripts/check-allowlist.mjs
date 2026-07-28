import { AbiCoder, concat, keccak256 } from 'ethers';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : join(projectRoot, 'allowlist', 'generated.json');
const generated = JSON.parse(await readFile(outputPath, 'utf8'));
const abiCoder = AbiCoder.defaultAbiCoder();

if (!Array.isArray(generated.entries) || generated.entries.length === 0) {
  throw new Error('Generated allowlist has no entries.');
}

let totalAllocation = 0;
for (const entry of generated.entries) {
  totalAllocation += entry.allocation;
  let computed = keccak256(
    keccak256(
      abiCoder.encode(
        ['address', 'uint256'],
        [entry.address, entry.allocation],
      ),
    ),
  );
  for (const sibling of entry.proof) {
    computed = hashPair(computed, sibling);
  }
  if (computed !== generated.root) {
    throw new Error(`Invalid proof for ${entry.address}.`);
  }
}

if (totalAllocation !== generated.totalAllocation) {
  throw new Error('Generated total allocation does not match its entries.');
}
if (totalAllocation > 150) {
  throw new Error('Generated allowlist allocation exceeds 150.');
}

console.log(
  `Validated ${generated.entries.length} allowlist proofs for root ${generated.root}.`,
);

function hashPair(left, right) {
  const [first, second] =
    BigInt(left) < BigInt(right) ? [left, right] : [right, left];
  return keccak256(concat([first, second]));
}
