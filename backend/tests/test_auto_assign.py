"""
Tests for the auto-assign engine (CO + Bloom's distribution from targets).
"""
import pytest
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.auto_assign_engine import (
    SlotAssignment,
    auto_assign_co_blooms,
    compute_actual_distribution,
    build_gap_report,
)


def make_slots(spec):
    """
    spec: list of (slot_id, marks, is_or=False, or_group=None)
    """
    slots = []
    for i, item in enumerate(spec):
        if len(item) == 2:
            sid, m = item
            is_or, og = False, None
        else:
            sid, m, is_or, og = item
        slots.append(SlotAssignment(
            slot_db_id=i,
            slot_id=sid,
            marks=float(m),
            is_or=is_or,
            or_group=og,
        ))
    return slots


# ── Basic auto-assign tests ──────────────────────────────────────────────────

def test_auto_assign_equal_co_targets():
    """4 COs at 25% each on a 100-mark paper: each CO gets ~25 marks."""
    slots = make_slots([
        ('Q1a', 5), ('Q1b', 5), ('Q1c', 5), ('Q1d', 5),
        ('Q2a', 10), ('Q2b', 10), ('Q2c', 5), ('Q2d', 5),
        ('Q3a', 10), ('Q3b', 10), ('Q3c', 5), ('Q3d', 5),
        ('Q4a', 10), ('Q4b', 10),
    ])
    # total = 100
    total = sum(s.marks for s in slots)
    co_targets = {'CO1': 25, 'CO2': 25, 'CO3': 25, 'CO4': 25}
    bl_targets = {'R': 20, 'U': 20, 'Ap': 20, 'An': 20, 'E': 20}

    result = auto_assign_co_blooms(slots, total, co_targets, bl_targets)

    # Every slot should have an assigned CO
    assert all(s.assigned_co is not None for s in result)
    # Every slot should have an assigned Bloom's level
    assert all(s.assigned_blooms is not None for s in result)


def test_auto_assign_co_codes_are_from_targets():
    """Assigned COs must only be from the target list."""
    slots = make_slots([('Q1', 10), ('Q2', 15), ('Q3', 20), ('Q4', 5)])
    co_targets = {'CO1': 40, 'CO2': 60}
    bl_targets = {'R': 50, 'Ap': 50}
    result = auto_assign_co_blooms(slots, 50, co_targets, bl_targets)
    for s in result:
        assert s.assigned_co in ('CO1', 'CO2')
        assert s.assigned_blooms in ('R', 'Ap')


def test_or_alternatives_mirror_canonical():
    """OR alternatives should get the same CO/Bloom's as their canonical slot."""
    slots = make_slots([
        ('2A', 3),
        ('2B', 4),
        ('2B_alt0', 4, True, '2B_or'),   # OR alternative of 2B
        ('2C', 5),
        ('2C_alt0', 5, True, '2C_or'),   # OR alternative of 2C
    ])
    co_targets = {'CO1': 50, 'CO2': 50}
    bl_targets = {'R': 40, 'Ap': 60}
    result = auto_assign_co_blooms(slots, 12, co_targets, bl_targets)

    slot_map = {s.slot_id: s for s in result}
    # 2B and its alt must have same CO and Bloom's
    assert slot_map['2B'].assigned_co == slot_map['2B_alt0'].assigned_co
    assert slot_map['2B'].assigned_blooms == slot_map['2B_alt0'].assigned_blooms
    # 2C and its alt must match
    assert slot_map['2C'].assigned_co == slot_map['2C_alt0'].assigned_co
    assert slot_map['2C'].assigned_blooms == slot_map['2C_alt0'].assigned_blooms


def test_marks_based_weighting():
    """Bigger slots should be assigned to COs with larger quotas first."""
    # CO1=70%, CO2=30% on 100m paper
    # The 40-mark slot should go to CO1
    slots = make_slots([('big', 40), ('small1', 10), ('small2', 10), ('small3', 20), ('small4', 20)])
    co_targets = {'CO1': 70, 'CO2': 30}
    bl_targets = {'Ap': 100}
    result = auto_assign_co_blooms(slots, 100, co_targets, bl_targets)
    slot_map = {s.slot_id: s for s in result}
    # The big 40m slot should be assigned to CO1 (largest quota)
    assert slot_map['big'].assigned_co == 'CO1'


def test_distribution_totals_are_correct():
    """compute_actual_distribution should sum marks correctly."""
    slots = make_slots([
        ('Q1', 10), ('Q2', 20), ('Q3', 30),
    ])
    slots[0].assigned_co = 'CO1'
    slots[1].assigned_co = 'CO2'
    slots[2].assigned_co = 'CO1'
    slots[0].assigned_blooms = 'R'
    slots[1].assigned_blooms = 'U'
    slots[2].assigned_blooms = 'R'

    actual = compute_actual_distribution(slots, 60)
    assert actual['co_distribution']['CO1']['raw_marks'] == 40.0
    assert actual['co_distribution']['CO2']['raw_marks'] == 20.0
    assert round(actual['co_distribution']['CO1']['percent'], 1) == round(40/60*100, 1)
    assert actual['blooms_distribution']['R']['raw_marks'] == 40.0


def test_or_groups_not_double_counted_in_totals():
    """OR alternatives should NOT double-count in total marks."""
    slots = make_slots([
        ('2A', 5),
        ('2B', 10),
        ('2B_alt0', 10, True, '2B_or'),
    ])
    slots[0].assigned_co = 'CO1'
    slots[1].assigned_co = 'CO2'
    slots[2].assigned_co = 'CO2'  # same as canonical
    slots[0].assigned_blooms = 'R'
    slots[1].assigned_blooms = 'Ap'
    slots[2].assigned_blooms = 'Ap'

    actual = compute_actual_distribution(slots, 15)
    # Total counted = 5 + 10 = 15 (2B_alt0 not counted in total)
    assert actual['total_marks_counted'] == 15.0
    # But CO2 attribution includes BOTH 2B and 2B_alt0 marks (full coverage)
    assert actual['co_distribution']['CO2']['raw_marks'] == 20.0


