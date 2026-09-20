/**
 * test-match-rules.mjs — unit tests for the Commons matching rules.
 *
 * These rules decide which photograph lands on a species card, and they are the
 * part of the fetcher most likely to be wrong. The first live run produced two
 * false positives that would have silently rejected legitimate photographs:
 *
 *   - "…- geograph.org.uk - 3881775.jpg" tripped a substring match on "graph"
 *   - "Cuvier's Beaked Whale (Ziphius cavirostris).jpg" tripped one on "beak"
 *     — the correct name of the very species being searched for
 *
 * Both are regression cases below. The suite is offline: it exercises the pure
 * predicate, not the network.
 *
 *   node scripts/test-match-rules.mjs
 */
import { nonPhotoReason, licenceVerdict, chooseFile } from './fetch-species-images.mjs';

let passed = 0;
let failed = 0;

function expectAccept(title, why = '') {
  const reason = nonPhotoReason(title.toLowerCase());
  if (reason === null) {
    passed++;
    console.log(`[  ok  ] accepts  ${why || title.slice(0, 68)}`);
  } else {
    failed++;
    console.log(`[ FAIL ] REJECTED a real photograph: ${title}`);
    console.log(`         reason given: ${reason}`);
  }
}

function expectReject(title, why = '') {
  const reason = nonPhotoReason(title.toLowerCase());
  if (reason !== null) {
    passed++;
    console.log(`[  ok  ] rejects  ${(why || title.slice(0, 52)).padEnd(54)} (${reason})`);
  } else {
    failed++;
    console.log(`[ FAIL ] ACCEPTED a non-photograph: ${title}`);
  }
}

console.log('\n── Photographs that must be accepted ─────────────────────────────');
expectAccept('File:Cuvier\u2019s Beaked Whale (Ziphius cavirostris).jpg', 'Beaked Whale — "beak" regression');
expectAccept('File:Sperm Whale (Physeter macrocephalus), Whiteness Voe - geograph.org.uk - 7126937.jpg', 'geograph.org.uk — "graph" regression');
expectAccept('File:Tibur\u00f3n azul (Prionace glauca), canal Fayal-Pico, islas Azores, Portugal, 2020-07-27, DD 07.jpg', 'a modern date, not a publication year');
expectAccept('File:Somniosus microcephalus okeanos.jpg', 'NOAA Okeanos Explorer');
expectAccept('File:Scotoplanes globosa and crab.jpg', 'live sea pig with a crab');
expectAccept('File:Hal - Melanocetus johnsonii - 4.jpg', 'Ifremer anglerfish');
expectAccept('File:Campagne GEOCYTHERM - Vers g\u00e9ants (Riftia Pachyptila) (Ifremer 00795-90701).jpg', 'Ifremer tube worms');
expectAccept('File:Architeuthis dux 68146399.jpg', 'iNaturalist-style observation id');
expectAccept('File:Megachasma pelagios Megamouth Shark.png', 'plain name');

console.log('\n── Files that must be rejected ───────────────────────────────────');
expectReject('File:Stamp of Abkhazia - 1998 - Colnect 1000871 - Macropinna microstoma.jpeg', 'a postage stamp');
expectReject('File:Mola mola (muerto).006 - Praia de Ril (Burela).jpg', 'a dead sunfish');
expectReject('File:Larus michahellis (juveniles) comiendo Mola mola (muerto).003.jpg', 'gulls eating a corpse');
// A stranded carcass is a genuine photograph, but not of the LIVING animal,
// which is what an atlas card is for — the same reasoning that rejects the dead
// sunfish above.
expectReject('File:Dead Sperm Whale (Physeter macrocephalus), Scolla Wick - geograph.org.uk - 3881775.jpg', 'a stranded carcass');
expectReject('File:Mesonychoteuthis hamiltoni beak.jpg', 'a beak, not the animal');
expectReject('File:Architeuthis dux tentacular club 04.jpg', 'a tentacle club');
expectReject('File:Architeuthis dux holotype (sucker).png', 'a sucker');
expectReject('File:Architeuthis dux Verrill 1882.jpg', 'an 1882 illustration');
expectReject('File:Kiwa hirsuta (MNHN-IU-2010-1683) 001.jpeg', 'MNHN accession code');
expectReject('File:Scotoplanes globosa (USNM E27694).jpeg', 'USNM accession code');
expectReject('File:Pseudoliparis swirei (10.11646-zootaxa.4358.1.7) Figure 4.jpg', 'a paper figure');
expectReject('File:Somniosus microcephalus distmap.png', 'a distribution map');
expectReject('File:Anoplogaster cornuta X-ray.jpg', 'an x-ray');
expectReject('File:Skeleton of Sperm Whale (Physeter macrocephalus), Lee Kong Chian Natural History Museum.jpg', 'a skeleton');
expectReject('File:Macropinna microstoma illustration.png', 'an illustration');
expectReject('File:Vampyroteuthis infernalis Chun 1910.jpg', 'a 1910 plate');

