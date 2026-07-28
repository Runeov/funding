import { AbiCoder, concat, getAddress, keccak256 } from 'ethers';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const inputPath = process.argv[2]
  ? join(process.cwd(), process.argv[2])
  : join(projectRoot, 'config', 'allowlist.example.json');
const outputPath = process.argv[3]
  ? join(process.cwd(), process.argv[3])
  : join(projectRoot, 'allowlist', 'generated.json');

const entries = JSON.parse(await readFile(inputPath, 'utf8'));
if (!Array.isArray(entries) || entries.length === 0) {
  throw new Error('Allowlist must contain at least one entry.');
}

const normalized = entries.map((entry, index) => {
  const address = getAddress(entry.address);
  const allocation = Number(entry.allocation);
  if (
    !Number.isSafeInteger(allocation) ||
    allocation < 1 ||
    allocation > 150
  ) {
    throw new Error(`Entry ${index}: allocation must be an integer from 1 to 150.`);
  }
  return {
    address,
    allocation,
    label: String(entry.label ?? ''),
  };
});

const uniqueAddresses = new Set(
  normalized.map((entry) => entry.address.toLowerCase()),
);
if (uniqueAddresses.size !== normalized.length) {
  throw new Error('Allowlist contains duplicate addresses.');
}

const totalAllocation = normalized.reduce(
  (sum, entry) => sum + entry.allocation,
  0,
);
if (totalAllocation > 150) {
  throw new Error(`Total allowlist allocation ${totalAllocation} exceeds 150.`);
}

const abiCoder = AbiCoder.defaultAbiCoder();
const leaves = normalized.map((entry) =>
  keccak256(
    keccak256(
      abiCoder.encode(
        ['address', 'uint256'],
        [entry.address, entry.allocation],
      ),
    ),
  ),
);
const layers = [leaves];

while (layers.at(-1).length > 1) {
  const current = layers.at(-1);
  const next = [];
  for (let index = 0; index < current.length; index += 2) {
    const left = current[index];
    const right = current[index + 1];
    next.push(right === undefined ? left : hashPair(left, right));
  }
  layers.push(next);
}

const root = layers.at(-1)[0];
const proofs = normalized.map((entry, leafIndex) => {
  const proof = [];
  let index = leafIndex;
  for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex += 1) {
    const layer = layers[layerIndex];
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    if (siblingIndex < layer.length) {
      proof.push(layer[siblingIndex]);
    }
    index = Math.floor(index / 2);
  }
  return { ...entry, proof };
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      root,
      totalAllocation,
      entries: proofs,
      tree: {
        format: 'double-keccak256-abi-address-uint256/sorted-pairs/v1',
        layers,
      },
    },
    null,
    2,
  )}\n`,
);

console.log(`Generated allowlist root ${root} for ${normalized.length} wallets.`);

function hashPair(left, right) {
  const [first, second] =
    BigInt(left) < BigInt(right) ? [left, right] : [right, left];
  return keccak256(concat([first, second]));
}
