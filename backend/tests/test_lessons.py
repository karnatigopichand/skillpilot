import copy
import json
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app
from app.lessons import LESSONS_PATH, Store, load_lessons

class LessonTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.data = json.loads(LESSONS_PATH.read_text())

    def test_all_topics_deliver_without_diagnostic_and_cover_concepts(self):
        store = load_lessons()
        self.assertEqual(len(store.lessons), 38)
        for lesson in store.lessons:
            response = self.client.get('/api/lessons/' + lesson.topicId)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['topicId'], lesson.topicId)
            self.assertEqual(set(lesson.conceptIds), {c for s in lesson.sections for c in s.conceptIds})
            self.assertTrue(lesson.examples and lesson.resources)
            self.assertNotIn('correctOptionId', response.text)
        roadmap = self.client.get('/api/roadmap').json()
        self.assertTrue(all(t['lessonStatus'] == 'available' for t in roadmap['path']['stages'][0]['topics']))

    def test_unknown_and_missing_content_recovery(self):
        self.assertEqual(self.client.get('/api/lessons/missing').status_code, 404)
        with patch('app.lessons.load_lessons', side_effect=OSError('missing')):
            self.assertEqual(self.client.get('/api/lessons/ai-foundations-llms').status_code, 503)
        with patch('app.main.load_lessons', side_effect=ValueError('invalid')):
            roadmap = self.client.get('/api/roadmap').json()
            self.assertTrue(all(t['lessonStatus'] == 'planned' for t in roadmap['path']['stages'][0]['topics']))

    def test_invalid_structure_resources_and_missing_coverage_fail_closed(self):
        for mutate in [lambda l:l['resources'][0].update(url='javascript:alert(1)'), lambda l:l.update(sections=[]), lambda l:l['sections'][0].update(conceptIds=['foreign']), lambda l:l['sections'].pop(), lambda l:l['examples'].append(copy.deepcopy(l['examples'][0]))]:
            data = copy.deepcopy(self.data)
            mutate(data['lessons'][0])
            with self.assertRaises(ValueError):
                Store.model_validate(data)

    def test_foreign_topic_and_duplicate_lesson_fail_closed(self):
        for mutate in [lambda d:d['lessons'][0].update(topicId='foreign'),lambda d:d['lessons'].append(copy.deepcopy(d['lessons'][0]))]:
            data=copy.deepcopy(self.data);mutate(data)
            with patch('app.lessons.LESSONS_PATH') as path:
                path.read_text.return_value=json.dumps(data)
                with self.assertRaises(ValueError):load_lessons()

if __name__ == '__main__':
    unittest.main()
