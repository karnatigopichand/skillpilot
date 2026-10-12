import json
import unittest
from collections import Counter
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app
from app.assessment import TOPICS, BANK_PATH, load_bank, decode
from scripts.validate_bank import validate

class Release50Tests(unittest.TestCase):
    def setUp(self):
        self.client=TestClient(app)
        self.version,self.bank=load_bank()

    def start(self,mode='diagnostic',topic=None,used=None,cycle='release-cycle'):
        return self.client.post('/api/assessments/start',json={'mode':mode,'stageId':'stage-01','topicId':topic,'bankVersion':self.version,'cycleId':cycle if topic else None,'usedQuestionIds':used or []})

    def score(self,d,wrong=False):
        answers=[]
        for q in d['questions']:
            correct=self.bank[q['id']]['correctOptionId']
            choice=next(o['id'] for o in q['options'] if o['id']!=correct) if wrong else correct
            answers.append({'questionId':q['id'],'optionId':choice})
        response=self.client.post('/api/assessments/submit',json={'receipt':d['receipt'],'answers':answers})
        self.assertEqual(response.status_code,200)
        return response.json(),answers

    def test_release_structure_exact_totals_and_original_ids(self):
        root=Path(__file__).resolve().parents[1]/'data'
        bank=json.loads(BANK_PATH.read_text())
        errors,counts=validate(bank,json.loads((root/'curriculum.json').read_text()),json.loads((root/'question-banks/concept-coverage.json').read_text()),True)
        self.assertEqual(errors,[])
        self.assertEqual(set(counts.values()),{50})
        for topic in TOPICS:
            qs=[q for q in bank['questions'] if q['topicId']==topic]
            self.assertEqual(Counter(q['difficulty'] for q in qs),{'easy':15,'medium':23,'hard':12})
            self.assertEqual(set(Counter(q['conceptId'] for q in qs).values()),{10})
        old=json.loads((root/'question-banks/ai-foundations.sample.json').read_text())
        for q in old['questions']:
            self.assertEqual(self.bank[q['id']]['correctOptionId'],q['correctOptionId'])
            self.assertEqual(self.bank[q['id']]['prompt'],q['prompt'])

    def test_all_topics_have_20_20_10_then_explicit_cycle(self):
        for topic in TOPICS:
            used=[]
            for mode,size in [('practice',20),('reassessment',20),('practice',10)]:
                response=self.start(mode,topic,used)
                self.assertEqual(response.status_code,200)
                d=response.json();self.assertEqual(d['questionCount'],size)
                ids=[q['id'] for q in d['questions']]
                self.assertTrue(set(ids).isdisjoint(used))
                result,_=self.score(d);self.assertEqual(result['correct'],size)
                used+=ids
            self.assertEqual(len(set(used)),50)
            self.assertEqual(self.start('practice',topic,used).json()['detail']['code'],'bank_exhausted')
            self.assertEqual(self.start('practice',topic,[],cycle='explicit-new-cycle').json()['questionCount'],20)

    def test_diagnostic_has_20_correct_coverage_and_no_pre_submit_keys(self):
        d=self.start().json()
        self.assertEqual(d['questionCount'],20)
        counts=Counter(q['topicId'] for q in d['questions'])
        self.assertEqual(sorted(counts.values()),[3,3,3,3,4,4])
        for question in d['questions']:
            for key in ['correctOptionId','explanation','reference','review']: self.assertNotIn(key, question)
        receipt = decode(d['receipt'])
        self.assertTrue(all(set(q) == {'id','optionIds'} for q in receipt['selected']))
        result,_=self.score(d);self.assertEqual(result['percentage'],100)
        info=self.client.get('/api/assessments/bank-info').json()
        self.assertEqual(info['releaseTargetPerTopic'],50)
        self.assertEqual([t['bankSize'] for t in info['topics']],[50]*6)
        self.assertEqual(self.client.get('/data/question-banks/ai-foundations.50.json').status_code,404)

    def test_real_20_question_reassessment_updates_mastery_without_changing_baseline(self):
        d=self.start().json();_,answers=self.score(d)
        strong=self.start('reassessment',TOPICS[0]).json();_,good=self.score(strong)
        lower=self.start('reassessment',TOPICS[0],[q['id'] for q in strong['questions']]).json();_,bad=self.score(lower,True)
        attempts=[{'receipt':x['receipt'],'answers':a,'completedAt':date} for x,a,date in [(d,answers,'2026-10-01T00:00:00Z'),(strong,good,'2026-10-02T00:00:00Z'),(lower,bad,'2026-10-03T00:00:00Z')]]
        response=self.client.post('/api/mastery/evaluate',json={'schemaVersion':1,'curriculumVersion':'2026-10-07.1','bankVersion':self.version,'initialDiagnosticAttemptId':d['attemptId'],'attempts':attempts})
        self.assertEqual(response.status_code,200)
        topic=next(t for t in response.json()['topics'] if t['topicId']==TOPICS[0])
        self.assertEqual(topic['status'],'Needs Attention')
        self.assertEqual(topic['baseline']['attemptId'],d['attemptId'])
        self.assertEqual(topic['latestEligible']['attemptId'],lower['attemptId'])

if __name__=='__main__':unittest.main()
