import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(
  await readFile(join(projectRoot, 'config', 'collection.json'), 'utf8'),
);
const metadataDirectory = join(projectRoot, 'metadata', 'tokens');
const collectionMetadata = JSON.parse(
  await readFile(join(projectRoot, 'metadata', 'collection.json'), 'utf8'),
);
const files = (await readdir(metadataDirectory))
  .filter((name) => name.endsWith('.json'))
  .sort((left, right) => Number.parseInt(left) - Number.parseInt(right));

if (config.supply !== 150 || files.length !== config.supply) {
  throw new Error(
    `Expected exactly 150 metadata files; found ${files.length}.`,
  );
}

const names = new Set();
for (let tokenId = 1; tokenId <= config.supply; tokenId += 1) {
  const expectedFile = `${tokenId}.json`;
  if (files[tokenId - 1] !== expectedFile) {
    throw new Error(`Missing or misordered metadata file ${expectedFile}.`);
  }

  const metadata = JSON.parse(
    await readFile(join(metadataDirectory, expectedFile), 'utf8'),
  );
  const expectedName = `${config.name} #${String(tokenId).padStart(3, '0')}`;
  if (metadata.name !== expectedName) {
    throw new Error(`${expectedFile}: expected name ${expectedName}.`);
  }
  if (metadata.image !== config.imageUri) {
    throw new Error(`${expectedFile}: image URI does not match config.`);
  }
  if (metadata.description !== config.description) {
    throw new Error(`${expectedFile}: description does not match config.`);
  }
  if (metadata.external_url !== config.externalUrl) {
    throw new Error(`${expectedFile}: external URL does not match config.`);
  }
  if (names.has(metadata.name)) {
    throw new Error(`${expectedFile}: duplicate token name.`);
  }
  names.add(metadata.name);

  const editionNumber = metadata.attributes.find(
    (attribute) => attribute.trait_type === 'Edition Number',
  );
  if (
    editionNumber?.value !== tokenId ||
    editionNumber?.max_value !== config.supply
  ) {
    throw new Error(`${expectedFile}: invalid edition number attribute.`);
  }
  const editionLabel = metadata.attributes.find(
    (attribute) => attribute.trait_type === 'Edition',
  );
  if (
    editionLabel?.value !==
    `${String(tokenId).padStart(3, '0')} / ${config.supply}`
  ) {
    throw new Error(`${expectedFile}: invalid edition label attribute.`);
  }
  const traitNames = metadata.attributes.map(
    (attribute) => attribute.trait_type,
  );
  if (new Set(traitNames).size !== traitNames.length) {
    throw new Error(`${expectedFile}: duplicate trait type.`);
  }
  if (
    JSON.stringify(metadata.attributes.slice(2)) !==
    JSON.stringify(config.sharedAttributes)
  ) {
    throw new Error(`${expectedFile}: shared attributes do not match config.`);
  }
  if (
    metadata.properties?.collection !== config.name ||
    metadata.properties?.collection_size !== config.supply ||
    metadata.properties?.artwork_sha256 !== config.artworkSha256 ||
    metadata.properties?.utility_policy !== config.utilityPolicyUri ||
    metadata.properties?.utility_status !==
      'eligibility-subject-to-published-terms'
  ) {
    throw new Error(`${expectedFile}: properties do not match config.`);
  }
}

const artwork = await readFile(
  join(projectRoot, 'assets', 'kj-genesis-funder-key-master.png'),
);
if (
  artwork.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
  artwork.subarray(12, 16).toString('ascii') !== 'IHDR'
) {
  throw new Error('Master artwork is not a valid PNG with an IHDR header.');
}
const artworkWidth = artwork.readUInt32BE(16);
const artworkHeight = artwork.readUInt32BE(20);
if (artworkWidth === 0 || artworkWidth !== artworkHeight) {
  throw new Error(
    `Master artwork must be square; found ${artworkWidth}x${artworkHeight}.`,
  );
}
const actualArtworkHash = createHash('sha256').update(artwork).digest('hex');
if (actualArtworkHash !== config.artworkSha256.toLowerCase()) {
  throw new Error('Master artwork hash does not match collection config.');
}

if (
  collectionMetadata.name !== config.name ||
  collectionMetadata.description !== config.description ||
  collectionMetadata.image !== config.imageUri ||
  collectionMetadata.external_link !== config.externalUrl ||
  collectionMetadata.properties?.edition_size !== config.supply ||
  collectionMetadata.properties?.artwork_sha256 !== config.artworkSha256 ||
  collectionMetadata.properties?.utility_policy !== config.utilityPolicyUri
) {
  throw new Error('Collection-level metadata does not match collection config.');
}

console.log(
  `Validated 150 unique metadata files, collection metadata, and ${artworkWidth}x${artworkHeight} master artwork hash.`,
);
