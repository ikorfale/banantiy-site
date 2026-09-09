import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ADDRESS = '6EGnm1Gw1KTKVPVvTkyazyTAboKDMaVMx7bG1kLMULq5';
const EXPLORER = `https://explorer.solana.com/address/${ADDRESS}`;
const paths = [
  'README.md',
  'MARKET-NOTES.md',
  'index.html',
  'public/services.json',
  '.github/ISSUE_TEMPLATE/service-request.yml',
];
const contents = new Map(await Promise.all(paths.map(async (path) => [path, await readFile(path, 'utf8')])));
const mainSource = await readFile('src/main.js', 'utf8');
const services = JSON.parse(contents.get('public/services.json'));

for (const [path, content] of contents) {
  assert.ok(content.includes(ADDRESS), `${path} must publish the exact receive address`);
  assert.ok(content.includes('Solana'), `${path} must name the Solana network`);
  assert.ok(content.includes('USDC') && content.includes('USDT'), `${path} must name both accepted assets`);
}

assert.equal(services.settlement.acceptingFunds, true);
assert.equal(services.settlement.address, ADDRESS);
assert.equal(services.settlement.network, 'Solana');
assert.equal(services.settlement.networkOnly, true);
assert.deepEqual(services.settlement.acceptedAssets, ['USDC', 'USDT']);
assert.equal(services.settlement.explorerUrl, EXPLORER);
assert.match(services.settlement.availabilityCondition, /written agreement/i);
assert.equal(services.settlement.warnings.length, 4);

const html = contents.get('index.html');
assert.match(html, /<code id="payment-address">6EGnm1Gw1KTKVPVvTkyazyTAboKDMaVMx7bG1kLMULq5<\/code>/);
assert.match(html, /data-copy-payment-address/);
assert.match(mainSource, /querySelector\('\[data-copy-payment-address\]'\)/);
assert.match(mainSource, /navigator\.clipboard\?\.writeText/);
assert.match(mainSource, /writeText\(address\)/);
assert.ok(html.includes(EXPLORER));
for (const phrase of [
  'Never send before written scope and price confirmation.',
  'small test transfer',
  'another network',
  'unsupported token',
  'Payment does not expand the agreed scope.',
]) assert.ok(html.includes(phrase), `homepage must include warning: ${phrase}`);

const stale = /payment (?:is )?inactive|payment not active|not accepting funds|no funds (?:are )?accepted|no wallet address|no address is published|"address"\s*:\s*null|"acceptingFunds"\s*:\s*false/i;
for (const [path, content] of contents) assert.doesNotMatch(content, stale, `${path} contains stale inactive-payment copy`);

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
let value = 0n;
for (const character of ADDRESS) {
  const index = alphabet.indexOf(character);
  assert.notEqual(index, -1, 'address must be base58');
  value = value * 58n + BigInt(index);
}
let bytes = 0;
for (let current = value; current > 0n; current >>= 8n) bytes += 1;
bytes += ADDRESS.match(/^1*/)[0].length;
assert.equal(bytes, 32, 'Solana address must decode to 32 bytes');

console.log(`Payment contract passed across ${paths.length} public surfaces for ${ADDRESS}.`);
