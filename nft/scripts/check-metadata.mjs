import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(
  await readFile(join(projectRoot, 'config', 'collection.json'), 'utf8'),
);
const metadataDirectory = join(projectRoot, 'metadata', 'tokens');
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
}

const artwork = await readFile(
  join(projectRoot, 'assets', 'kj-genesis-funder-key-master.png'),
);
const actualArtworkHash = createHash('sha256').update(artwork).digest('hex');
if (actualArtworkHash !== config.artworkSha256.toLowerCase()) {
  throw new Error('Master artwork hash does not match collection config.');
}

console.log('Validated 150 unique metadata files and the master artwork hash.');
