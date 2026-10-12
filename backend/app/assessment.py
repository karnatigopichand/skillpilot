"""Reviewed-bank delivery and stateless receipt-bound scoring."""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

ROOT = Path(__file__).resolve().parents[1]
BANK_PATH = ROOT / 'data/question-banks/ai-foundations.50.json'
TOPICS = ['ai-foundations-' + slug for slug in ['generative-ai', 'llms', 'tokens', 'context-windows', 'prompting', 'structured-outputs']]
CATALOG_PATH = ROOT / 'data/curriculum.json'

def stage_topics(stage_id='stage-01'):
    catalog = json.loads(CATALOG_PATH.read_text())
    stage = next((s for s in catalog['path']['stages'] if s['id'] == stage_id), None)
    if not stage or not stage['topics']:
        fail('stage_invalid', 'This stage is not available.', 422)
    return [t['id'] for t in stage['topics']]

def all_topics():
    return {t['id'] for s in json.loads(CATALOG_PATH.read_text())['path']['stages'] for t in s['topics']}

RNG = secrets.SystemRandom()
router = APIRouter(prefix='/api/assessments')


def fail(code, message, status=409):
    raise HTTPException(status_code=status, detail={'code': code, 'message': message})


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class Option(Strict):
    id: str = Field(min_length=1)
    text: str = Field(min_length=1)


class Reference(Strict):
    url: str
    title: str = Field(min_length=1)
    locator: str = Field(min_length=1)
    checkedOn: str


class Question(Strict):
    id: str = Field(min_length=1)
    topicId: str
    conceptId: str
    difficulty: Literal['easy', 'medium', 'hard']
    prompt: str = Field(min_length=1)
    options: list[Option] = Field(min_length=4, max_length=4)
    correctOptionId: str
    explanation: str = Field(min_length=1)
    reference: Reference
    bankVersion: str
    reviewStatus: Literal['approved', 'draft', 'pending-user-review', 'rejected']
    review: dict

    @model_validator(mode='after')
    def check(self):
        if self.topicId not in all_topics() or not self.conceptId.startswith((self.topicId.removeprefix('ai-foundations-') if self.topicId.startswith('ai-foundations-') else self.topicId) + '.'):
            raise ValueError('Invalid topic/concept')
        ids = [o.id for o in self.options]
        if len(set(ids)) != 4 or len({o.text.strip().casefold() for o in self.options}) != 4 or ids.count(self.correctOptionId) != 1:
            raise ValueError('Invalid options/key')
        if not self.reference.url.startswith('https://'):
            raise ValueError('Invalid reference')
        if self.reviewStatus == 'approved' and (not self.review.get('approvedBy') or not self.review.get('approvedOn')):
            raise ValueError('Missing approval')
        return self


class Bank(Strict):
    schemaVersion: Literal['1']
    bankVersion: str
    releaseTargetPerTopic: Literal[50, 400]
    questions: list[Question]

    @model_validator(mode='after')
    def check(self):
        if len({q.id for q in self.questions}) != len(self.questions) or any(q.bankVersion != self.bankVersion for q in self.questions):
            raise ValueError('Duplicate identity/version mismatch')
        if self.releaseTargetPerTopic == 50:
            eligible = [q for q in self.questions if q.reviewStatus == 'approved']
            topics = {q.topicId for q in eligible}
            if not topics or any(sum(q.topicId == t for q in eligible) != 50 for t in topics):
                raise ValueError('The 50-question release requires complete approved topic coverage')
        return self


def load_bank(stage_id="stage-01"):
    topics = stage_topics(stage_id)
    path = BANK_PATH if stage_id == "stage-01" else ROOT / "data/question-banks" / f"{stage_id}.50.json"
    try:
        bank = Bank.model_validate(json.loads(path.read_text()))
        if set(q.topicId for q in bank.questions) != set(topics):
            raise ValueError('Stage coverage mismatch')
        return bank.bankVersion, {q.id: q.model_dump() for q in bank.questions if q.reviewStatus == 'approved'}
    except (OSError, ValueError):
        fail('bank_unavailable', 'The reviewed question bank is unavailable. Please retry.', 503)


