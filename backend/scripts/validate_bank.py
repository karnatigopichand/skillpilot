"""Offline structural checks; editorial approval is a separate gate."""
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]


def validate(bank, curriculum, coverage, release=False, stage_id="stage-01"):
    errors = []
    topic_ids = {t['id'] for s in curriculum['path']['stages'] if s['id'] == stage_id for t in s['topics']}
    concepts = {t['topicId']: {c['id'] for c in t['concepts']} for t in coverage['topics']}
    ids, prompts = set(), set()
    counts = Counter()
    concept_counts, difficulty_counts = Counter(), Counter()
    if bank.get('schemaVersion') != '1':
        errors.append('Unsupported schema version')
    for q in bank.get('questions', []):
        identity = q.get('id', '<missing>')
        def error(message):
            errors.append(f'{identity}: {message}')
        required = ['id', 'topicId', 'conceptId', 'difficulty', 'prompt', 'options', 'correctOptionId', 'explanation', 'reference', 'bankVersion', 'reviewStatus', 'review']
        if any(field not in q for field in required):
            error('Missing required fields'); continue
        if not isinstance(identity, str) or not identity.strip() or identity in ids:
            error('Missing or duplicate ID')
        ids.add(identity)
        topic = q['topicId']
        if topic not in topic_ids or q['conceptId'] not in concepts.get(topic, set()):
            error('Unknown topic/concept mapping')
        counts[topic] += 1
        concept_counts[(topic, q['conceptId'])] += 1
        difficulty_counts[(topic, q['difficulty'])] += 1
        if q['difficulty'] not in {'easy', 'medium', 'hard'}:
            error('Unknown difficulty')
        if q['bankVersion'] != bank.get('bankVersion'):
            error('Bank version mismatch')
        prompt = re.sub(r'\W+', ' ', str(q['prompt']).casefold()).strip()
        if not prompt or prompt in prompts:
            error('Empty or duplicate normalized prompt')
        prompts.add(prompt)
        options = q['options']
        if not isinstance(options, list) or len(options) != 4:
            error('Exactly four options required'); continue
        option_ids = [o.get('id') for o in options]
        option_texts = [str(o.get('text', '')).strip().casefold() for o in options]
        if len(set(option_ids)) != 4 or not all(option_ids) or len(set(option_texts)) != 4 or not all(option_texts):
            error('Options must have unique nonempty IDs/text')
        if option_ids.count(q['correctOptionId']) != 1:
            error('Key must map to exactly one option')
        if not isinstance(q['explanation'], str) or not q['explanation'].strip():
            error('Missing explanation')
        ref = q['reference']
        if any(not ref.get(k) for k in ['url', 'title', 'locator', 'checkedOn']) or urlparse(ref.get('url', '')).scheme != 'https':
            error('Missing reference metadata or HTTPS URL')
        if q['reviewStatus'] not in {'draft', 'pending-user-review', 'approved', 'rejected'}:
            error('Invalid review status')
        if release and (q['reviewStatus'] != 'approved' or not q['review'].get('approvedBy') or not q['review'].get('approvedOn')):
            error('Release question is not approved')
    if release:
        if bank.get('releaseTargetPerTopic') != coverage.get('releaseTargetPerTopic', 400):
            errors.append('Release target metadata differs from approved coverage')
        for topic in topic_ids:
            if counts[topic] != coverage.get('releaseTargetPerTopic', 400):
                errors.append(f"{topic}: release requires {coverage.get('releaseTargetPerTopic', 400)} approved questions; found {counts[topic]}")
        for topic in topic_ids:
            for concept in coverage['topics']:
                if concept['topicId'] == topic:
                    for cell in concept['concepts']:
                        if concept_counts[(topic, cell['id'])] != cell['targetQuestions']:
                            errors.append(f"{topic}: concept {cell['id']} requires {cell['targetQuestions']} questions")
            for difficulty, target in coverage['difficultyTargets'].items():
                if difficulty_counts[(topic, difficulty)] != target:
                    errors.append(f'{topic}: difficulty {difficulty} requires {target} questions')
    return errors, dict(counts)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--bank', type=Path, default=ROOT / 'data/question-banks/ai-foundations.50.json')
    parser.add_argument('--stage', default='stage-01')
    parser.add_argument('--release', action='store_true')
    args = parser.parse_args()
    bank = json.loads(args.bank.read_text())
    curriculum = json.loads((ROOT / 'data/curriculum.json').read_text())
    coverage = json.loads((ROOT / 'data/question-banks/concept-coverage.json').read_text())
    errors, counts = validate(bank, curriculum, coverage, args.release, args.stage)
    print(json.dumps({'mode': 'release' if args.release else 'sample', 'counts': counts, 'errors': errors}, indent=2))
    raise SystemExit(bool(errors))