def test_normalised_targets():
    """Targets that don't sum to 100 should be normalised."""
    slots = make_slots([('Q1', 50), ('Q2', 50)])
    # These sum to 50, not 100 — should still work
    co_targets = {'CO1': 20, 'CO2': 30}
    bl_targets = {'R': 10, 'Ap': 40}
    result = auto_assign_co_blooms(slots, 100, co_targets, bl_targets)
    # All slots should be assigned
    assert all(s.assigned_co is not None for s in result)


def test_gap_report_detects_gaps():
    """build_gap_report should flag gaps > 5%."""
    actual = {
        "co_distribution": {
            "CO1": {"marks": 80, "percent": 80.0},
            "CO2": {"marks": 20, "percent": 20.0},
        },
        "blooms_distribution": {},
    }
    co_targets = {"CO1": 50, "CO2": 50}
    gaps = build_gap_report(actual, co_targets, {})
    assert len(gaps) > 0
    # CO1 gap = |80-50| = 30%
    assert any('CO1' in g for g in gaps)


def test_gap_report_no_gaps_when_close():
    """No gaps when actual is within tolerance."""
    actual = {
        "co_distribution": {
            "CO1": {"marks": 52, "percent": 52.0},
            "CO2": {"marks": 48, "percent": 48.0},
        },
        "blooms_distribution": {},
    }
    co_targets = {"CO1": 50, "CO2": 50}
    gaps = build_gap_report(actual, co_targets, {}, tolerance=5.0)
    assert len(gaps) == 0


# ── Integration: auto-assign endpoint ───────────────────────────────────────

def test_auto_assign_endpoint_preview(client, faculty_token, hdr):
    """POST /api/papers/{id}/auto-assign with save=false should preview."""
    r_configs = client.get('/api/master/exam-configs', headers=hdr(faculty_token))
    r_subjects = client.get('/api/master/subjects', headers=hdr(faculty_token))
    configs = r_configs.json()
    subjects = r_subjects.json()
    if not configs or not subjects:
        pytest.skip("No configs or subjects")

    # Create a template paper
    r_paper = client.post('/api/papers/from-template', headers=hdr(faculty_token), json={
        'subject_id': subjects[0]['id'],
        'configuration_id': configs[0]['id'],
        'title': 'Auto-Assign Test Paper',
        'academic_year': '2025-2026',
    })
    assert r_paper.status_code == 201
    paper_id = r_paper.json()['paper_id']

    # Get COs for the subject
    r_cos = client.get(f'/api/master/cos?subject_id={subjects[0]["id"]}', headers=hdr(faculty_token))
    cos = r_cos.json()
    if not cos:
        pytest.skip("No COs for subject")

    # Build CO targets
    eq = round(100 / len(cos))
    co_targets = {co['co_code']: eq for co in cos}

    # Preview (save=false)
    r_assign = client.post(f'/api/papers/{paper_id}/auto-assign', headers=hdr(faculty_token), json={
        'co_targets': co_targets,
        'blooms_targets': {'R': 15, 'U': 20, 'Ap': 30, 'An': 20, 'E': 10, 'C': 5},
        'save': False,
    })
    assert r_assign.status_code == 200
    data = r_assign.json()
    assert 'slots' in data
    assert 'analysis' in data
    assert 'gaps' in data
    assert data['saved'] is False
    assert len(data['slots']) > 0
    # Every slot should have assigned_co
    for slot in data['slots']:
        assert slot['assigned_co'] is not None


def test_auto_assign_endpoint_save(client, faculty_token, hdr):
    """POST /api/papers/{id}/auto-assign with save=true should persist."""
    r_configs = client.get('/api/master/exam-configs', headers=hdr(faculty_token))
    r_subjects = client.get('/api/master/subjects', headers=hdr(faculty_token))
    configs = r_configs.json()
    subjects = r_subjects.json()
    if not configs or not subjects:
        pytest.skip("No configs or subjects")

    r_paper = client.post('/api/papers/from-template', headers=hdr(faculty_token), json={
        'subject_id': subjects[0]['id'],
        'configuration_id': configs[0]['id'],
        'title': 'Auto-Assign Save Test',
        'academic_year': '2025-2026',
    })
    paper_id = r_paper.json()['paper_id']

    r_cos = client.get(f'/api/master/cos?subject_id={subjects[0]["id"]}', headers=hdr(faculty_token))
    cos = r_cos.json()
    if not cos:
        pytest.skip("No COs")

    eq = round(100 / len(cos))
    co_targets = {co['co_code']: eq for co in cos}

    r_assign = client.post(f'/api/papers/{paper_id}/auto-assign', headers=hdr(faculty_token), json={
        'co_targets': co_targets,
        'blooms_targets': {'R': 15, 'U': 20, 'Ap': 30, 'An': 20, 'E': 10, 'C': 5},
        'save': True,
    })
    assert r_assign.status_code == 200
    data = r_assign.json()
    assert data['saved'] is True

    # Verify the paper's analysis was updated
    r_analysis = client.get(f'/api/papers/{paper_id}/analysis', headers=hdr(faculty_token))
    assert r_analysis.status_code == 200
    analysis = r_analysis.json()
    # CO distribution should have entries
    assert analysis['co_distribution'] is not None
    assert len(analysis['co_distribution']) > 0
