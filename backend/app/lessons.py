"""Read-only, curriculum-validated Learning Content delivery."""
import json
import logging
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

DATA = Path(__file__).resolve().parents[1] / 'data'
LESSONS_PATH = DATA / 'lessons' / 'ai-foundations.json'
Text = Annotated[str, Field(min_length=1)]
Texts = Annotated[list[Text], Field(min_length=1)]

class Record(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, str_strip_whitespace=True)

class Section(Record):
    id: Text
    title: Text
    conceptIds: Texts
    paragraphs: Texts

class Example(Record):
    id: Text
    title: Text
    scenario: Text
    walkthrough: Text
    takeaway: Text

class Resource(Record):
    id: Text
    title: Text
    url: Text

    @field_validator('url')
    @classmethod
    def https_url(cls, value):
        url = urlsplit(value)
        if url.scheme != 'https' or not url.hostname or url.username or url.password:
            raise ValueError('HTTPS resource URL required')
        return value

class Lesson(Record):
    id: Text
    stageId: Text
    topicId: Text
    title: Text
    summary: Text
    status: Literal['published']
    conceptIds: Texts
    sections: Annotated[list[Section], Field(min_length=1)]
    examples: Annotated[list[Example], Field(min_length=1)]
    misconceptions: Texts
    recap: Texts
    resources: Annotated[list[Resource], Field(min_length=1)]

    @model_validator(mode='after')
    def validate_sections(self):
        if len(set(self.conceptIds)) != len(self.conceptIds):
            raise ValueError('Duplicate concepts')
        for records in (self.sections, self.examples, self.resources):
            if len({r.id for r in records}) != len(records):
                raise ValueError('Duplicate child IDs')
        used = set()
        for section in self.sections:
            if len(set(section.conceptIds)) != len(section.conceptIds) or not set(section.conceptIds) <= set(self.conceptIds):
                raise ValueError('Invalid section concept mapping')
            used.update(section.conceptIds)
        if used != set(self.conceptIds):
            raise ValueError('Uncovered concepts')
        return self

class Store(Record):
    schemaVersion: Literal['1']
    contentVersion: Text
    lessons: list[Lesson]

def load_lessons():
    store = Store.model_validate(json.loads(LESSONS_PATH.read_text()))
    for path in sorted((DATA / 'lessons').glob('stage-*.json')):
        extra = Store.model_validate(json.loads(path.read_text()))
        store.lessons.extend(extra.lessons)
    curriculum = json.loads((DATA / 'curriculum.json').read_text())
    topics = {t['id']: t for s in curriculum['path']['stages'] for t in s['topics']}
    coverage = {t['topicId']: {c['id'] for c in t['concepts']} for t in json.loads((DATA / 'question-banks' / 'concept-coverage.json').read_text())['topics']}
    if len({l.id for l in store.lessons}) != len(store.lessons) or len({l.topicId for l in store.lessons}) != len(store.lessons):
        raise ValueError('Duplicate lesson identity')
    for lesson in store.lessons:
        topic = topics.get(lesson.topicId)
        if not topic or lesson.stageId != topic['stageId'] or lesson.title != topic['title'] or set(lesson.conceptIds) != coverage.get(lesson.topicId):
            raise ValueError('Invalid curriculum or concept mapping')
    return store

router = APIRouter(prefix='/api/lessons', tags=['Learning Content'])

@router.get('/{topic_id}', response_model=Lesson)
def lesson(topic_id: str):
    try:
        store = load_lessons()
    except (OSError, ValueError, KeyError, TypeError):
        logging.exception('Lesson content unavailable')
        raise HTTPException(503, 'Lesson content is unavailable. Please retry.') from None
    match = next((l for l in store.lessons if l.topicId == topic_id), None)
    if match is None:
        raise HTTPException(404, 'This lesson is not available.')
    return match
