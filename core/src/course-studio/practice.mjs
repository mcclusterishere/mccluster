import { createHash } from 'node:crypto';
import { selectChapters } from './chapters.mjs';

// Every question, distractor and explanation is authored here, not scraped
// from the books. Retry is repeatable but different courses draw new data.
function drawer(courseId, topic) {
  let index = 0;
  return (min, max) => min + createHash('sha256')
    .update(`course-study/v1:${courseId}:${topic}:${index++}`).digest().readUInt32BE() % (max - min + 1);
}

function multipleChoice(draw, source, prompt, correct, mistakes, explanation) {
  const values = [...new Set([correct, ...mistakes])];
  for (let step = 1; values.length < 4; step++) if (!values.includes(correct + step)) values.push(correct + step);
  const choices = values.slice(0, 4);
  for (let i = choices.length - 1; i > 0; i--) {
    const j = draw(0, i);
    [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  return { prompt, choices: choices.map(String), answer: choices.indexOf(correct), explanation, source };
}

function algebra(draw, source) {
  const start = draw(15, 30), speed = draw(2, 8), minutes = draw(3, 9);
  const m = draw(2, 8) * (draw(0, 1) ? 1 : -1), x = draw(2, 6), dx = draw(2, 6), b = draw(3, 15);
  const y = m * x + b, y2 = m * (x + dx) + b;
  const a = draw(2, 7), offset = draw(3, 15), target = draw(3, 12), output = a * target + offset;
  const round = (prompt, answer, mistakes, explanation) => multipleChoice(draw, source, prompt, answer, mistakes, explanation);
  return {
    brief: [
      'A straight-line model has one rate of change. Subtract the two outputs, then divide by the corresponding change in input, keeping the points in the same order.',
      'In y = mx + b, b is the output at input zero. To recover an unknown input, subtract the starting value b before dividing by the nonzero rate m.',
    ],
    rounds: [
      round(`A line passes through (${x}, ${y}) and (${x + dx}, ${y2}). What is its slope?`,
        m, [m * dx, -m, m + dx], `The output changes by ${y2 - y} as the input changes by ${dx}. Slope = ${y2 - y} / ${dx} = ${m}.`),
      round(`A straight line has slope ${m} and passes through (${x}, ${y}). What is its y-intercept?`,
        b, [y + m * x, y - m, y], `At x = ${x}, the slope accounts for ${m * x} units of the output. Subtract that contribution from ${y} to get ${b}.`),
      round(`A tank starts with ${start} liters. Water flows in at ${speed} liters per minute. How many liters are in it after ${minutes} minutes?`,
        start + speed * minutes, [speed * minutes, start + speed + minutes, start * minutes],
        `In ${minutes} minutes the tank gains ${speed} × ${minutes} = ${speed * minutes} liters. Add the starting ${start} liters to get ${start + speed * minutes}.`),
      round(`A workshop charges ${offset} credits to set up and ${a} credits per print. A bill totals ${output} credits. How many prints were made?`,
        target, [output - offset, target + offset, target * a],
        `Remove the setup charge: ${output} − ${offset} = ${target * a}. Divide the remaining cost by ${a} credits per print to get ${target}.`),
    ],
  };
}

function calculus(draw, source) {
  const n = draw(3, 6), x = draw(2, 4), factor = draw(2, 8);
  const a = draw(2, 6), b = draw(2, 8), c = draw(5, 18), t = draw(2, 5);
  const constant = draw(5, 20), slope = draw(2, 8), intercept = draw(10, 25);
  const round = (prompt, answer, mistakes, explanation) => multipleChoice(draw, source, prompt, answer, mistakes, explanation);
  return {
    brief: [
      'A derivative gives the tangent-line slope at a chosen input. For a positive integer power, multiply by the exponent and reduce the exponent by one before substituting the input.',
      'Differentiate a sum term by term, keeping constant factors. A term that is constant by itself contributes zero: shifting a graph straight up does not tilt its tangent.',
    ],
    rounds: [
      round(`For f(x) = ${factor}x^${n}, what is the slope of the tangent at x = ${x}?`,
        factor * n * x ** (n - 1), [factor * x ** n, n * x ** (n - 1), factor * x ** (n - 1)],
        `First differentiate: f′(x) = ${factor * n}x^${n - 1}. Substituting ${x} gives ${factor * n * x ** (n - 1)}.`),
      round(`A cart's position in meters is s(t) = ${a}t² + ${b}t + ${c}. What is its instantaneous speed in m/s at t = ${t} seconds?`,
        2 * a * t + b, [a * t * t + b * t + c, 2 * a * t, 2 * a * t + c],
        `The velocity function is s′(t) = ${2 * a}t + ${b}. At ${t} seconds the velocity is positive, so its magnitude (speed) is ${2 * a * t + b} m/s.`),
      round(`A signal has the constant value g(t) = ${constant}. What is g′(${t})?`,
        0, [constant, 1, t], `The signal never changes from ${constant}. Every secant and tangent is horizontal, so the rate is 0.`),
      round(`A sensor is modeled by h(x) = ${slope}x + ${intercept}. What is h′(${x})?`,
        slope, [intercept, slope * x + intercept, slope * x],
        `The term ${slope}x changes by ${slope} for each unit change in x, and the constant contributes 0. The derivative is ${slope} at every x.`),
    ],
  };
}

// Ordinary isotope notation and arithmetic only. These are stable isotopes and
// common ion charges, not invented sets of particles or laboratory directions.
const species = [
  ['magnesium', 12, [24, 25, 26], 2], ['chlorine', 17, [35, 37], -1],
  ['calcium', 20, [40, 42, 44], 2], ['oxygen', 8, [16, 17, 18], -2],
  ['potassium', 19, [39, 41], 1], ['sodium', 11, [23], 1],
];

function chemistry(draw, source) {
  const at = draw(0, species.length - 1);
  const [name, z, masses] = species[at], mass = masses[draw(0, masses.length - 1)];
  const [other, p, isotopes] = species[(at + 1) % species.length];
  const m = isotopes[draw(0, isotopes.length - 1)], neutrons = m - p;
  const [, ionZ, , charge] = species[(at + 2) % species.length];
  const [, ionP, , q] = species[(at + 3) % species.length], e = ionP - q;
  const round = (prompt, answer, mistakes, explanation) => multipleChoice(draw, source, prompt, answer, mistakes, explanation);
  return {
    brief: [
      'Atomic number Z counts protons. Mass number A counts protons and neutrons together, so the neutron count is A − Z. Isotopes keep Z but differ in neutron count.',
      'In units of elementary charge, q = protons − electrons. A positive ion has fewer electrons than protons; a negative ion has extra electrons. Changing the electron count does not change the mass number.',
    ],
    rounds: [
      round(`A ${name} isotope has atomic number ${z} and mass number ${mass}. How many neutrons does it contain?`,
        mass - z, [z, mass, mass + z], `Of its ${mass} nuclear particles, ${z} are protons. The other ${mass} − ${z} = ${mass - z} are neutrons.`),
      round(`A ${other} atom has ${p} protons and ${neutrons} neutrons. What mass number goes beside its symbol?`,
        m, [p, neutrons, m + 1], `Count each proton and neutron once: A = ${p} + ${neutrons} = ${m}. Electrons are not part of this count.`),
      round(`An ion has atomic number ${ionZ} and charge ${charge > 0 ? '+' : ''}${charge}. How many electrons does it have?`,
        ionZ - charge, [ionZ, ionZ + charge, ionZ * 2], `The atomic number gives ${ionZ} protons. A charge of ${charge} means ${Math.abs(charge)} ${charge > 0 ? 'fewer' : 'more'} electrons than protons: ${ionZ - charge} electrons.`),
      round(`An ion has ${ionP} protons and ${e} electrons. What is its signed charge in elementary-charge units?`,
        q, [-q, 0, e], `Positive contributions minus negative contributions gives ${ionP} − ${e} = ${q}. Its charge is ${q > 0 ? 'positive' : 'negative'}.`),
    ],
  };
}

const lessons = { algebra, calculus, chemistry };
export function buildPractice(courseId, sources) {
  const chapters = selectChapters(sources.map(s => s.url));
  const bundle = { version: 1, brief: [], rounds: [], sources };
  for (const chapter of chapters) {
    const topic = chapter.topic;
    const lesson = lessons[topic](drawer(courseId, topic), chapter.url);
    bundle.brief.push(...lesson.brief.map(text => ({ text, source: chapter.url })));
    bundle.rounds.push(...lesson.rounds);
  }
  return bundle;
}
