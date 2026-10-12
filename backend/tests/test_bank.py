import copy
import json
import unittest
from pathlib import Path
from scripts.validate_bank import validate

ROOT = Path(__file__).resolve().parents[1]

class BankTests(unittest.TestCase):
    def setUp(self):
        self.bank = json.loads((ROOT / 'data/question-banks/ai-foundations.sample.json').read_text())
        self.curriculum = json.loads((ROOT / 'data/curriculum.json').read_text())
        self.coverage = json.loads((ROOT / 'data/question-banks/concept-coverage.json').read_text())

    def test_sample_coverage(self):
        errors, counts = validate(self.bank, self.curriculum, self.coverage)
        self.assertEqual(errors, [])
        self.assertEqual(len(counts), 6)
        self.assertEqual(set(counts.values()), {3})
        for topic in counts:
            self.assertEqual({q['difficulty'] for q in self.bank['questions'] if q['topicId'] == topic}, {'easy', 'medium', 'hard'})

    def test_invalid_records(self):
        for field, value in [('correctOptionId','unknown'), ('conceptId','wrong'), ('reference',{}), ('options',[]), ('bankVersion','wrong')]:
            bank = copy.deepcopy(self.bank)
            bank['questions'][0][field] = value
            self.assertTrue(validate(bank, self.curriculum, self.coverage)[0])
        self.bank['questions'].append(copy.deepcopy(self.bank['questions'][0]))
        self.assertTrue(validate(self.bank, self.curriculum, self.coverage)[0])

    def test_sample_is_not_release(self):
        errors, _ = validate(self.bank, self.curriculum, self.coverage, release=True)
        self.assertTrue(all(q['reviewStatus'] == 'approved' for q in self.bank['questions']))
        self.assertFalse(any('not approved' in e for e in errors))
        self.assertEqual(sum('requires 50' in e for e in errors), 6)
