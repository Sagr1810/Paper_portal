"""
Tests for the CSV exam parser and template-based paper creation.
"""
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.csv_exam_parser import parse_exam_csv, build_sections_config, csv_to_exam_config


SAMPLE_DATA = os.path.join(os.path.dirname(__file__), '..', '..', 'sample_data')


# ── CSV parser tests ─────────────────────────────────────────────────────────

def test_parse_bachelors_102():
    path = os.path.join(SAMPLE_DATA, 'BACHELORS_ESE_102_MARKS.csv')
    result = parse_exam_csv(open(path, encoding='utf-8-sig').read())
    assert result['total_marks'] == 102.0
    assert len(result['sections']) == 5  # Q1, Q2, Q3, Q4, Q5
    # Q1 should have 12 slots
    q1 = result['sections'][0]
    assert q1['name'] == 'Q1'
    assert len(q1['questions']) == 12
    # All Q1 slots should have marks=1
    assert all(q['marks'] == 1.0 for q in q1['questions'])
    # Q1 mandatory
    assert q1['mandatory'] is True


def test_parse_bachelors_86():
    path = os.path.join(SAMPLE_DATA, 'BACHELORS_ESE_86_MARKS.csv')
    result = parse_exam_csv(open(path, encoding='utf-8-sig').read())
    assert result['total_marks'] == 86.0
    assert len(result['sections']) == 5
    # Q1 has 10 slots
    q1 = result['sections'][0]
    assert len(q1['questions']) == 10


def test_parse_masters_102():
    path = os.path.join(SAMPLE_DATA, 'MASTERS_ESE_102_MARKS.csv')
    result = parse_exam_csv(open(path, encoding='utf-8-sig').read())
    assert result['total_marks'] == 102.0
    sections = result['sections']
    assert len(sections) >= 2
    # Q1 has 3 sub-questions (A=3m, B=4m, C=5m) in Masters format "Q1. A"
    q1 = next((s for s in sections if s['name'] == 'Q1'), None)
    assert q1 is not None, "Q1 section should exist"
    assert len(q1['questions']) == 3
    marks = sorted([q['marks'] for q in q1['questions']])
    assert marks == [3.0, 4.0, 5.0]


def test_parse_masters_88():
    path = os.path.join(SAMPLE_DATA, 'MASTERS_ESE_88_MARKS.csv')
    result = parse_exam_csv(open(path, encoding='utf-8-sig').read())
    assert result['total_marks'] == 88.0


def test_parse_midsem_80():
    path = os.path.join(SAMPLE_DATA, 'MIDSEM_REMEDIAL_BACHLORS_MASTER_80_MARKS.csv')
    result = parse_exam_csv(open(path, encoding='utf-8-sig').read())
    assert result['total_marks'] == 80.0


def test_or_groups_detected():
    """OR alternatives should have is_or=True and an or_group."""
    path = os.path.join(SAMPLE_DATA, 'BACHELORS_ESE_102_MARKS.csv')
    result = parse_exam_csv(open(path, encoding='utf-8-sig').read())
    # Q2 has Pattern A: each sub-question gets its own OR group
    # After Phase 2 retroactive grouping, mandatory 2B gets "2B_or", 2C gets "2C_or"
    q2 = next(s for s in result['sections'] if s['name'] == 'Q2')
    or_slots = [q for q in q2['questions'] if q['is_or']]
    mandatory_slots = [q for q in q2['questions'] if not q['is_or']]
    assert len(or_slots) > 0, "Q2 should have OR alternatives"
    assert len(mandatory_slots) > 0
    # OR slots have an or_group
    assert all(q['or_group'] is not None for q in or_slots)
    # Pattern A: 2A has or_group=None; 2B and 2C have per-slot groups
    ungrouped_mandatory = [q for q in mandatory_slots if q['or_group'] is None]
    grouped_mandatory = [q for q in mandatory_slots if q['or_group'] is not None]
    assert len(ungrouped_mandatory) == 1, \
        f"Q2: only 2A should be ungrouped, got {[q['slot_id'] for q in ungrouped_mandatory]}"
    assert len(grouped_mandatory) == 2, \
        f"Q2: 2B and 2C should each have their own or_group"
    # Each mandatory's or_group matches its own slot_id (single-slot groups kept original name)
    for q in grouped_mandatory:
        assert q['or_group'] == f"{q['slot_id']}_or", \
            f"Q2: {q['slot_id']}.or_group should be '{q['slot_id']}_or', got {q['or_group']!r}"