def secret():
    configured = os.environ.get('SKILLPILOT_SIGNING_SECRET')
    if configured:
        if len(configured) < 32:
            fail('signing_unavailable', 'Signing configuration is invalid.', 503)
        return configured.encode()
    path = ROOT / '.local' / 'assessment-secret'
    try:
        path.parent.mkdir(mode=0o700, exist_ok=True)
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, 'wb') as file:
                file.write(secrets.token_bytes(32))
        key = path.read_bytes()
        if len(key) != 32:
            raise ValueError('Invalid signing key')
        return key
    except (OSError, ValueError):
        fail('signing_unavailable', 'The local signing key could not be loaded.', 503)


def encode(data):
    body = base64.urlsafe_b64encode(json.dumps(data, sort_keys=True, separators=(',', ':')).encode()).decode().rstrip('=')
    signature = hmac.new(secret(), body.encode(), hashlib.sha256).hexdigest()
    return body + '.' + signature


def decode(receipt, check_expiry=True):
    try:
        body, signature = receipt.split('.')
        if not hmac.compare_digest(hmac.new(secret(), body.encode(), hashlib.sha256).hexdigest(), signature):
            raise ValueError('signature')
        data = json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))
        if check_expiry and data['expiresAt'] <= time.time():
            fail('receipt_expired', 'This attempt expired. Discard it and start again.', 410)
        return data
    except (ValueError, KeyError, TypeError):
        fail('receipt_invalid', 'This attempt receipt is invalid. Discard it and start again.')


class Start(Strict):
    mode: Literal['diagnostic', 'practice', 'reassessment']
    stageId: str
    topicId: str | None = None
    bankVersion: str
    cycleId: str | None = Field(default=None, max_length=100)
    usedQuestionIds: list[str] = Field(default_factory=list, max_length=10000)
    diagnosticExposure: list[str] = Field(default_factory=list, max_length=10000)
    diagnosticTopicCounts: dict[str, int] = Field(default_factory=dict)


@router.get('/bank-info')
def bank_info(stageId: str = "stage-01"):
    topics = stage_topics(stageId)
    version, bank = load_bank(stageId)
    return {'stageId': stageId, 'bankVersion': version, 'releaseTargetPerTopic': 50, 'topics': [{'topicId': topic, 'bankSize': sum(q['topicId'] == topic for q in bank.values())} for topic in topics]}


def sample_topic(pool, n, exposure):
    fresh = [q for q in pool if q['id'] not in exposure]
    chosen = RNG.sample(fresh, min(n, len(fresh)))
    if len(chosen) < n:
        chosen += RNG.sample([q for q in pool if q['id'] in exposure], n - len(chosen))
    return chosen