/* ------------------------------------------------------------------ *
 * Group taxa — the bug that starved three cards of photographs
 * ------------------------------------------------------------------ */

/**
 * A catalogue entry is not always a species. Three are groups:
 *
 *   dumbo-octopus   Grimpoteuthis spp.   a genus
 *   lanternfish     Myctophidae spp.     a family
 *   brittle-star    Ophiuroidea spp.     a class
 *
 * The matcher required a filename to contain the binomial "Grimpoteuthis spp.",
 * which no file is ever called, so all three came back empty while Commons held
 * "Grimpoteuthis umbellata.jpg" at 2566 px in the public domain.
 */
function fakePage(title, { width = 2000, licence = 'Public domain', artist = 'A Photographer' } = {}) {
  return {
    title,
    imageinfo: [
      {
        mime: 'image/jpeg',
        width,
        height: 1200,
        thumburl: 'https://upload.wikimedia.org/thumb.jpg',
        descriptionurl: 'https://commons.wikimedia.org/wiki/' + title,
        extmetadata: {
          LicenseShortName: { value: licence },
          Artist: { value: artist },
        },
      },
    ],
  };
}

console.log('\n── Group taxa (genus / family / class entries) ───────────────────');

{
  const pages = [
    fakePage('File:Kiwa Station (Wakayama), ekisha.jpg'), // unrelated place
    fakePage('File:Grimpoteuthis.jpg', { licence: 'CC BY-SA 3.0', width: 1535 }),
    fakePage('File:Grimpoteuthis umbellata.jpg', { width: 2566 }),
    fakePage('File:Grimpoteuthis discoveryi.jpg', { width: 2272 }),
  ];
  const pick = chooseFile(pages, 'Grimpoteuthis spp.');
  const ok = pick && /Grimpoteuthis/.test(pick.title);
  if (ok) {
    passed++;
    console.log(`[  ok  ] genus entry matches on the genus — picked "${pick.title.replace(/^File:/, '')}"`);
  } else {
    failed++;
    console.log(`[ FAIL ] genus entry matched nothing: ${pick ? pick.title : 'null'}`);
  }
}

{
  const pages = [
    fakePage('File:Ophiura ophiura.jpg'), // a different genus
    fakePage('File:Ophiuroidea-Slangsterren.jpg', { licence: 'CC BY-SA 4.0', width: 800 }),
  ];
  const pick = chooseFile(pages, 'Ophiuroidea spp.');
  const ok = pick && /Ophiuroidea/.test(pick.title);
  if (ok) {
    passed++;
    console.log(`[  ok  ] class entry matches on the class — picked "${pick.title.replace(/^File:/, '')}"`);
  } else {
    failed++;
    console.log(`[ FAIL ] class entry matched nothing: ${pick ? pick.title : 'null'}`);
  }
}

