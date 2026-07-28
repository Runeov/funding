import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(projectRoot, 'config', 'collection.json');
const outputDirectory = join(projectRoot, 'metadata', 'tokens');
const collectionOutput = join(projectRoot, 'metadata', 'collection.json');

const config = JSON.parse(await readFile(configPath, 'utf8'));

if (!Number.isSafeInteger(config.supply) || config.supply !== 150) {
  throw new Error('Collection supply must be exactly 150.');
}
if (!String(config.imageUri).startsWith('ipfs://')) {
  throw new Error('imageUri must use an ipfs:// URI.');
}
if (!/^[0-9a-f]{64}$/i.test(config.artworkSha256)) {
  throw new Error('artworkSha256 must be a 64-character SHA-256 hex digest.');
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (let tokenId = 1; tokenId <= config.supply; tokenId += 1) {
  const edition = String(tokenId).padStart(3, '0');
  const metadata = {
    name: `${config.name} #${edition}`,
    description: config.description,
    image: config.imageUri,
    external_url: config.externalUrl,
    attributes: [
      {
        display_type: 'number',
        trait_type: 'Edition Number',
        value: tokenId,
        max_value: config.supply,
      },
      {
        trait_type: 'Edition',
        value: `${edition} / ${config.supply}`,
      },
      ...config.sharedAttributes,
    ],
    properties: {
      collection: config.name,
      collection_size: config.supply,
      artwork_sha256: config.artworkSha256,
      utility_policy: config.utilityPolicyUri,
      utility_status: 'eligibility-subject-to-published-terms',
    },
  };

  await writeFile(
    join(outputDirectory, `${tokenId}.json`),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
}

await mkdir(dirname(collectionOutput), { recursive: true });
await writeFile(
  collectionOutput,
  `${JSON.stringify(
    {
      name: config.name,
      description: config.description,
      image: config.imageUri,
      external_link: config.externalUrl,
      seller_fee_basis_points: 0,
      fee_recipient: '0x0000000000000000000000000000000000000000',
      properties: {
        edition_size: config.supply,
        artwork_sha256: config.artworkSha256,
        utility_policy: config.utilityPolicyUri,
      },
    },
    null,
    2,
  )}\n`,
);

console.log(`Generated ${config.supply} token metadata files in ${outputDirectory}`);
