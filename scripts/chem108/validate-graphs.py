"""Generate/check facts from the pinned SMILES, never redraw the course SVG.
Run with RDKit 2025.09.6 available. Default checks the committed facts; --write regenerates.
"""
import json, hashlib, pathlib, subprocess, sys
from rdkit import Chem, rdBase
from rdkit.Chem import rdMolDescriptors
root = pathlib.Path(__file__).resolve().parents[2]
molecules = json.loads(subprocess.check_output(['node', '-e', "process.stdout.write(JSON.stringify(require('./js/game-hub/chem108/data/data.js').molecules))"], cwd=root))
result = {}
for card in molecules:
    mol = Chem.MolFromSmiles(card['smiles'])
    assert mol is not None, card['id']
    formula = rdMolDescriptors.CalcMolFormula(mol)
    assert formula == card['formula'], (card['id'], formula, card['formula'])
    # Kekulize a copy for integer Lewis bond sums; do not rewrite the aromatic input or SVG.
    lewis = Chem.Mol(mol)
    Chem.Kekulize(lewis, clearAromaticFlags=True)
    atoms = []
    for atom in mol.GetAtoms():
        idx = atom.GetIdx()
        h = atom.GetTotalNumHs()
        order_sum = sum(b.GetBondTypeAsDouble() for b in lewis.GetAtomWithIdx(idx).GetBonds())
        valence = {'C':4, 'N':3, 'O':2, 'Cl':1, 'Br':1}[atom.GetSymbol()]
        assert h + order_sum == valence, (card['id'], idx)
        assert atom.GetFormalCharge() == 0, (card['id'], idx, 'requires separate charge review')
        atoms.append({'id':idx, 'element':atom.GetSymbol(), 'hydrogens':h,
                      'lewisBondOrderSum':int(order_sum), 'aromatic':atom.GetIsAromatic(),
                      'smilesFormalCharge':atom.GetFormalCharge()})
    bonds = [{'id':b.GetIdx(), 'a':b.GetBeginAtomIdx(), 'b':b.GetEndAtomIdx(),
              'order':b.GetBondTypeAsDouble(), 'aromatic':b.GetIsAromatic()} for b in mol.GetBonds()]
    result[card['id']] = {'id':card['id'], 'name':card['name'], 'formula':formula, 'smiles':card['smiles'],
                         'svgSha256':hashlib.sha256(card['svg'].encode()).hexdigest(),
                         'formalCharge':None, 'smilesModelCharge':0, 'atoms':atoms, 'bonds':bonds}
output = root / 'js/game-hub/chem108/validated-graphs.mjs'
text = '// Derived from pinned course SMILES; checked using RDKit '+rdBase.rdkitVersion+'. No SVG regeneration.\nexport const GRAPHS = '+json.dumps(result, indent=2)+';\n'
if '--write' in sys.argv:
    output.write_text(text)
else:
    existing = json.loads(output.read_text().split('export const GRAPHS = ',1)[1].rstrip().removesuffix(';'))
    assert result == existing, 'Graph facts drifted; review before regeneration.'
specs = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', "import {AUTHOR_SPECS} from './js/game-hub/chem108/lesson-authoring.mjs'; process.stdout.write(JSON.stringify(AUTHOR_SPECS));"], cwd=root))
patterns = {'alkene':'[C]=[C]', 'diene':'[C]=[C]', 'alkyne':'[C]#[C]',
            'haloalkane':'[C;X4]-[Cl,Br]', 'alcohol':'[C;X4]-[O;H1]',
            'aldehyde':'[C;H1](=O)-[#6]', 'ketone':'[#6]-[C](=O)-[#6]',
            'acid':'[C](=O)-[O;H1]', 'ester':'[C](=O)-[O;H0]-[#6]',
            'ether':'[C;X4]-[O;H0]-[C;X4]', 'amine':'[C;X4]-[N;H2]',
            'amide':'[C](=O)-[N;H2]', 'phenol':'[c]-[O;H1]',
            'arylamine':'[c]-[N;H2]', 'aromatic-acid':'[c]-[C](=O)-[O;H1]',
            'aromatic-halide':'[c]-[Br]'}
for card in molecules:
    mol = Chem.MolFromSmiles(card['smiles'])
    spec = specs[card['id']]
    family = spec['family']
    if family in patterns:
        matches = mol.GetSubstructMatches(Chem.MolFromSmarts(patterns[family]))
        assert len(matches) == (2 if family == 'diene' else 1), (card['id'], family, matches)
    if family in ('alkane', 'branched', 'cycloalkane'):
        assert all(a.GetSymbol() == 'C' for a in mol.GetAtoms())
        assert all(b.GetBondTypeAsDouble() == 1 for b in mol.GetBonds())
        assert mol.GetRingInfo().NumRings() == (1 if family == 'cycloalkane' else 0)
    if 'aromatic' in family or family in ('phenol', 'arylamine'):
        assert len(spec['parent']) == 6
        assert all(mol.GetAtomWithIdx(idx).GetIsAromatic() for idx in spec['parent'])
print(f'Validated {len(result)} formulas, all atom valences/H counts, SVG hashes and authored functional-group families; no course data changed.')