{
  // The rule that protects species must survive: a genus-only title is still
  // not enough when the catalogue names a particular species.
  const pages = [fakePage('File:Melanocetus.jpg'), fakePage('File:Melanocetus johnsonii.jpg')];
  const pick = chooseFile(pages, 'Melanocetus johnsonii');
  const ok = pick && /johnsonii/.test(pick.title);
  if (ok) {
    passed++;
    console.log('[  ok  ] species entry still refuses a genus-only title');
  } else {
    failed++;
    console.log(`[ FAIL ] species entry accepted a genus-only title: ${pick ? pick.title : 'null'}`);
  }
}

{
  // And a species with no correct photo must yield nothing, not a relative.
  const pages = [fakePage('File:Melanocetus.jpg'), fakePage('File:Melanocetus niger.jpg')];
  const pick = chooseFile(pages, 'Melanocetus johnsonii');
  if (pick === null) {
    passed++;
    console.log('[  ok  ] species entry returns null rather than a different species');
  } else {
    failed++;
    console.log(`[ FAIL ] species entry accepted the wrong species: ${pick.title}`);
  }
}

console.log('\n── Common-name fallback (tagged, never silent) ───────────────────');

{
  // Scientific name finds nothing, but the common name does — as with
  // "Barreleye-fish GoK.jpg", public domain at 4000 px, which was the only
  // usable candidate for Macropinna microstoma.
  const pages = [fakePage('File:Barreleye-fish GoK.jpg', { width: 4000 })];
  const pick = chooseFile(pages, 'Macropinna microstoma', { commonName: 'Barreleye' });
  if (pick && pick.matchedOn === 'common-name') {
    passed++;
    console.log(`[  ok  ] falls back to the common name and tags it ("${pick.title.replace(/^File:/, '')}")`);
  } else {
    failed++;
    console.log(`[ FAIL ] common-name fallback did not fire or was untagged: ${JSON.stringify(pick && pick.matchedOn)}`);
  }
}

{
  // The fallback must not fire when the scientific name already matched.
  const pages = [
    fakePage('File:Macropinna microstoma.jpg', { width: 900 }),
    fakePage('File:Barreleye-fish GoK.jpg', { width: 4000 }),
  ];
  const pick = chooseFile(pages, 'Macropinna microstoma', { commonName: 'Barreleye' });
  if (pick && pick.matchedOn === 'scientific' && /microstoma/.test(pick.title)) {
    passed++;
    console.log('[  ok  ] a scientific match always wins over the fallback');
  } else {
    failed++;
    console.log(`[ FAIL ] fallback overrode a scientific match: ${pick && pick.title}`);
  }
}

{
  // Without a common name supplied there is no fallback at all — the fetcher
  // must not invent one.
  const pages = [fakePage('File:Barreleye-fish GoK.jpg', { width: 4000 })];
  const pick = chooseFile(pages, 'Macropinna microstoma');
  if (pick === null) {
    passed++;
    console.log('[  ok  ] no fallback when no common name is supplied');
  } else {
    failed++;
    console.log(`[ FAIL ] matched without a common name: ${pick.title}`);
  }
}

console.log('\n── Licence gate ──────────────────────────────────────────────────');const licences = [
  ['CC0', true],
  ['Public domain', true],
  ['CC BY-SA 4.0', true],
  ['CC BY 4.0', true],
  ['CC BY-NC 4.0', false],
  ['CC BY-ND 3.0', false],
  ['Fair use', false],
  ['', false],
];
for (const [name, ok] of licences) {
  const verdict = licenceVerdict(name);
  if (verdict.ok === ok) {
    passed++;
    console.log(`[  ok  ] ${ok ? 'accepts' : 'rejects'}  ${name || '(empty)'}`);
  } else {
    failed++;
    console.log(`[ FAIL ] ${name || '(empty)'} -> ok=${verdict.ok}, expected ${ok}`);
  }
}

console.log(`\n${'─'.repeat(64)}`);
if (failed === 0) console.log(`\x1b[32mALL PASSED\x1b[0m — ${passed} assertions\n`);
else console.log(`\x1b[31m${failed} FAILED\x1b[0m of ${passed + failed}\n`);
process.exit(failed === 0 ? 0 : 1);