def test_q4_q5_whole_question_or():
    """
    Q4 and Q5 use Pattern B: the entire question (a)+(b)+(c) is OR'd against
    another full (a)+(b)+(c). ALL mandatory sub-questions and ALL OR alternatives
    should share the same or_group ('Q4_or' / 'Q5_or').
    """
    path = os.path.join(SAMPLE_DATA, 'BACHELORS_ESE_102_MARKS.csv')
    result = parse_exam_csv(open(path, encoding='utf-8-sig').read())

    for qname in ('Q4', 'Q5'):
        sec = next(s for s in result['sections'] if s['name'] == qname)
        mandatory = [q for q in sec['questions'] if not q['is_or']]
        or_alts   = [q for q in sec['questions'] if q['is_or']]

        # There must be 3 mandatory sub-questions and 3 OR alternatives
        assert len(mandatory) == 3, f"{qname}: expected 3 mandatory slots, got {len(mandatory)}"
        assert len(or_alts) == 3,   f"{qname}: expected 3 OR alt slots, got {len(or_alts)}"

        # All mandatory slots must be in the same whole-question OR group
        expected_group = f"{qname}_or"
        for q in mandatory:
            assert q['or_group'] == expected_group, \
                f"{qname} mandatory {q['slot_id']}: expected or_group={expected_group!r}, got {q['or_group']!r}"

        # All OR alt slots must be in the same group
        for q in or_alts:
            assert q['or_group'] == expected_group, \
                f"{qname} OR alt {q['slot_id']}: expected or_group={expected_group!r}, got {q['or_group']!r}"

        # OR alt base slot_ids should correspond to the mandatory slot_ids
        mandatory_ids = {q['slot_id'] for q in mandatory}
        import re
        or_base_ids = {re.sub(r'_alt\d+$', '', q['slot_id']) for q in or_alts}
        assert mandatory_ids == or_base_ids, \
            f"{qname}: OR alt base IDs {or_base_ids} should match mandatory IDs {mandatory_ids}"


def test_q3_partial_or_pattern():
    """
    Q3: (a) is mandatory for all; (b)+(c) are in a choice group (Pattern B-partial).
    The OR group should be named "Q3_or" (multi-slot group gets question-level name).
    3A must have or_group=None (not in the OR group).
    3B and 3C must have or_group="Q3_or".
    """
    for filename in ('BACHELORS_ESE_102_MARKS.csv', 'BACHELORS_ESE_86_MARKS.csv',
                     'MASTERS_ESE_102_MARKS.csv', 'MASTERS_ESE_88_MARKS.csv'):
        path = os.path.join(SAMPLE_DATA, filename)
        result = parse_exam_csv(open(path, encoding='utf-8-sig').read())
        q3 = next((s for s in result['sections'] if s['name'] == 'Q3'), None)
        if q3 is None:
            continue

        or_alts = [q for q in q3['questions'] if q['is_or']]
        mandatory = [q for q in q3['questions'] if not q['is_or']]
        assert len(or_alts) > 0, f"{filename} Q3 should have OR alternatives"

        # All OR alts must share "Q3_or"
        assert all(q['or_group'] == 'Q3_or' for q in or_alts), \
            f"{filename} Q3: OR alts should have or_group='Q3_or'"

        # 3B and 3C mandatories must have or_group="Q3_or"; 3A must be None
        grouped = [q for q in mandatory if q['or_group'] == 'Q3_or']
        ungrouped = [q for q in mandatory if q['or_group'] is None]
        assert len(grouped) == 2, \
            f"{filename} Q3: expected 2 mandatory slots in Q3_or group, got {len(grouped)}: {[q['slot_id'] for q in grouped]}"
        assert len(ungrouped) == 1, \
            f"{filename} Q3: expected 1 ungrouped mandatory (3A), got {len(ungrouped)}"
        assert ungrouped[0]['slot_id'].endswith('A') or ungrouped[0]['slot_id'].endswith('a'), \
            f"{filename} Q3: ungrouped mandatory should be (a), got {ungrouped[0]['slot_id']}"


