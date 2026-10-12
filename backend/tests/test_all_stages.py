import copy
import json
import unittest
from collections import Counter
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from app.main import app, CATALOG_PATH
from app.assessment import load_bank, decode, encode
from scripts.validate_bank import validate

class AllStageTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.curriculum = json.loads(CATALOG_PATH.read_text())
        self.stages = self.curriculum['path']['stages']
        self.data = CATALOG_PATH.parent
        self.coverage = json.loads((self.data/'question-banks/concept-coverage.json').read_text())

    def start(self, stage, mode='diagnostic', topic=None, used=None):
        version, _ = load_bank(stage)
        return self.client.post('/api/assessments/start', json=dict(stageId=stage, mode=mode, topicId=topic, bankVersion=version, cycleId='cycle' if topic else None, usedQuestionIds=used or []))

    def score(self, delivery, correct=True):
        _, bank = load_bank(delivery['stageId'])
        answers = [dict(questionId=q['id'], optionId=bank[q['id']]['correctOptionId'] if correct else next(o['id'] for o in q['options'] if o['id']!=bank[q['id']]['correctOptionId'])) for q in delivery['questions']]
        response = self.client.post('/api/assessments/submit',json=dict(receipt=delivery['receipt'],answers=answers))
        self.assertEqual(response.status_code,200,response.text)
        return response.json(),dict(receipt=delivery['receipt'],answers=answers,completedAt=datetime.now(timezone.utc).isoformat())

    def test_all_catalog_content_and_release_coverage(self):
        roadmap = self.client.get('/api/roadmap').json()
        self.assertEqual([len(s['topics']) for s in roadmap['path']['stages']], [6,5,5,7,5,6,4])
        identities, prompts = set(), set()
        for stage in self.stages:
            path = self.data/'question-banks'/('ai-foundations.50.json' if stage['id']=='stage-01' else stage['id']+'.50.json')
            bank = json.loads(path.read_text())
            errors, counts = validate(bank,self.curriculum,self.coverage,True,stage['id'])
            self.assertEqual(errors,[],stage['id'])
            self.assertEqual(list(counts.values()),[50]*len(stage['topics']))
            for q in bank['questions']:
                self.assertNotIn(q['id'],identities);identities.add(q['id'])
                self.assertNotIn(q['prompt'],prompts);prompts.add(q['prompt'])
            for topic in stage['topics']:
                lesson = self.client.get('/api/lessons/'+topic['id'])
                self.assertEqual(lesson.status_code,200)
                self.assertEqual(lesson.json()['stageId'],stage['id'])
        self.assertEqual(len(identities),1900)
        self.assertTrue(all(s['diagnosticStatus']=='available' and all(t['lessonStatus']=='available' for t in s['topics']) for s in roadmap['path']['stages']))

    def test_every_stage_diagnostic_scoring_and_no_answer_payload(self):
        for stage, count in zip(self.stages,[20,17,17,23,17,20,14]):
            d=self.start(stage['id']).json()
            self.assertEqual(d['questionCount'],count)
            self.assertEqual(sorted(Counter(q['topicId'] for q in d['questions']).values()),[3]*(len(stage['topics'])-2)+[4,4])
            for q in d['questions']:
                self.assertEqual(set(q),{'id','topicId','conceptId','difficulty','prompt','options'})
            result,_=self.score(d)
            self.assertEqual(result['percentage'],100)
            wrong,_=self.score(d,False)
            self.assertEqual(wrong['correct'],0)
            self.assertEqual(sum(t['total'] for t in result['topics']),count)
            self.assertFalse(any('Remainder' in w for w in d['warnings']))

    def test_all_topic_cycles_remain_20_20_10_and_explicit_restart(self):
        for stage in self.stages:
            for topic in stage['topics']:
                used=[]
                for mode,count in [('practice',20),('reassessment',20),('practice',10)]:
                    d=self.start(stage['id'],mode,topic['id'],used).json()
                    ids=[q['id'] for q in d['questions']]
                    self.assertEqual(len(ids),count)
                    self.assertFalse(set(ids)&set(used));used+=ids
                    self.score(d)
                self.assertEqual(self.start(stage['id'],'practice',topic['id'],used).json()['detail']['code'],'bank_exhausted')
                self.assertEqual(self.start(stage['id'],'practice',topic['id']).json()['questionCount'],20)

    def test_cross_stage_requests_and_evidence_rejected(self):
        s1,s2=self.stages[:2]
        self.assertEqual(self.start(s1['id'],'practice',s2['topics'][0]['id']).status_code,422)
        version,_=load_bank(s1['id'])
        self.assertEqual(self.client.post('/api/assessments/start',json=dict(mode='diagnostic',stageId='stage-02',bankVersion=version)).status_code,409)
        d=self.start('stage-01').json();_,e=self.score(d)
        v2,_=load_bank('stage-02')
        response=self.client.post('/api/mastery/evaluate',json=dict(schemaVersion=1,curriculumVersion='2026-10-07.2',stageId='stage-02',bankVersion=v2,attempts=[e]))
        self.assertEqual(response.status_code,422)
        self.assertEqual(self.client.get('/api/assessments/bank-info?stageId=unknown').status_code,422)
        forged=decode(d['receipt']);forged['stageId']='stage-02';forged['bankVersion']=v2
        self.assertEqual(self.client.post('/api/assessments/submit',json=dict(receipt=encode(forged),answers=e['answers'])).status_code,409)

    def test_each_stage_baseline_mastery_and_practice_exclusion(self):
        for stage in self.stages:
            topic=stage['topics'][0]['id']
            d=self.start(stage['id']).json();_,e1=self.score(d)
            r=self.start(stage['id'],'reassessment',topic).json();_,e2=self.score(r)
            practice=self.start(stage['id'],'practice',topic).json();_,e3=self.score(practice,False)
            request=dict(schemaVersion=1,curriculumVersion='2026-10-07.2',stageId=stage['id'],bankVersion=d['bankVersion'],initialDiagnosticAttemptId=d['attemptId'],attempts=[e1,e2,e3])
            response=self.client.post('/api/mastery/evaluate',json=request)
            self.assertEqual(response.status_code,200,response.text)
            rows=response.json()['topics']
            self.assertEqual(len(rows),len(stage['topics']))
            self.assertEqual(rows[0]['status'],'Strong')
            self.assertTrue(all(row['status']=='Insufficient Evidence' for row in rows[1:]))
            self.assertEqual(rows[0]['baseline']['attemptId'],d['attemptId'])
            request['initialDiagnosticAttemptId']=r['attemptId']
            self.assertEqual(self.client.post('/api/mastery/evaluate',json=request).status_code,422)
