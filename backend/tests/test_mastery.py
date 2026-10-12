import copy
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app.mastery import interpret, load_rules
from app.assessment import TOPICS, load_bank


def evidence(id, mode, correct, total, date, topic=TOPICS[0], version='test'):
    return {'attemptId': id, 'mode': mode, 'completedAt': date, 'bankVersion': version, 'topics': [{'topicId': topic, 'correct': correct, 'total': total}]}


class MasteryTests(unittest.TestCase):
    def setUp(self):
        self.rules = load_rules()

    def plan(self, attempts, baseline=None):
        return interpret(attempts, baseline, 'test', self.rules)

    def test_sparse_and_practice_never_establish_mastery(self):
        for mode, status in [('diagnostic','Insufficient Evidence'), ('reassessment','Insufficient Evidence'), ('practice','Unknown')]:
            p = self.plan([evidence('a',mode,3,3,'2026-10-01T00:00:00Z')], 'a' if mode == 'diagnostic' else None)
            self.assertEqual(p['topics'][0]['status'], status)
        self.assertTrue(all(t['status']=='Unknown' for t in self.plan([])['topics']))

    def test_boundaries_and_latest_lower(self):
        for correct, expected in [(11,'Needs Attention'), (12,'Developing'), (16,'Developing'), (17,'Strong')]:
            self.assertEqual(self.plan([evidence('a','reassessment',correct,20,'2026-10-01T00:00:00Z')])['topics'][0]['status'],expected)
        attempts=[evidence('base','diagnostic',3,3,'2026-10-01T00:00:00Z'), evidence('high','reassessment',18,20,'2026-10-02T00:00:00Z'),evidence('low','reassessment',10,20,'2026-10-03T00:00:00Z')]
        row=self.plan(attempts,'base')['topics'][0]
        self.assertEqual(row['status'],'Needs Attention');self.assertEqual(row['baseline']['attemptId'],'base');self.assertEqual(row['latestEligible']['attemptId'],'low')

    def test_latest_short_and_optional_review(self):
        attempts=[evidence('high','reassessment',18,20,'2026-10-01T00:00:00Z'),evidence('short','reassessment',2,3,'2026-10-02T00:00:00Z')]
        p=self.plan(attempts)
        self.assertEqual(p['topics'][0]['status'],'Strong')
        self.assertEqual(p['topics'][0]['latestReassessment']['attemptId'],'short')
        self.assertEqual(p['topics'][0]['latestEligible']['attemptId'],'high')
        self.assertEqual(p['optionalReview'][0]['topicId'],TOPICS[0])
        self.assertNotIn(TOPICS[0],[r['topicId'] for r in p['recommendations']])

    def test_order_and_explanations(self):
        attempts=[evidence('a','reassessment',10,20,'2026-10-01T00:00:00Z',TOPICS[0]),evidence('b','reassessment',5,20,'2026-10-01T00:00:00Z',TOPICS[1])]
        p=self.plan(attempts)
        self.assertEqual([r['topicId'] for r in p['recommendations'][:2]],[TOPICS[1],TOPICS[0]])
        self.assertIn('5/20',p['recommendations'][0]['reason'])
        self.assertEqual([r['topicId'] for r in self.plan([])['recommendations']],TOPICS)

    def test_api_rescores_receipts_preserves_baseline_and_rejects_invalid_evidence(self):
        c=TestClient(app); version,bank=load_bank()
        with patch('app.assessment.secret',return_value=b'test-key'):
            d=c.post('/api/assessments/start',json={'mode':'diagnostic','stageId':'stage-01','bankVersion':version}).json()
            answers=[{'questionId':q['id'],'optionId':bank[q['id']]['correctOptionId']} for q in d['questions']]
            body={'schemaVersion':1,'curriculumVersion':'2026-10-07.1','bankVersion':version,'initialDiagnosticAttemptId':d['attemptId'],'attempts':[{'receipt':d['receipt'],'answers':answers,'completedAt':'2026-10-01T00:00:00Z'}]}
            r=c.post('/api/mastery/evaluate',json=body)
            self.assertEqual(r.status_code,200)
            self.assertTrue(all(t['status']=='Insufficient Evidence' for t in r.json()['topics']))
            self.assertTrue(all(t['baseline']['correct']==t['baseline']['total'] and t['baseline']['total'] in (3,4) for t in r.json()['topics']))
            duplicate=copy.deepcopy(body);duplicate['attempts']*=2
            self.assertEqual(c.post('/api/mastery/evaluate',json=duplicate).status_code,422)
            bad=copy.deepcopy(body);bad['initialDiagnosticAttemptId']='wrong'
            self.assertEqual(c.post('/api/mastery/evaluate',json=bad).status_code,422)
            bad=copy.deepcopy(body);bad['attempts'][0]['completedAt']='invalid'
            self.assertEqual(c.post('/api/mastery/evaluate',json=bad).status_code,422)
            bad=copy.deepcopy(body);bad['attempts'][0]['answers'][0]['optionId']='wrong'
            self.assertEqual(c.post('/api/mastery/evaluate',json=bad).status_code,422)

    def test_old_bank_and_repeated_short_attempts_never_qualify(self):
        old=evidence('old','reassessment',20,20,'2026-10-01T00:00:00Z',version='old-bank')
        self.assertEqual(self.plan([old])['topics'][0]['status'],'Unknown')
        repeated=[evidence(str(i),'reassessment',3,3,f'2026-10-0{(i % 6) + 1}T00:00:00Z') for i in range(8)]
        self.assertEqual(self.plan(repeated)['topics'][0]['status'],'Insufficient Evidence')
