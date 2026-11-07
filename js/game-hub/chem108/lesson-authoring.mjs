/* Owner authoring definitions. Parent arrays are ORIGINAL RDKit atom indices in naming order.
   Family templates add explanation scaffolding, never infer a name from a string or add assessment items.
   The owner editor uses compileLesson for both shipped local-review versions and edited draft previews. */
import { GRAPHS } from './validated-graphs.mjs';
const specs = [];
const add = (id, family, parent, focus, naming, trap) => specs.push({id:'m'+id,family,parent,focus,naming,trap});
const seq = n => Array.from({length:n},(_,i)=>i);
const alkaneNames=['ethane','propane','butane','pentane','hexane','heptane','octane'];
for(let i=1;i<=7;i++) add(i,'alkane',seq(i+1),seq(i+1),`The continuous chain has ${i+1} carbons. Its root is ${['eth','prop','but','pent','hex','hept','oct'][i-1]}-, and all carbon–carbon bonds are single, so use -ane: ${alkaneNames[i-1]}. Both numbering directions describe the same unbranched chain; no position number is needed.`,`There are ${i} carbon–carbon connections but ${i+1} carbon atoms. Count both ends and every bend, not the drawn line segments.`);
add(8,'alkene',[0,1],[0,1],'Two carbons give eth-. One C=C gives -ene: ethene. The double bond can only lie between these two carbons, so no locant is needed.','Two parallel strokes are one double bond between two atoms, not two separate carbon chains.');
add(9,'alkene',[0,1,2],[0,1],'Three carbons give prop-. C1=C2 gives propene. A double bond numbered from the other end would be at 2; choose 1. The course also accepts prop-1-ene and 1-propene.','Propene has one double bond; propane has only single bonds. The missing a/e difference represents different bonding.');
add(10,'alkene',seq(4),[0,1],'Four carbons give but-. Number from the double-bond end: C1=C2, not C3=C4. The lower numbered end of that bond gives 1: but-1-ene.','The 1 locates the start of the double bond. It does not count the double bonds.');
add(11,'alkene',seq(6),[0,1],'Six carbons give hex-. The double bond connects C1 and C2 when numbered from the nearer end. Assemble hex-1-ene, not hex-5-ene.','The chain has six carbons even though only five connections join them.');
add(12,'alkyne',[0,1],[0,1],'Two carbons give eth-. The C≡C triple bond gives -yne: ethyne. No position number is necessary. Acetylene is also accepted by this course.','Three parallel strokes join the same pair of carbons. They do not represent three carbons.');
add(13,'alkyne',[0,1,2],[0,1],'Three carbons give prop-. Number from the triple-bond end, placing C≡C at C1–C2. The course answer is propyne, also accepting prop-1-yne and 1-propyne.','The internal triple-bond carbon has no hydrogen: a triple bond plus a single bond already supplies bond order four.');
add(14,'alkyne',seq(4),[1,2],'Four carbons give but-. The triple bond connects C2 and C3 from either end: but-2-yne.','Both triple-bond carbons have no hydrogen here. Do not add H just because an atom is unlabeled.');
add(15,'alkyne',seq(7),[2,3],'Seven carbons give hept-. The triple bond starts at 3 from one end and 4 from the other. Choose the lower locant: hept-3-yne.','Use the lower numbered carbon of the triple bond, not its midpoint or the number of lines in it.');
add(16,'diene',seq(4),[0,1,2,3],'Four carbons form the parent. Double bonds connect C1=C2 and C3=C4. Two double bonds give diene; retain the connecting a in buta-1,3-diene.','The 1,3 list gives two bond positions; di- gives the count. A single -ene would omit one double bond.');
add(17,'branched',[0,1,3],[1,2],'The longest non-repeating carbon path contains three atoms, so the parent is propane. One carbon remains as a methyl branch at C2: 2-methylpropane.','Four total carbons do not make this butane. A parent chain cannot visit the central atom twice to gather every arm.');
add(18,'branched',[0,1,3,4],[1,2],'Four carbons form the longest chain: butane. The remaining CH3 branch is methyl on C2, rather than C3 from the other end: 2-methylbutane.','Keep the branch separate from the parent count: four parent carbons plus one branch carbon gives five total.');
add(19,'branched',[0,1,4],[1,2,3],'The longest chain has three carbons: propane. Two separate methyl branches attach to C2. Repeat the locant and use di-: 2,2-dimethylpropane.','The central carbon has four carbon neighbors and zero hydrogens. Counting all five carbons as one chain would require revisiting that center.');
add(20,'branched',[0,1,3,5,6],[1,2,3,4],'The longest chain has five carbons: pentane. Methyl branches are on C2 and C3. Reverse numbering gives 3,4; 2,3 is lower at the first difference. Assemble 2,3-dimethylpentane.','Compare the ordered locant sets at the first difference; do not choose numbering just from how the drawing faces.');
add(21,'branched',[0,1,2,5,6],[2,3,4],'Choose a five-carbon path as pentane. The remaining two-carbon arm is an ethyl branch attached at C3: 3-ethylpentane. Equivalent longest paths give the same name.','The seven total carbons are not one continuous seven-carbon path. An ethyl branch contains two carbons; methyl contains one.');
add(22,'haloalkane',[0,1,3,4],[1,2],'Four carbons give butane. Chlorine is named as the prefix chloro-. Number it at C2 instead of C3: 2-chlorobutane.','Cl is one chlorine atom, not C followed by another atom. This card specifies connectivity without assigning an R/S configuration.');
add(23,'haloalkane',[1,2,3],[0,1],'Three carbons give propane. Start at the bromine-bearing end so Br is on C1: 1-bromopropane.','Br is bromine, not an extra carbon endpoint. The parent still has three carbons.');
add(24,'alcohol',[0],[0,1],'One carbon gives the parent methane. Replace its final e with ol: methanol. There is only one carbon on which OH could sit, so no locant is needed.','The oxygen label does not add another carbon. The OH hydrogen contributes to CH4O, but not to the carbon count.');
add(25,'alcohol',[1,0],[1,2],'Two carbons give ethane. Replace its final e with ol: ethanol. Number the OH-bearing carbon first; either end of an unsubstituted two-carbon chain is equivalent before OH is attached.','Do not count the written O as a third carbon. Ethanol contains two carbons and one oxygen.');
add(26,'alcohol',[2,1,0],[2,3],'Three carbons give propane. Number from the OH-bearing end to put OH on C1, not C3. Replace the final e and give the OH position: propan-1-ol.','This has the same formula as propan-2-ol but OH is at an end. A molecular formula alone does not identify the connections.');
add(27,'alcohol',[0,1,3],[1,2],'Three carbons give propane. Number either way: OH is on C2. Replace the final e with -2-ol: propan-2-ol. There are no carbon branches.','Propan-1-ol has OH on an end carbon. Here it is on the middle carbon. The number 2 locates OH; it does not mean two oxygens.');
add(28,'aldehyde',[1,0],[1,2],'Count the carbonyl carbon as C1. Two carbons give ethan-, and the terminal CHO group gives -al: ethanal.','The carbonyl carbon has a hidden hydrogen here. A C=O at an end with H is an aldehyde, not the ketone found between two carbon groups.');
add(29,'aldehyde',[2,1,0],[2,3],'Start at the CHO carbon as C1. The parent has three carbons, including that carbonyl carbon. Propan- plus -al gives propanal.','Do not leave the carbonyl carbon out of the parent count. It is a carbon even though it is bonded to oxygen.');
add(30,'ketone',[0,1,3],[1,2],'Three carbons form the parent. The carbonyl C=O is on C2 and is bonded to carbon groups on both sides: a ketone. Assemble propan-2-one.','The oxygen has no hydrogen here; C=O differs from C–OH. Propan-2-ol is an alcohol with different bonding and formula.');
add(31,'ketone',[0,1,3,4],[1,2],'Four carbons give butan-. Number from the end nearer C=O: carbonyl carbon C2 instead of C3. The ketone suffix gives butan-2-one.','The position number belongs to the carbonyl carbon, not to the oxygen.');
add(32,'acid',[1,0],[1,2,3],'The COOH carbon is C1 and belongs to the parent chain. Two carbons give ethanoic acid. The course also accepts acetic acid.','COOH contains both C=O and O–H on the same carbon. Naming only the OH part as an alcohol misses the carboxylic acid group.');
add(33,'acid',[2,1,0],[2,3,4],'The COOH carbon is C1. Three carbons including it give propanoic acid. The course also accepts propionic acid.','The carbon inside COOH counts toward the parent; the two oxygens do not.');
add(34,'ester',[1,0],[1,2,3,4,5],'Split the name at the ester oxygen: O–CH2–CH3 is ethyl. The acid-derived part has two carbons including C=O and is ethanoate. Write ethyl ethanoate as two words.','There are four total carbons, but they do not form a four-carbon parent through oxygen. The ester oxygen has no H; it continues to ethyl.');
add(35,'ether',[2,3],[0,1,2],'The longer carbon group is ethane. The other side of oxygen is one carbon, giving methoxy-. Together the ether is methoxyethane; the two ethane ends are equivalent.','Oxygen is between two carbon groups and has no hydrogen here. This is not an alcohol and contains no C=O.');
add(36,'amine',[1,0],[1,2],'Two carbons give ethan-. NH2 attached to this chain gives the suffix -amine: ethanamine. Ethylamine is also accepted by the course.','The nitrogen is not attached to a carbonyl carbon. That distinguishes this amine from an amide.');
add(37,'amide',[1,0],[1,2,3],'The parent has two carbons, including C=O. Nitrogen is directly attached to that carbonyl carbon, making an amide. Assemble ethanamide.','Do not call every NH2 group an amine: first check whether N is directly attached to C=O.');
add(38,'cycloalkane',seq(3),seq(3),'Three carbons make a closed ring. Add cyclo- to propane: cyclopropane. With no substituents, a starting carbon does not need to be specified.','There are three corners and no open-chain endpoints. Ring closure removes two hydrogens relative to propane.');
add(39,'cycloalkane',seq(5),seq(5),'Five carbons make a closed ring with only single bonds: cyclopentane. Numbering is not needed in the name because no position is distinguished.','Count the ring corners, including the closing corner. Do not add a carbon where the last bond reconnects to the first atom.');
add(40,'cycloalkane',seq(6),seq(6),'Six carbons make a ring with only single bonds: cyclohexane. There is no aromatic alternating-bond pattern.','A six-sided outline alone does not make benzene. Cyclohexane has C6H12; benzene has C6H6.');
add(41,'aromatic',seq(6),seq(6),'This six-carbon aromatic ring is benzene. Its established name identifies the aromatic parent; no substituent locants are needed.','The alternating strokes are one representation of delocalized bonding, not three independent alkene groups to name separately.');
add(42,'aromatic',[1,2,3,4,5,6],[0,1],'The parent is benzene. One external CH3 is a methyl group attached to the ring. The course answer is toluene and also accepts methylbenzene. One substituent needs no locant in the name.','The methyl carbon is outside the six-membered ring: six ring carbons plus one external carbon gives seven total.');
add(43,'phenol',[1,2,3,4,5,6],[0,1],'OH is directly attached to a benzene carbon. Use the retained functional-parent name phenol; the course also accepts benzenol.','An OH group on an aromatic ring is phenol, not cyclohexanol. The ring remains aromatic.');
add(44,'arylamine',[1,2,3,4,5,6],[0,1],'NH2 is directly attached to benzene. The course answer is the retained name aniline; benzenamine and aminobenzene are also accepted.','The labeled N is nitrogen, not another ring carbon. The six-carbon ring remains intact.');
add(45,'aromatic-acid',[3,4,5,6,7,8],[0,1,2,3],'A COOH group is attached to benzene. Use the retained name benzoic acid, also accepted as benzenecarboxylic acid by the course. The COOH carbon sits outside the six-carbon ring.','There are seven total carbons but only six ring carbons. The extra carbon belongs to COOH, not to an enlarged ring.');
add(46,'aromatic-halide',[1,2,3,4,5,6],[0,1],'The parent is benzene. A single bromine substituent gives the prefix bromo-: bromobenzene. No locant is needed for a single substituent.','Br is a bromine atom, not a carbon group. This is an aryl halide because Br is attached directly to an aromatic ring.');
add(47,'aromatic',[1,6,5,4,3,2],[0,1,6,7],'Two methyl groups sit on adjacent benzene carbons. Number them 1,2 rather than 1,6. Two gives di-: 1,2-dimethylbenzene, also called o-xylene in the course.','Adjacent means the two substituted ring carbons share a bond. Count the ring positions, not the space between the branch tips.');
add(48,'aromatic',[1,7,5,4,3,2],[0,1,5,6],'The methyl groups have one ring carbon between them. Choose ring positions 1,3 rather than 1,5: 1,3-dimethylbenzene, also called m-xylene in the course.','One intervening ring carbon means positions 1 and 3, not 1 and 2.');
add(49,'aromatic',[1,2,3,4,6,7],[0,1,4,5],'Two methyl groups are on opposite benzene carbons, positions 1 and 4. Assemble 1,4-dimethylbenzene, also called p-xylene in the course.','Trace three ring bonds from the first substituted carbon to the opposite carbon. That arrives at position 4 when the start is position 1.');
export const AUTHOR_SPECS = Object.fromEntries(specs.map(s=>[s.id,s]));

