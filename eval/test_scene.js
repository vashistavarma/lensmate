// Unit tests for the spatial-context logic with a known desk layout (true-camera coordinates, 1204x672).
const S = require('../public/scene.js');
const objs = [
  { label: 'battery',  box: [100, 60, 300, 140] },     // upper left
  { label: 'Arduino',  box: [450, 80, 600, 170] },     // upper centre
  { label: 'phone',    box: [750, 60, 900, 200] },     // upper right
  { label: 'screwdriver', box: [200, 520, 700, 600] }, // lower, long
  { label: 'sensor',   box: [520, 330, 600, 380] },     // middle, small
  { label: 'tape',     box: [60, 300, 260, 480] },      // middle left, bigger
];
let fails = 0; const check = (name, ok, info) => { console.log(ok ? 'PASS' : 'FAIL', name, info || ''); if (!ok) fails++; };
const V = S.toView(objs, false), VM = S.toView(objs, true);

check('zone: battery is upper left', S.zone(V[0]) === 'upper left', S.zone(V[0]));
check('zone: Arduino is upper centre', S.zone(V[1]) === 'upper centre', S.zone(V[1]));
check('zone: sensor is centre', S.zone(V[4]) === 'centre', S.zone(V[4]));
check('size: sensor is small, tape is medium or large', S.size(V[4]) === 'small' && S.size(V[5]) !== 'small');
check('relation: battery is left of Arduino', S.leftOf(V[0], V[1]) && !S.leftOf(V[1], V[0]));
check('relation: phone is right of Arduino', S.rightOf(V[2], V[1]));
check('relation: Arduino is above the sensor', S.above(V[1], V[4]));
check('relation: screwdriver is below the sensor', S.below(V[3], V[4]));
check('mirrored view swaps left and right', S.zone(VM[0]) === 'upper right' && S.leftOf(VM[1], VM[0]), S.zone(VM[0]));
check('nearness: screwdriver (low, long) looks closest', [...V].sort((a, b) => S.nearness(b) - S.nearness(a))[0].label === 'screwdriver');

const A = (q, v = V) => S.answer(q, v);
check('"what is to the left of the Arduino?"', /Battery is to the left of the Arduino/.test(A('What is to the left of the Arduino?')), A('What is to the left of the Arduino?'));
check('"what is to the right of the battery?" picks the nearest', /Arduino is to the right of the battery/.test(A('what is to the right of the battery')), A('what is to the right of the battery'));
check('"what is below the Arduino?"', /below the Arduino/.test(A('What is below the Arduino?')), A('What is below the Arduino?'));
check('"what is above the screwdriver?"', /above the screwdriver/.test(A('what is above the screwdriver?')), A('what is above the screwdriver?'));
check('nothing there -> says so', /don't see anything to the left of the battery/.test(A('what is to the left of the battery')), A('what is to the left of the battery'));
check('mirrored: left of the battery now is the Arduino', /Arduino is to the left of the battery/.test(A('what is to the left of the battery', VM)), A('what is to the left of the battery', VM));
check('"what is next to the sensor?"', /is the closest to the sensor/.test(A('what is next to the sensor')), A('what is next to the sensor'));
check('"where is the phone?"', /phone is in the upper right/.test(A('Where is the phone?')), A('Where is the phone?'));
check('"how many objects are there?"', /6 labelled objects/.test(A('how many objects are there')), A('how many objects are there'));
check('"what is the closest object?"', /screwdriver looks closest/.test(A('what is the closest object?')), A('what is the closest object?'));
check('"what is the biggest object?"', /screwdriver looks the biggest/.test(A('what is the biggest thing')), A('what is the biggest thing'));
check('unknown object -> honest, not a guess', /don't see a laptop/.test(A('what is to the left of the laptop?')), A('what is to the left of the laptop?'));
check('"where are my keys" (not labelled) is left to the model', A('where are my keys') === null);
check('a non-spatial question is not intercepted', A('What colour is the battery?') === null && !S.isSpatial('What colour is the battery?'));
check('isSpatial catches spatial wording', S.isSpatial('is the sensor next to the tape?') && S.isSpatial('what is behind it'));
const d = S.describe(V, 'sitting in the lower right, next to the screwdriver');
check('describe(): lists objects, zones, closest/farthest and the companion', /battery \(upper left/.test(d) && /Looks closest to the camera: screwdriver/.test(d) && /companion \(you\) is sitting/.test(d), d.slice(0, 120) + '...');
check('describe(): empty when nothing is labelled', S.describe([]) === '');
process.exit(fails ? 1 : 0);
