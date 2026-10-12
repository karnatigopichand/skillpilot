import copy
import json
import re
import unittest
from collections import Counter
from pathlib import Path
from scripts.validate_bank import validate
from app.assessment import BANK_PATH, Question

DATA = Path(__file__).resolve().parents[1] / 'data'

class ExpansionTests(unittest.TestCase):
    def setUp(self):
        self.batch = json.loads((DATA / 'question-banks/review-batches/generative-ai-b01.json').read_text())
        self.sample = json.loads((DATA / 'question-banks/ai-foundations.sample.json').read_text())
        self.curriculum = json.loads((DATA / 'curriculum.json').read_text())
        self.coverage = json.loads((DATA / 'question-banks/concept-coverage.json').read_text())
        self.coverage['topics'] = [t for t in self.coverage['topics'] if t['topicId'].startswith('ai-foundations-')]
        self.coverage['releaseTargetPerTopic']=400
        self.coverage['difficultyTargets']={'easy':120,'medium':180,'hard':100}
        for topic in self.coverage['topics']:
            for concept in topic['concepts']:concept['targetQuestions']=80

    def test_batch_structure_coverage_and_runtime_isolation(self):
        errors,counts=validate(self.batch,self.curriculum,self.coverage)
        self.assertEqual(errors,[])
        self.assertEqual(counts,{'ai-foundations-generative-ai':40})
        qs=self.batch['questions']
        self.assertEqual(set(Counter(q['conceptId'] for q in qs).values()),{8})
        self.assertEqual(Counter(q['difficulty'] for q in qs),{'easy':12,'medium':18,'hard':10})
        self.assertEqual(Counter(q['correctOptionId'] for q in qs),{'a':10,'b':10,'c':10,'d':10})
        for q in qs:
            Question.model_validate(q)
            self.assertEqual(q['reviewStatus'],'approved')
            self.assertEqual(q['review']['approvedBy'],'project owner')
            self.assertTrue(q['review']['approvedOn'])
        self.assertTrue({q['id'] for q in qs}.isdisjoint(q['id'] for q in self.sample['questions']))
        norm=lambda p:re.sub(r'\W+',' ',p.casefold()).strip()
        self.assertTrue({norm(q['prompt']) for q in qs}.isdisjoint(norm(q['prompt']) for q in self.sample['questions']))
        self.assertEqual(len(self.sample['questions']),18)
        self.assertTrue(all(q['reviewStatus']=='approved' for q in self.sample['questions']))

    def test_release_gate_rejects_approved_batch_short_coverage(self):
        errors,_=validate(self.batch,self.curriculum,self.coverage,release=True)
        self.assertEqual(sum('not approved' in e for e in errors),0)
        self.assertEqual(sum('requires 400' in e for e in errors),6)
        self.assertTrue(any('concept' in e for e in errors))
        self.assertTrue(any('difficulty' in e for e in errors))

    def test_second_batch_and_cross_bank_review_ledger(self):
        second=json.loads((DATA / 'question-banks/review-batches/generative-ai-b02.json').read_text())
        errors,counts=validate(second,self.curriculum,self.coverage)
        self.assertEqual(errors,[])
        self.assertEqual(counts,{'ai-foundations-generative-ai':40})
        self.assertEqual(Counter(q['difficulty'] for q in second['questions']),{'easy':12,'medium':18,'hard':10})
        self.assertEqual(set(Counter(q['conceptId'] for q in second['questions']).values()),{8})
        self.assertEqual(Counter(q['correctOptionId'] for q in second['questions']),{'a':10,'b':10,'c':10,'d':10})
        for q in second['questions']:
            Question.model_validate(q)
            self.assertEqual(q['reviewStatus'],'pending-user-review')
            self.assertNotIn('approvedBy',q['review'])
        records=self.sample['questions']+self.batch['questions']+second['questions']
        self.assertEqual(len({q['id'] for q in records}),len(records))
        prompts=[re.sub(r'\W+',' ',q['prompt'].casefold()).strip() for q in records]
        self.assertEqual(len(set(prompts)),len(prompts))
        self.assertEqual(Counter(q['reviewStatus'] for q in records),{'approved':58,'pending-user-review':40})
        errors,_=validate(second,self.curriculum,self.coverage,release=True)
        self.assertEqual(sum('not approved' in e for e in errors),40)
        self.assertEqual(sum('requires 400' in e for e in errors),6)

    def test_release_gate_checks_real_coverage_beyond_question_count(self):
        # Synthetic fixture verifies gating, not editorial content or release readiness.
        bank=copy.deepcopy(self.sample)
        bank['questions']=[]
        for topic in self.coverage['topics']:
            template=next(q for q in self.sample['questions'] if q['topicId']==topic['topicId'])
            for index in range(400):
                q=copy.deepcopy(template);q['id']=topic['topicId']+'-'+str(index);q['prompt']='Synthetic '+q['id'];q['conceptId']=topic['concepts'][index//80]['id'];q['difficulty']='easy' if index<120 else 'medium' if index<300 else 'hard';bank['questions'].append(q)
        self.assertEqual(validate(bank,self.curriculum,self.coverage,release=True)[0],[])
        bank['questions'][0]['conceptId']=self.coverage['topics'][0]['concepts'][1]['id']
        bank['questions'][0]['difficulty']='medium'
        errors,_=validate(bank,self.curriculum,self.coverage,release=True)
        self.assertTrue(any('concept' in e for e in errors))
        self.assertTrue(any('difficulty' in e for e in errors))

if __name__=='__main__':unittest.main()