const FAMILY = {
  alkane: ['Only carbon and hydrogen, with single bonds in an open chain: an alkane.', 'Single bonds are described as sigma bonds. The usual local model for these saturated carbons is sp3, with approximately tetrahedral bond directions. A flat zigzag records connectivity, not a rigid flat shape.'],
  alkene: ['The defining feature is a carbon–carbon double bond: an alkene.', 'A C=C contains one sigma and one pi bond. The pi bond limits rotation about that bond. Its carbon centers use an approximately planar sp2 model; the drawn strokes do not represent extra atoms.'],
  alkyne: ['The defining feature is a carbon–carbon triple bond: an alkyne.', 'A C≡C contains one sigma and two pi bonds. In the sp model, the bonds leaving a triple-bond carbon lie approximately along a line. Bond order three leaves fewer places for hydrogen than a single bond.'],
  diene: ['There are two carbon–carbon double bonds: a diene.', 'Here the two C=C bonds are separated by one single bond. This is a conjugated diene: neighboring p orbitals can interact across that section. Keep the two double-bond locants even though their electrons are not completely isolated.'],
  branched: ['This is a branched alkane. Carbons outside the chosen longest chain are alkyl substituents.', 'Changing the connectivity changes the isomer, even if the formula stays the same. A branch is part of the molecule but not part of the chosen parent path; a path cannot repeat an atom.'],
  haloalkane: ['A halogen replaces a hydrogen on a saturated carbon chain. Use a prefix such as chloro- or bromo-.', 'A neutral halogen in this model forms one bond. The carbon it attaches to still has total bond order four, so one fewer hydrogen is attached there than in the corresponding unsubstituted alkane.'],
  alcohol: ['OH on a saturated carbon is an alcohol group. For these simple alcohols, it supplies the suffix -ol.', 'Oxygen has two bonding pairs and two lone pairs in the neutral Lewis model. Its single bond to carbon and single bond to hydrogen distinguish C–OH from C=O. The oxygen does not extend the carbon parent chain.'],
  aldehyde: ['A carbonyl group is C=O. Here its carbon is also bonded to H: an aldehyde, named with -al.', 'The carbonyl carbon uses a roughly planar sp2 model. The double bond contributes bond order two; its bond to carbon and its bond to hydrogen complete valence four.'],
  ketone: ['A carbonyl carbon bonded to carbon groups on both sides is a ketone. Use the suffix -one.', 'The carbonyl carbon has bond order two to oxygen and one to each neighboring carbon. That totals four: it has no hydrogen here. C=O contains a sigma bond and a pi bond.'],
  acid: ['C(=O)OH is a carboxylic acid group. Name the whole group, not the OH alone.', 'The two oxygens play different roles in the neutral drawing: one has a double bond to carbon and no H; the other has single bonds to carbon and H. Both satisfy oxygen valence two.'],
  ester: ['C(=O)–O–C is the ester connection: name the oxygen-linked alkyl group, then the acid-derived part ending in -oate.', 'The linking oxygen has two single bonds to carbon and no hydrogen. The carbonyl oxygen has one double bond and no hydrogen. Connectivity at the single-bond oxygen distinguishes this ester from a carboxylic acid.'],
  ether: ['Oxygen joins two carbon groups without an adjacent carbonyl: an ether. Use an alkoxy prefix on the longer carbon parent.', 'The neutral ether oxygen has two single bonds and two lone pairs. Do not follow a carbon chain through oxygen: it separates the two carbon groups for this naming method.'],
  amine: ['Nitrogen attached to carbon without an adjacent carbonyl is an amine. Here NH2 supplies the ending -amine.', 'This neutral nitrogen has three single bonds and one lone pair: one bond to carbon and two to hydrogen. The lone pair is not an extra atom or a bond to an invisible carbon.'],
  amide: ['Nitrogen directly bonded to a carbonyl carbon makes an amide, named with -amide.', 'This nitrogen has one carbon bond and two hydrogen bonds. Its lone pair can interact with the neighboring carbonyl pi system; an amide therefore differs electronically from an amine as well as in its name.'],
  cycloalkane: ['A closed carbon ring with only single bonds is a cycloalkane. Cyclo- signals ring closure.', 'Closing a saturated carbon chain replaces two carbon–hydrogen bonds with a carbon–carbon connection, giving CnH2n for these single rings. Ring shape constrains bond angles; the polygon is not a claim that all carbon centers have ideal tetrahedral angles.'],
  aromatic: ['The six-carbon aromatic parent is benzene. Groups outside the ring are substituents.', 'The benzene ring has a delocalized pi system. Alternating strokes are a Lewis representation, not fixed isolated double bonds or a molecule rapidly switching shapes. The aromatic carbons each have a p orbital contributing to the ring system.'],
  phenol: ['OH directly on benzene defines phenol, a retained functional-parent name.', 'The ring remains aromatic. In the neutral Lewis bookkeeping, oxygen has one bond to the ring carbon and one to H; the substituted ring carbon has no hydrogen.'],
  arylamine: ['NH2 directly on benzene gives the compound named aniline in this course.', 'Nitrogen has three single bonds in the neutral Lewis representation: one to the ring carbon and two to H. Its lone pair can interact with the aromatic system, while the substituted ring carbon has no H.'],
  'aromatic-acid': ['COOH attached to benzene gives benzoic acid. The acid carbon is outside the ring.', 'The ring retains aromatic bonding. The external carbonyl carbon has a double bond to one O, a single bond to the OH oxygen, and a single bond to the ring: total bond order four and no H on that carbon.'],
  'aromatic-halide': ['Br attached directly to benzene gives bromobenzene, an aryl halide.', 'The bromine replaces one ring hydrogen and has one bond in the neutral Lewis model. The ring carbon bonded to Br therefore has no H; the other five ring carbons each retain one H.']
};
const BASE_SOURCES = [
  {label:'IUPAC · naming, parent selection and numbering',href:'https://iupac.qmul.ac.uk/BriefGuide/organic.html'},
  {label:'IUPAC Blue Book · retained and preferred names',href:'https://iupac.qmul.ac.uk/BlueBook/P1.html'},
  {label:'OpenStax · reading structures',href:'https://openstax.org/books/organic-chemistry/pages/1-12-drawing-chemical-structures'},
  {label:'OpenStax · Lewis bonding and valence',href:'https://openstax.org/books/organic-chemistry/pages/1-4-development-of-chemical-bonding-theory'}
];
const FAMILY_SOURCE = {
  alkane:['sp3 model','1-6-sp3-hybrid-orbitals-and-the-structure-of-methane'],
  alkene:['sp2 and pi bonding','1-8-sp2-hybrid-orbitals-and-the-structure-of-ethylene'],
  alkyne:['sp and triple bonds','1-9-sp-hybrid-orbitals-and-the-structure-of-acetylene'],
  diene:['conjugation','14-1-stability-of-conjugated-dienes-molecular-orbital-theory'],
  alcohol:['alcohol naming','17-1-naming-alcohols-and-phenols'],
  amide:['amide bonding','21-7-chemistry-of-amides'],
  arylamine:['amine properties','24-3-basicity-of-amines'],
  aromatic:['aromatic bonding','15-2-structure-and-stability-of-benzene']
};
export function atomLabels(spec, graph) {
  const counts={};
  return Object.fromEntries(graph.atoms.map(a=>{
    const parent=spec.parent.indexOf(a.id);
    if(parent>=0) return [a.id,'C'+(parent+1)];
    const prefix=a.element==='C'?'X':a.element;
    counts[prefix]=(counts[prefix]||0)+1;
    return [a.id,prefix+counts[prefix]];
  }));
}
export function validateSpec(spec, graph) {
  if(!graph || spec.id!==graph.id || !FAMILY[spec.family]) throw new Error('Unknown course question or family.');
  if(!spec.parent.length || new Set(spec.parent).size!==spec.parent.length || spec.parent.some(id=>graph.atoms[id]?.element!=='C')) throw new Error('Parent must be distinct carbon atoms.');
  const connected=(a,b)=>graph.bonds.some(x=>(x.a===a&&x.b===b)||(x.a===b&&x.b===a));
  for(let i=1;i<spec.parent.length;i++) if(!connected(spec.parent[i-1],spec.parent[i])) throw new Error('Parent path is disconnected.');
  if(!spec.focus.length || spec.focus.some(id=>!graph.atoms[id])) throw new Error('An annotation references a missing atom.');
  if(!spec.naming?.trim() || !spec.trap?.trim()) throw new Error('Naming reasoning and a specific common mistake are required.');
  return true;
}
export function compileLesson(spec, graph=GRAPHS[spec.id]) {
  validateSpec(spec,graph);
  const labels=atomLabels(spec,graph), ring=spec.family.includes('aromatic')||['phenol','arylamine','cycloalkane'].includes(spec.family);
  const parentBonds=graph.bonds.filter(b=>spec.parent.includes(b.a)&&spec.parent.includes(b.b)).map(b=>b.id);
  let focusBonds=graph.bonds.filter(b=>spec.focus.includes(b.a)&&spec.focus.includes(b.b)).map(b=>b.id);
  if(['branched','aromatic'].includes(spec.family) && spec.focus.some(id=>!spec.parent.includes(id))) focusBonds=focusBonds.filter(id=>!parentBonds.includes(id));
  const h=graph.atoms.reduce((n,a)=>n+a.hydrogens,0), carbons=graph.atoms.filter(a=>a.element==='C').length;
  const audit=graph.atoms.map(a=>`${labels[a.id]} (${a.element}): ${a.hydrogens} H; bond order ${a.lewisBondOrderSum} to other atoms.`).join(' ');
  const source=FAMILY_SOURCE[spec.family] || (graph.atoms.some(a=>a.aromatic)?FAMILY_SOURCE.aromatic:null);
  const parentText=`The highlighted ${ring?'ring':'parent portion'} contains ${spec.parent.length} carbon${spec.parent.length===1?'':'s'}${ring?' and closes back on itself':''}. The entire molecule contains ${carbons} carbon${carbons===1?'':'s'}.`;
  const n=spec.parent.length;
  const options=[n,n+1,Math.max(0,n-1)].map(count=>({label:String(count),correct:count===n,feedback:count===n?`Yes. ${parentText} ${spec.trap}`:`Count the labeled parent positions from C1 to C${n}${ring?', counting each ring atom once':''}. X labels are carbons outside that parent; O, N, Cl and Br labels are other elements. The parent count is ${n}. Try again.`}));
  // Stable rotation keeps the correct option from always being first; this is practice, never scoring.
  const offset=Number(spec.id.slice(1))%3; options.push(...options.splice(0,offset));
  let check={prompt:`How many carbon atoms are in the highlighted parent ${ring?'ring':'portion'} (C labels only)?`,options};
  const numericCheck=(prompt,correct,why)=>({prompt,options:[correct,correct+1,correct>0?correct-1:correct+2].map(value=>({label:String(value),correct:value===correct,feedback:value===correct?'Yes. '+why:`The answer is ${correct}. ${why} Try again.`}))});
  if(['alkene','alkyne'].includes(spec.family)) {
    const b=graph.bonds.find(b=>b.order>1&&!b.aromatic),locant=Math.min(spec.parent.indexOf(b.a),spec.parent.indexOf(b.b))+1;
    check=numericCheck('What is the lower parent-carbon number of the multiple bond?',locant,`The bond joins ${labels[b.a]} and ${labels[b.b]}. Use the lower of those two numbers when a locant is needed.`);
  } else if(['aldehyde','ketone'].includes(spec.family)) {
    const carbon=graph.atoms.find(a=>a.element==='C'&&graph.bonds.some(b=>b.order===2&&((b.a===a.id&&graph.atoms[b.b].element==='O')||(b.b===a.id&&graph.atoms[b.a].element==='O'))));
    check=numericCheck('How many hydrogens are attached to the carbonyl carbon?',carbon.hydrogens,`${labels[carbon.id]} has bond order ${carbon.lewisBondOrderSum} to other atoms, leaving ${carbon.hydrogens} H to reach carbon valence four.`);
  } else if(['ether','amine','amide','arylamine'].includes(spec.family)) {
    const atom=graph.atoms.find(a=>a.element===(spec.family==='ether'?'O':'N'));
    check=numericCheck(`How many hydrogens are attached to ${labels[atom.id]} (${atom.element})?`,atom.hydrogens,`Its bond order to other atoms is ${atom.lewisBondOrderSum}; the ${atom.hydrogens} H complete this neutral atom's valence.`);
  } else if(spec.family==='cycloalkane'||spec.id==='m41') {
    check=numericCheck('How many hydrogens does this whole molecule contain?',h,`Add the hydrogen counts on all ${carbons} carbons: ${graph.formula}. Ring closure and multiple bonding change the H count.`);
  } else if(['m47','m48','m49'].includes(spec.id)) {
    const correct={'m47':'1,2','m48':'1,3','m49':'1,4'}[spec.id];
    check={prompt:'Which ring positions carry the two methyl groups?',options:['1,2','1,3','1,4'].map(value=>({label:value,correct:value===correct,feedback:(value===correct?'Yes. ':'Try again. ')+spec.naming}))};
  } else if(spec.id==='m45') check=numericCheck('How many carbons are in the whole molecule, including COOH?',carbons,'Six ring carbons plus the external carboxyl carbon give seven.');
  if(spec.id==='m27') check={prompt:'Keep the three-carbon chain but move OH to an end. What is the name?',options:[
    {label:'propan-1-ol',correct:true,feedback:'Yes. Number from the OH end: OH is now on C1. The formula stays C3H8O but the connections and name change.'},
    {label:'propan-2-ol',correct:false,feedback:'That names the original middle-OH structure. Moving OH to the end puts it on C1. Try again.'},
    {label:'ethanol',correct:false,feedback:'Eth- means two carbons. Moving OH did not remove a carbon; the chain still has three. Try again.'}
  ]};
  return {
    questionId:spec.id,name:graph.name,smiles:graph.smiles,formula:graph.formula,version:1,status:'local-review',
    family:spec.family,parent:spec.parent,formalCharge:null,graph,labels,
    chargeNote:'The course card does not explicitly state a formal charge. Its uncharged SMILES model is used for this valence check; an absent charge label is not evidence about every possible ionic form.',
    anchors:graph.atoms.map(a=>({atomId:a.id,label:labels[a.id],source:`original SVG atom-${a.id}`})),
    features:[{id:'parent',label:ring?'Trace the parent ring':'Trace the parent',bonds:parentBonds,atoms:spec.parent,text:parentText},
      {id:'feature',label:'Find the naming feature',bonds:focusBonds,atoms:spec.focus,text:FAMILY[spec.family][0]+' '+spec.naming}],
    summary:spec.naming,
    structure:`${graph.formula}: ${carbons} carbon${carbons===1?'':'s'} and ${h} hydrogens in total. Select an atom below the drawing to locate it and inspect its hydrogen count. C1–C${n} mark the parent; X labels mark carbon atoms outside it.`,
    layers:[
      {title:'1 · Atoms and bonds: start from zero',text:'Atoms are units of elements. C means carbon; H means hydrogen. A molecule joins atoms through bonds. A single line represents a shared electron pair; double and triple bonds have bond orders two and three. The drawing is a connection map, not a photograph. Written element symbols override the usual unlabeled-carbon shorthand.'},
      {title:'2 · Uncover the hidden atoms',text:`Carbon hydrogens are normally omitted from this drawing. In this uncharged model, carbon has valence four, oxygen two, nitrogen three and the halogens one. Bond order plus H count must match that valence. ${audit} These H counts sum to ${h}. Aromatic bond sums here use an integer Lewis representation for bookkeeping, not a claim of fixed alternating bond lengths.`},
      {title:'3 · Parent and functional group',text:parentText+' '+FAMILY[spec.family][0]},
      {title:'4 · Number and assemble the name',text:spec.naming},
      {title:'5 · Why these bonds and H counts work',text:FAMILY[spec.family][1]},
      {title:'6 · A mistake to catch next time',text:spec.trap}
    ],
    advanced:FAMILY[spec.family][1],
    history:'Naming context: IUPAC distinguishes systematic names from established retained names. The course may accept either as an alias. This explains why one structure can have more than one accepted name; it does not identify who first named this particular molecule. Molecule-specific discovery history has not been reviewed.',
    check,
    sources:[...BASE_SOURCES,...(source?[{label:'OpenStax · '+source[0],href:'https://openstax.org/books/organic-chemistry/pages/'+source[1]}]:[])]
  };
}
export const LESSONS = Object.fromEntries(specs.map(spec=>[spec.id,compileLesson(spec)]));