def test_all_csvs_q4_q5_whole_question_or():
    """
    All 5 CSV files: Q4 and Q5 should use Pattern B whole-question OR.
    Mandatory sub-questions in Q4/Q5 must all share the same or_group.
    """
    files = [
        'BACHELORS_ESE_102_MARKS.csv',
        'BACHELORS_ESE_86_MARKS.csv',
        'MASTERS_ESE_102_MARKS.csv',
        'MASTERS_ESE_88_MARKS.csv',
        # MIDSEM only has Q1-Q4, skip Q5 for that file
    ]
    for filename in files:
        path = os.path.join(SAMPLE_DATA, filename)
        result = parse_exam_csv(open(path, encoding='utf-8-sig').read())
        for qname in ('Q4', 'Q5'):
            sec = next((s for s in result['sections'] if s['name'] == qname), None)
            if sec is None:
                continue
            mandatory = [q for q in sec['questions'] if not q['is_or']]
            expected_group = f"{qname}_or"
            for q in mandatory:
                assert q['or_group'] == expected_group, \
                    f"{filename} {qname} mandatory {q['slot_id']}: " \
                    f"expected or_group={expected_group!r}, got {q['or_group']!r}"


def test_midsem_q4_whole_question_or():
    """MIDSEM CSV also has Q4 as whole-question OR (no Q5)."""
    path = os.path.join(SAMPLE_DATA, 'MIDSEM_REMEDIAL_BACHLORS_MASTER_80_MARKS.csv')
    result = parse_exam_csv(open(path, encoding='utf-8-sig').read())
    q4 = next((s for s in result['sections'] if s['name'] == 'Q4'), None)
    assert q4 is not None
    mandatory = [q for q in q4['questions'] if not q['is_or']]
    for q in mandatory:
        assert q['or_group'] == 'Q4_or', \
            f"MIDSEM Q4 mandatory {q['slot_id']}: expected or_group='Q4_or', got {q['or_group']!r}"


def test_build_sections_config():
    """sections_config should have correct structure for DB storage."""
    path = os.path.join(SAMPLE_DATA, 'BACHELORS_ESE_102_MARKS.csv')
    content = open(path, encoding='utf-8-sig').read()
    parsed = parse_exam_csv(content)
    sections_config = build_sections_config(parsed)

    assert len(sections_config) == 5
    q1_cfg = sections_config[0]
    assert q1_cfg['name'] == 'Q1'
    assert q1_cfg['mandatory'] is True
    assert q1_cfg['questions_required'] == 12
    assert q1_cfg['marks_per_question'] == 1.0
    assert q1_cfg['allow_choice'] is False
    assert 'slots' in q1_cfg
    assert len(q1_cfg['slots']) == 12


def test_q2_section_has_choice():
    path = os.path.join(SAMPLE_DATA, 'BACHELORS_ESE_102_MARKS.csv')
    content = open(path, encoding='utf-8-sig').read()
    parsed = parse_exam_csv(content)
    sections_config = build_sections_config(parsed)
    q2_cfg = sections_config[1]
    assert q2_cfg['allow_choice'] is True
    assert q2_cfg['name'] == 'Q2'


def test_csv_to_exam_config():
    path = os.path.join(SAMPLE_DATA, 'BACHELORS_ESE_102_MARKS.csv')
    result = csv_to_exam_config(path, 'end_semester', 'bachelor', "Bachelor's ESE 102")
    assert result['total_marks'] == 102.0
    assert result['exam_type'] == 'end_semester'
    assert result['program_type'] == 'bachelor'
    assert len(result['sections_config']) == 5


def test_all_csv_files_parse_without_error():
    """All 5 uploaded CSV files should parse successfully."""
    files = [
        ('BACHELORS_ESE_102_MARKS.csv', 102.0),
        ('BACHELORS_ESE_86_MARKS.csv', 86.0),
        ('MASTERS_ESE_102_MARKS.csv', 102.0),
        ('MASTERS_ESE_88_MARKS.csv', 88.0),
        ('MIDSEM_REMEDIAL_BACHLORS_MASTER_80_MARKS.csv', 80.0),
    ]
    for filename, expected_total in files:
        path = os.path.join(SAMPLE_DATA, filename)
        result = parse_exam_csv(open(path, encoding='utf-8-sig').read())
        assert result['total_marks'] == expected_total, f"{filename}: expected {expected_total}, got {result['total_marks']}"
        assert len(result['sections']) >= 1


