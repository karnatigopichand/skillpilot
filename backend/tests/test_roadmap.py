import copy
import json
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError
from app.main import CATALOG_PATH, Roadmap, app


class RoadmapTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads(CATALOG_PATH.read_text())

    def test_endpoint_and_explicit_sorting(self):
        shuffled = copy.deepcopy(self.data)
        shuffled['path']['stages'].reverse()
        shuffled['path']['stages'][-1]['topics'].reverse()
        with patch('app.main.CATALOG_PATH') as path:
            path.read_text.return_value = json.dumps(shuffled)
            response = TestClient(app).get('/api/roadmap')
        self.assertEqual(response.status_code, 200)
        stages = response.json()['path']['stages']
        self.assertEqual([s['order'] for s in stages], list(range(1, 8)))
        self.assertEqual([t['order'] for t in stages[0]['topics']], list(range(1, 7)))
        self.assertEqual(len(stages[0]['topics']), 6)
        self.assertEqual(stages[0]['diagnosticStatus'], 'available')
        self.assertTrue(all(s['diagnosticStatus'] == 'available' for s in stages[1:]))
        self.assertEqual([len(s['topics']) for s in stages], [6,5,5,7,5,6,4])

    def test_invalid_catalog_cases(self):
        cases = []
        missing = copy.deepcopy(self.data); missing['path']['stages'].pop(); cases.append(missing)
        duplicate = copy.deepcopy(self.data); duplicate['path']['stages'][1]['id'] = 'stage-01'; cases.append(duplicate)
        parent = copy.deepcopy(self.data); parent['path']['stages'][0]['topics'][0]['stageId'] = 'stage-02'; cases.append(parent)
        order = copy.deepcopy(self.data); order['path']['stages'][0]['topics'][1]['order'] = 1; cases.append(order)
        topic = copy.deepcopy(self.data); topic['path']['stages'][0]['topics'][1]['id'] = topic['path']['stages'][0]['topics'][0]['id']; cases.append(topic)
        ready = copy.deepcopy(self.data); ready['path']['stages'][1]['diagnosticStatus'] = 'unsupported'; cases.append(ready)
        title = copy.deepcopy(self.data); title['path']['stages'][2]['title'] = 'Other'; cases.append(title)
        for data in cases:
            with self.subTest(data=data), self.assertRaises(ValidationError):
                Roadmap.model_validate(data)

    def test_empty_topics_are_valid(self):
        self.data['path']['stages'][0]['topics'] = []
        self.assertEqual(Roadmap.model_validate(self.data).path.stages[0].topics, [])

    def test_corrupt_or_missing_catalog_is_recoverable(self):
        for exception in (OSError('missing'), ValueError('bad JSON')):
            with self.subTest(exception=exception), patch('app.main.CATALOG_PATH') as path:
                path.read_text.side_effect = exception
                response = TestClient(app).get('/api/roadmap')
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json(), {'detail': 'The roadmap is unavailable. Please retry.'})

    def test_no_question_bank_route(self):
        self.assertEqual(TestClient(app).get('/api/questions').status_code, 404)


if __name__ == '__main__':
    unittest.main()
