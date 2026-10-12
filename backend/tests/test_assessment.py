import base64
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from app.main import app
from app.assessment import TOPICS, load_bank, encode, decode


class AssessmentTests(unittest.TestCase):
    def setUp(self):
        bank_patch = patch('app.assessment.BANK_PATH', Path(__file__).resolve().parents[1] / 'data/question-banks/ai-foundations.sample.json')
        bank_patch.start(); self.addCleanup(bank_patch.stop)
        self.client = TestClient(app)
        self.version, self.bank = load_bank()
        self.key = patch('app.assessment.secret', return_value=b'test-key-not-for-production')
        self.key.start()
        self.addCleanup(self.key.stop)

    def start(self, mode='diagnostic', topic=None, used=None, exposure=None):
        return self.client.post('/api/assessments/start', json={'mode': mode, 'stageId': 'stage-01', 'topicId': topic, 'bankVersion': self.version, 'cycleId': 'test-cycle' if topic else None, 'usedQuestionIds': used or [], 'diagnosticExposure': exposure or []})

    def answers(self, delivery, bank=None):
        bank = bank or self.bank
        return [{'questionId': q['id'], 'optionId': bank[q['id']]['correctOptionId']} for q in delivery['questions']]

    def submit(self, delivery, answers=None):
        return self.client.post('/api/assessments/submit', json={'receipt': delivery['receipt'], 'answers': answers or self.answers(delivery)})

    def test_delivery_leakage_and_diagnostic_coverage(self):
        d = self.start().json()
        self.assertEqual(d['questionCount'], 18)
        self.assertEqual([c['count'] for c in d['coverage']], [3] * 6)
        body = json.loads(base64.urlsafe_b64decode(d['receipt'].split('.')[0] + '=='))
        def keys(value):
            if isinstance(value, dict):
                return set(value) | set().union(*(keys(v) for v in value.values()))
            if isinstance(value, list):
                return set().union(*(keys(v) for v in value))
            return set()
        for payload in [d, body]:
            self.assertFalse(keys(payload) & {'correctOptionId', 'explanation', 'approvedBy', 'reference'})
        self.assertEqual(self.client.get('/data/question-banks/ai-foundations.sample.json').status_code, 404)
        for asset in (Path(__file__).resolve().parents[2] / 'frontend/dist/assets').glob('*'):
            self.assertNotIn('af-generative-ai-0001', asset.read_text())

    def test_scoring_shuffles_and_retry(self):
        orders = set()
        for _ in range(8):
            d = self.start('reassessment', TOPICS[0]).json()
            orders.add(tuple((q['id'], tuple(o['id'] for o in q['options'])) for q in d['questions']))
            first = self.submit(d)
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()['correct'], 3)
            self.assertEqual(first.json(), self.submit(d).json())
        self.assertGreater(len(orders), 1)

    def test_invalid_answer_sets(self):
        d = self.start().json()
        answers = self.answers(d)
        for invalid in [answers[:-1], answers + [answers[0]], [dict(a, optionId='bad') for a in answers], [dict(a, questionId='bad') for a in answers]]:
            self.assertEqual(self.client.post('/api/assessments/submit', json={'receipt': d['receipt'], 'answers': invalid}).status_code, 422)
        self.assertEqual(self.submit(d).json()['correct'], 18)

    def test_tampered_expired_and_version_receipts(self):
        d = self.start().json()
        data = decode(d['receipt'])
        tampered = d['receipt'] + 'x'
        self.assertEqual(self.client.post('/api/assessments/submit', json={'receipt': tampered, 'answers': self.answers(d)}).status_code, 409)
        data['expiresAt'] = 0
        self.assertEqual(self.client.post('/api/assessments/submit', json={'receipt': encode(data), 'answers': self.answers(d)}).status_code, 410)
        data['expiresAt'] = 9999999999; data['bankVersion'] = 'old'
        self.assertEqual(self.client.post('/api/assessments/submit', json={'receipt': encode(data), 'answers': self.answers(d)}).status_code, 409)

    def test_400_unique_completed_topic_questions_and_exhaustion(self):
        # Synthetic sampling fixture only, never eligible release content.
        template = next(q for q in self.bank.values() if q['topicId'] == TOPICS[0])
        bank = {f'test-{i}': dict(copy.deepcopy(template), id=f'test-{i}') for i in range(400)}
        used = []
        with patch('app.assessment.load_bank', return_value=(self.version, bank)):
            for i in range(20):
                d = self.start('practice' if i % 2 else 'reassessment', TOPICS[0], used).json()
                self.assertEqual(d['questionCount'], 20)
                ids = [q['id'] for q in d['questions']]
                self.assertFalse(set(ids) & set(used))
                self.assertEqual(self.submit(d, self.answers(d, bank)).status_code, 200)
                used += ids
            self.assertEqual(len(set(used)), 400)
            exhausted = self.start('practice', TOPICS[0], used)
            self.assertEqual(exhausted.status_code, 409)
            self.assertEqual(exhausted.json()['detail']['code'], 'bank_exhausted')
            self.assertEqual(self.start('practice', TOPICS[0], []).json()['questionCount'], 20)
            self.assertEqual(self.start('practice', TOPICS[0], used[:393]).json()['questionCount'], 7)

    def test_abandonment_and_diagnostic_separation(self):
        d = self.start().json()
        self.assertEqual(self.submit(d).status_code, 200)
        exposed = [q['id'] for q in d['questions']]
        repeat = self.start(exposure=exposed).json()
        self.assertTrue(any('previously seen' in w for w in repeat['warnings']))
        # Diagnostic history does not consume topic IDs; abandoned starts also do not consume them.
        a = self.start('practice', TOPICS[0]).json()
        b = self.start('reassessment', TOPICS[0]).json()
        self.assertEqual({q['id'] for q in a['questions']}, {q['id'] for q in b['questions']})
        result = self.submit(b).json()
        self.assertNotIn('mastery', result)
        self.assertNotIn('status', result['topics'][0])

    def test_malformed_history_and_bank(self):
        self.assertEqual(self.start('practice', TOPICS[0], ['unknown']).status_code, 422)
        q = next(iter(self.bank))
        self.assertEqual(self.start('practice', TOPICS[0], [q, q]).status_code, 422)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'bank.json'
            path.write_text('{')
            with patch('app.assessment.BANK_PATH', path):
                self.assertEqual(self.start().status_code, 503)

    def test_diagnostic_extras_use_least_cumulative_exposure(self):
        bank = {}
        for topic in TOPICS:
            template = next(q for q in self.bank.values() if q['topicId'] == topic)
            for i in range(5):
                q = dict(copy.deepcopy(template), id=f'{topic}-test-{i}')
                bank[q['id']] = q
        with patch('app.assessment.load_bank', return_value=(self.version, bank)):
            d = self.client.post('/api/assessments/start', json={'mode':'diagnostic', 'stageId':'stage-01', 'bankVersion':self.version, 'diagnosticTopicCounts': {t: (0 if t in TOPICS[-2:] else 30) for t in TOPICS}}).json()
            self.assertEqual(d['questionCount'], 20)
            self.assertEqual([c['count'] for c in d['coverage']], [3,3,3,3,4,4])
            self.assertEqual(len({q['id'] for q in d['questions']}), 20)
        with patch('app.assessment.load_bank', return_value=(self.version, {q['id']: q for q in self.bank.values() if q['topicId'] != TOPICS[0]})):
            self.assertEqual(self.start().status_code, 503)

    def test_local_signing_secret_survives_restart(self):
        self.key.stop()
        from app.assessment import secret
        with tempfile.TemporaryDirectory() as temp, patch('app.assessment.ROOT', Path(temp)), patch.dict('os.environ', {}, clear=True):
            first = secret()
            self.assertEqual(first, secret())
            self.assertEqual(len(first), 32)
            self.assertEqual((Path(temp) / '.local/assessment-secret').stat().st_mode & 0o777, 0o600)
        self.key.start()
