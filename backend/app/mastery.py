import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter
from pydantic import Field
from .assessment import Strict, Answer, TOPICS, stage_topics, decode, fail, load_bank, score_attempt

router = APIRouter(prefix='/api/mastery')
RULES_PATH = Path(__file__).resolve().parents[1] / 'data/mastery-rules.json'


def load_rules():
    try:
        rules = json.loads(RULES_PATH.read_text())
        if rules['minimumQuestions'] != 20 or not 0 <= rules['developingPercent'] < rules['strongPercent'] <= 100 or set(rules['priority']) != {'Needs Attention', 'Developing', 'Insufficient Evidence', 'Unknown'}:
            raise ValueError('Invalid rules')
        return rules
    except (OSError, ValueError, KeyError, TypeError):
        fail('rules_unavailable', 'Mastery rules are unavailable. Please retry.', 503)


def interpret(attempts, baseline_id, version, rules, topics=None):
    topics = TOPICS if topics is None else topics
    ordered = sorted([a for a in attempts if a['bankVersion'] == version], key=lambda a: (datetime.fromisoformat(a['completedAt'].replace('Z', '+00:00')), a['attemptId']))
    rows, recommendations, optional = [], [], []
    for topic in topics:
        observations = []
        for attempt in ordered:
            evidence = next((t for t in attempt['topics'] if t['topicId'] == topic), None)
            if evidence:
                observations.append({k: attempt[k] for k in ['attemptId', 'mode', 'completedAt', 'bankVersion']} | {'correct': evidence['correct'], 'total': evidence['total'], 'percentage': 100 * evidence['correct'] / evidence['total']})
        diagnostic = [a for a in observations if a['mode'] == 'diagnostic']
        reassessment = [a for a in observations if a['mode'] == 'reassessment']
        qualifying = [a for a in reassessment if a['total'] >= rules['minimumQuestions']]
        latest_diag = diagnostic[-1] if diagnostic else None
        latest = reassessment[-1] if reassessment else None
        eligible = qualifying[-1] if qualifying else None
        baseline = next((a for a in diagnostic if a['attemptId'] == baseline_id), None)
        source = eligible or latest or latest_diag
        if eligible:
            score = eligible['percentage']
            status = 'Strong' if score >= rules['strongPercent'] else 'Developing' if score >= rules['developingPercent'] else 'Needs Attention'
            reason = f"Latest qualifying reassessment: {eligible['correct']}/{eligible['total']} ({score:.1f}%). Status follows the {rules['developingPercent']}%/{rules['strongPercent']}% boundaries."
        elif source:
            status = 'Insufficient Evidence'
            reason = f"Observed {source['mode']}: {source['correct']}/{source['total']}. A single reassessment with at least {rules['minimumQuestions']} questions is required; diagnostic and short attempts do not qualify."
        else:
            status = 'Unknown'
            reason = 'No current-bank diagnostic or reassessment evidence. Practice feedback does not establish mastery.'
        row = {'topicId': topic, 'status': status, 'baseline': baseline, 'latestDiagnostic': latest_diag, 'latestReassessment': latest, 'latestEligible': eligible, 'evidenceReason': reason, 'observedDifference': latest['percentage'] - baseline['percentage'] if latest and baseline else None}
        rows.append(row)
        item = {'topicId': topic, 'reason': reason, 'sourceAttemptId': source['attemptId'] if source else None, 'action': 'diagnostic' if not any(a['mode'] == 'diagnostic' for a in ordered) else 'practice'}
        if status == 'Strong':
            optional.append(item | {'reason': reason + ' Optional review; quiz evidence is not professional certification.'})
        else:
            recommendations.append(item | {'priority': rules['priority'].index(status), '_score': source['percentage'] if source else 101})
    recommendations.sort(key=lambda r: (r['priority'], r['_score'], topics.index(r['topicId'])))
    for r in recommendations:
        del r['_score']
    return {'rulesVersion': rules['rulesVersion'], 'bankVersion': version, 'topics': rows, 'recommendations': recommendations, 'optionalReview': optional}


class Evidence(Strict):
    receipt: str = Field(max_length=20000)
    answers: list[Answer] = Field(min_length=1, max_length=100)
    completedAt: str


class Evaluation(Strict):
    schemaVersion: Literal[1]
    curriculumVersion: Literal['2026-10-07.1', '2026-10-07.2']
    stageId: str = 'stage-01'
    bankVersion: str
    initialDiagnosticAttemptId: str | None = None
    historicalBaseline: bool = False
    attempts: list[Evidence] = Field(max_length=2000)


@router.post('/evaluate')
def evaluate(request: Evaluation):
    version, bank = load_bank(request.stageId)
    if request.bankVersion != version:
        fail('bank_version_changed', 'Question bank changed. Reload the current evidence.')
    attempts, identities = [], set()
    for evidence in request.attempts:
        try:
            date = datetime.fromisoformat(evidence.completedAt.replace('Z', '+00:00'))
            if date.tzinfo is None or date > datetime.now(timezone.utc):
                raise ValueError('Invalid date')
        except ValueError:
            fail('evidence_invalid', 'Completion dates must be valid past timestamps with a timezone.', 422)
        data = decode(evidence.receipt, check_expiry=False)
        if data['stageId'] != request.stageId:
            fail('stage_invalid', 'Evidence belongs to another stage.', 422)
        if data['attemptId'] in identities:
            fail('evidence_invalid', 'Duplicate or conflicting completed attempt.', 422)
        identities.add(data['attemptId'])
        scored = score_attempt(data, evidence.answers, version, bank)
        attempts.append(scored | {'completedAt': evidence.completedAt})
    diagnostic = sorted([a for a in attempts if a['mode'] == 'diagnostic'], key=lambda a: (datetime.fromisoformat(a['completedAt'].replace('Z', '+00:00')), a['attemptId']))
    if request.historicalBaseline:
        if not request.initialDiagnosticAttemptId or request.initialDiagnosticAttemptId in identities:
            fail('baseline_invalid', 'Historical baseline reference is inconsistent.', 422)
    elif diagnostic:
        if request.initialDiagnosticAttemptId != diagnostic[0]['attemptId']:
            fail('baseline_invalid', 'Preserve the first completed diagnostic as baseline.', 422)
    elif request.initialDiagnosticAttemptId:
        fail('baseline_invalid', 'Diagnostic baseline is missing.', 422)
    return interpret(attempts, request.initialDiagnosticAttemptId, version, load_rules(), stage_topics(request.stageId))