@router.post('/start')
def start(request: Start):
    version, bank = load_bank(request.stageId)
    topics = stage_topics(request.stageId)
    if request.bankVersion != version:
        fail('bank_version_changed', 'The bank version changed. Acknowledge the new version before starting.')
    used, exposed = set(request.usedQuestionIds), set(request.diagnosticExposure)
    if len(used) != len(request.usedQuestionIds) or len(exposed) != len(request.diagnosticExposure) or not (used | exposed) <= bank.keys():
        fail('history_invalid', 'Question history is incompatible with this bank.', 422)
    if any(t not in topics or count < 0 for t, count in request.diagnosticTopicCounts.items()):
        fail('history_invalid', 'Invalid diagnostic exposure counts.', 422)
    warnings = ['Diagnostic exposure is tracked separately. Questions seen in a diagnostic may appear in topic quizzes.']
    if request.mode == 'diagnostic':
        if request.topicId is not None or request.cycleId is not None or used:
            fail('mode_invalid', 'Diagnostic cannot use a topic cycle.', 422)
        pools = {t: [q for q in bank.values() if q['topicId'] == t] for t in topics}
        if any(len(pool) < 3 for pool in pools.values()):
            fail('coverage_unavailable', 'Diagnostic needs at least three reviewed questions in every topic.', 503)
        selected = [q for pool in pools.values() for q in sample_topic(pool, 3, exposed)]
        for topic in sorted(topics, key=lambda t: (request.diagnosticTopicCounts.get(t, sum(q['id'] in exposed for q in pools[t])), topics.index(t))):
            remaining = [q for q in pools[topic] if q['id'] not in {s['id'] for s in selected}]
            if remaining:
                selected += sample_topic(remaining, 1, exposed)
            if len(selected) == 3 * len(topics) + 2:
                break
        if any(q['id'] in exposed for q in selected):
            warnings.append('This diagnostic includes previously seen diagnostic questions.')
        size = len(bank)
    else:
        if request.topicId not in topics or not request.cycleId or exposed or request.diagnosticTopicCounts:
            fail('mode_invalid', 'Topic quiz needs a topic and cycle, without diagnostic exposure.', 422)
        pool = [q for q in bank.values() if q['topicId'] == request.topicId]
        if any(bank[q]['topicId'] != request.topicId for q in used):
            fail('history_invalid', 'Used questions belong to another topic.', 422)
        remaining = [q for q in pool if q['id'] not in used]
        if not remaining:
            fail('bank_exhausted', 'This topic bank is exhausted. Explicitly start a new randomized cycle to continue.')
        selected = RNG.sample(remaining, min(20, len(remaining)))
        size = len(pool)
    if request.mode != 'diagnostic' and len(selected) < 20:
        warnings.append(f'Remainder attempt: {len(selected)} questions. Fewer than 20 questions is insufficient for mastery.')
    RNG.shuffle(selected)
    questions = []
    for q in selected:
        options = [dict(o) for o in q['options']]
        RNG.shuffle(options)
        questions.append({k: q[k] for k in ['id', 'topicId', 'conceptId', 'difficulty', 'prompt']} | {'options': options})
    issued = int(time.time())
    metadata = {'attemptId': str(uuid4()), 'mode': request.mode, 'stageId': request.stageId, 'topicId': request.topicId, 'bankVersion': version, 'cycleId': request.cycleId, 'issuedAt': issued, 'expiresAt': issued + 7 * 86400, 'selected': [{'id': q['id'], 'optionIds': [o['id'] for o in q['options']]} for q in questions]}
    return {k: v for k, v in metadata.items() if k != 'selected'} | {'receipt': encode(metadata), 'questionCount': len(questions), 'bankSize': size, 'coverage': [{'topicId': t, 'count': sum(q['topicId'] == t for q in selected)} for t in topics], 'warnings': warnings, 'questions': questions}


class Answer(Strict):
    questionId: str
    optionId: str


class Submit(Strict):
    receipt: str = Field(max_length=20000)
    answers: list[Answer] = Field(min_length=1, max_length=100)


@router.post('/submit')
def submit(request: Submit):
    data = decode(request.receipt)
    version, bank = load_bank(data['stageId'])
    return score_attempt(data, request.answers, version, bank)


def score_attempt(data, submitted_answers, version, bank):
    if data['bankVersion'] != version:
        fail('bank_version_changed', 'The bank changed. Discard this draft and start a new attempt.')
    topics_for_stage = stage_topics(data['stageId'])
    if any(q['topicId'] not in topics_for_stage for q in bank.values()):
        fail('stage_invalid', 'Attempt bank belongs to another stage.', 422)
    if data['mode'] != 'diagnostic' and data.get('topicId') not in topics_for_stage:
        fail('stage_invalid', 'Attempt topic belongs to another stage.', 422)
    expected = {q['id']: q['optionIds'] for q in data['selected']}
    answers = {a.questionId: a.optionId for a in submitted_answers}
    if len(answers) != len(submitted_answers) or answers.keys() != expected.keys() or any(a not in expected[q] for q, a in answers.items()):
        fail('answers_invalid', 'Provide exactly one delivered option for every question.', 422)
    if not expected.keys() <= bank.keys():
        fail('bank_version_changed', 'Attempt questions are no longer available.')
    feedback, topics = [], []
    for identity in expected:
        q = bank[identity]
        correct = answers[identity] == q['correctOptionId']
        feedback.append({'questionId': identity, 'selectedOptionId': answers[identity], 'correctOptionId': q['correctOptionId'], 'isCorrect': correct, 'explanation': q['explanation'], 'reference': q['reference']})
    for topic in topics_for_stage:
        ids = [q for q in expected if bank[q]['topicId'] == topic]
        if ids:
            topics.append({'topicId': topic, 'correct': sum(answers[q] == bank[q]['correctOptionId'] for q in ids), 'total': len(ids)})
    correct = sum(f['isCorrect'] for f in feedback)
    return {k: data[k] for k in ['attemptId', 'mode', 'stageId', 'topicId', 'bankVersion', 'cycleId']} | {'correct': correct, 'total': len(expected), 'percentage': 100 * correct / len(expected), 'topics': topics, 'feedback': feedback}