# ── Template endpoint tests (integration) ────────────────────────────────────

def test_template_endpoint_returns_config(client, faculty_token, hdr):
    """GET /api/papers/template/{id} should return sections_config."""
    # Config ID 1 = Bachelor's ESE 102 (seeded)
    r = client.get('/api/papers/template/1', headers=hdr(faculty_token))
    # May 200 or 404 depending on whether seed ran — just test it's valid JSON
    assert r.status_code in (200, 404)
    if r.status_code == 200:
        data = r.json()
        assert 'sections_config' in data
        assert data['total_marks'] > 0


def test_from_template_creates_paper(client, faculty_token, hdr):
    """POST /api/papers/from-template should create a draft paper with slot rows."""
    # First check if exam configs exist
    r_configs = client.get('/api/master/exam-configs', headers=hdr(faculty_token))
    assert r_configs.status_code == 200
    configs = r_configs.json()
    if not configs:
        pytest.skip("No exam configurations seeded")

    # Get a subject
    r_subjects = client.get('/api/master/subjects', headers=hdr(faculty_token))
    subjects = r_subjects.json()
    if not subjects:
        pytest.skip("No subjects seeded")

    config_id = configs[0]['id']
    subject_id = subjects[0]['id']

    r = client.post('/api/papers/from-template', headers=hdr(faculty_token), json={
        'subject_id': subject_id,
        'configuration_id': config_id,
        'title': 'Test Template Paper',
        'academic_year': '2025-2026',
    })
    assert r.status_code == 201
    data = r.json()
    assert 'paper_id' in data
    assert data['total_marks'] > 0


def test_assign_co_blooms_updates_analysis(client, faculty_token, hdr):
    """PUT /api/papers/{id}/assign-co-blooms should save and recalculate."""
    # Create a paper first
    r_configs = client.get('/api/master/exam-configs', headers=hdr(faculty_token))
    configs = r_configs.json()
    r_subjects = client.get('/api/master/subjects', headers=hdr(faculty_token))
    subjects = r_subjects.json()
    if not configs or not subjects:
        pytest.skip("No configs or subjects seeded")

    r_create = client.post('/api/papers/from-template', headers=hdr(faculty_token), json={
        'subject_id': subjects[0]['id'],
        'configuration_id': configs[0]['id'],
        'title': 'CO Blooms Test Paper',
        'academic_year': '2025-2026',
    })
    assert r_create.status_code == 201
    paper_id = r_create.json()['paper_id']

    # Get paper to find slot IDs
    r_paper = client.get(f'/api/papers/{paper_id}', headers=hdr(faculty_token))
    assert r_paper.status_code == 200
    paper = r_paper.json()

    # Get COs and Bloom's
    r_cos = client.get(f'/api/master/cos?subject_id={subjects[0]["id"]}', headers=hdr(faculty_token))
    r_blooms = client.get('/api/master/blooms', headers=hdr(faculty_token))
    cos = r_cos.json()
    blooms = r_blooms.json()
    if not cos or not blooms:
        pytest.skip("No COs or Bloom's levels seeded")

    co_id = cos[0]['id']
    blooms_id = blooms[0]['id']

    # Collect first few slots
    slots_to_assign = []
    for sec in paper.get('sections', []):
        for q in sec.get('questions', [])[:2]:
            slots_to_assign.append({
                'slot_id': q['id'],
                'co_id': co_id,
                'blooms_id': blooms_id,
            })
        if slots_to_assign:
            break

    if not slots_to_assign:
        pytest.skip("No slots found in paper")

    r_assign = client.put(
        f'/api/papers/{paper_id}/assign-co-blooms',
        headers=hdr(faculty_token),
        json={'slots': slots_to_assign},
    )
    assert r_assign.status_code == 200
    result = r_assign.json()
    assert 'analysis' in result
    assert 'co_distribution' in result['analysis']
    assert 'blooms_distribution' in result['analysis']


# Fixtures (client, faculty_token, hdr, setup_db) are provided by conftest.py
