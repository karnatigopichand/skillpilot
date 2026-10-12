import json
import logging
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from .lessons import router as lessons_router, load_lessons
from .mastery import router as mastery_router
from .assessment import router as assessment_router, bank_info
from pydantic import BaseModel, ConfigDict, Field, model_validator

STAGE_NAMES = (
    'AI Foundations', 'Building with AI', 'Knowledge & Retrieval (RAG)',
    'Agent Engineering', 'Advanced AI Systems', 'Production AI Engineering',
    'Interview & Career Readiness',
)
CATALOG_PATH = Path(__file__).resolve().parents[1] / 'data' / 'curriculum.json'


class Record(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class Topic(Record):
    id: str = Field(min_length=1)
    stageId: str = Field(min_length=1)
    order: int = Field(ge=1)
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    lessonStatus: Literal['planned', 'available']


class Stage(Record):
    id: str = Field(min_length=1)
    order: int = Field(ge=1, le=7)
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    diagnosticStatus: Literal['planned', 'available']
    topics: list[Topic]


class LearningPath(Record):
    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    stages: list[Stage]


class Roadmap(Record):
    schemaVersion: Literal['1']
    curriculumVersion: str = Field(min_length=1)
    path: LearningPath

    @model_validator(mode='after')
    def validate_catalog(self):
        stages = self.path.stages
        if self.path.id != 'agentic-ai-engineering' or self.path.title != 'Agentic AI Engineering':
            raise ValueError('Unexpected learning path')
        if len(stages) != 7 or {s.order for s in stages} != set(range(1, 8)):
            raise ValueError('Seven uniquely ordered stages required')
        if len({s.id for s in stages}) != 7:
            raise ValueError('Duplicate stage identity')
        topic_ids = set()
        for stage in stages:
            if stage.title != STAGE_NAMES[stage.order - 1]:
                raise ValueError('Unexpected stage title')
            if len({t.order for t in stage.topics}) != len(stage.topics):
                raise ValueError('Duplicate topic order')
            for topic in stage.topics:
                if topic.stageId != stage.id or topic.id in topic_ids:
                    raise ValueError('Invalid topic identity or parent')
                topic_ids.add(topic.id)
            stage.topics.sort(key=lambda t: t.order)
        stages.sort(key=lambda s: s.order)
        return self


app = FastAPI(title='SkillPilot', version='0.1.0')
app.include_router(assessment_router)
app.include_router(mastery_router)
app.include_router(lessons_router)


@app.get('/api/roadmap', response_model=Roadmap)
def roadmap():
    try:
        catalog = Roadmap.model_validate(json.loads(CATALOG_PATH.read_text()))
        try:
            published = {l.topicId for l in load_lessons().lessons}
        except (OSError, ValueError, KeyError, TypeError):
            published = set()
        for stage in catalog.path.stages:
            try:
                available = all(t['bankSize'] >= 3 for t in bank_info(stage.id)['topics'])
            except HTTPException:
                available = False
            stage.diagnosticStatus = 'available' if available else 'planned'
            for topic in stage.topics:
                topic.lessonStatus = 'available' if topic.id in published else 'planned'
        return catalog
    except (OSError, ValueError):
        logging.exception('Roadmap catalog unavailable')
        raise HTTPException(status_code=503, detail='The roadmap is unavailable. Please retry.') from None


# Register static delivery after API routes so /api/roadmap stays backend-owned.
FRONTEND_DIST = Path(__file__).resolve().parents[2] / 'frontend' / 'dist'
if FRONTEND_DIST.is_dir():
    app.mount('/', StaticFiles(directory=FRONTEND_DIST, html=True), name='frontend')
