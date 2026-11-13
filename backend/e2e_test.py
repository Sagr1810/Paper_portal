"""
End-to-end workflow test:
1. Faculty creates paper from template (Bachelor ESE 102)
2. Faculty sets CO targets (CO1=25%, CO2=30%, CO3=25%, CO4=20%)
3. Faculty sets Bloom's targets (R=15%, U=20%, Ap=30%, An=20%, E=10%, C=5%)
4. Faculty previews distribution
5. Faculty auto-assigns & saves
6. Faculty submits paper for review
7. HOD reviews and approves
8. Principal approves
9. Exam Cell finalizes
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def get_token(email, password):
    r = client.post('/api/auth/login', json={'email': email, 'password': password})
    assert r.status_code == 200, f"Login failed: {r.text}"
    return r.json()['access_token']

def hdr(token):
    return {'Authorization': f'Bearer {token}'}

def run():
    print("=== End-to-End Workflow Test ===\n")

    # Get tokens
    faculty_tok = get_token('faculty@portal.edu', 'Faculty@1234')
    hod_tok     = get_token('hod@portal.edu',     'Hod@1234')
    principal_tok = get_token('principal@portal.edu', 'Principal@1234')
    examcell_tok  = get_token('examcell@portal.edu',  'ExamCell@1234')
    print("PASS: All logins successful\n")

    # Get exam configs and subjects
    r = client.get('/api/master/exam-configs', headers=hdr(faculty_tok))
    configs = r.json()
    assert len(configs) > 0, "No exam configs found"
    config = next((c for c in configs if '102' in c['name'] and 'Bachelor' in c['name']), configs[0])
    print(f"Using config: {config['name']} ({config['total_marks']}m, {len(config['sections_config'])} sections)")

    r = client.get('/api/master/subjects', headers=hdr(faculty_tok))
    subjects = r.json()
    assert len(subjects) > 0, "No subjects found"
    subject = subjects[0]
    print(f"Using subject: {subject['subject_code']} — {subject['subject_name']}\n")

    # Step 1: Create paper from template
    r = client.post('/api/papers/from-template', headers=hdr(faculty_tok), json={
        'subject_id': subject['id'],
        'configuration_id': config['id'],
        'title': 'E2E Test: ESE Nov 2025 — Data Structures',
        'academic_year': '2025-2026',
    })
    assert r.status_code == 201, f"Create failed: {r.text}"
    paper_id = r.json()['paper_id']
    total_marks = r.json()['total_marks']
    print(f"PASS Step 1: Paper created (ID={paper_id}, {total_marks}m)")

    # Get paper structure
    r = client.get(f'/api/papers/{paper_id}', headers=hdr(faculty_tok))
    paper = r.json()
    total_slots = sum(len(sec['questions']) for sec in paper['sections'])
    print(f"       Paper has {len(paper['sections'])} sections, {total_slots} slots")

    # Get COs
    r = client.get(f'/api/master/cos?subject_id={subject["id"]}', headers=hdr(faculty_tok))
    cos = r.json()
    print(f"       COs available: {[c['co_code'] for c in cos]}")

    # Step 2-4: Auto-assign CO & Bloom's (preview first)
    co_targets = {'CO1': 25, 'CO2': 30, 'CO3': 25, 'CO4': 20}
    blooms_targets = {'R': 15, 'U': 20, 'Ap': 30, 'An': 20, 'E': 10, 'C': 5}

    r = client.post(f'/api/papers/{paper_id}/auto-assign', headers=hdr(faculty_tok), json={
        'co_targets': co_targets,
        'blooms_targets': blooms_targets,
        'save': False,
    })
    assert r.status_code == 200, f"Preview failed: {r.text}"
    preview = r.json()
    print(f"\nPASS Step 2-4: Preview distribution (saved={preview['saved']})")
    co_dist_str = {k: str(v['percent'])+'%' for k,v in preview['analysis']['co_distribution'].items()}
    bl_dist_str = {k: str(v['percent'])+'%' for k,v in preview['analysis']['blooms_distribution'].items()}
    print("  CO distribution:", co_dist_str)
    print("  Bloom's distribution:", bl_dist_str)
    print(f"  Gaps: {len(preview['gaps'])}")

    # Step 5: Save auto-assignment
    r = client.post(f'/api/papers/{paper_id}/auto-assign', headers=hdr(faculty_tok), json={
        'co_targets': co_targets,
        'blooms_targets': blooms_targets,
        'save': True,
    })
    assert r.status_code == 200, f"Auto-assign save failed: {r.text}"
    result = r.json()
    print(f"\nPASS Step 5: Auto-assigned {len(result['slots'])} slots (saved={result['saved']})")

    # Verify summary_table is present
    assert 'summary_table' in result, "summary_table missing from auto-assign response"
    st = result['summary_table']
    assert 'co_table' in st and 'blooms_table' in st, "summary_table missing co_table or blooms_table"
    assert 'co_ok' in st and 'blooms_ok' in st, "summary_table missing ok flags"
    print(f"       Summary table: {len(st['co_table'])} CO rows, {len(st['blooms_table'])} Bloom's rows")
    print(f"       CO ok={st['co_ok']}, Blooms ok={st['blooms_ok']}")
    for row in st['co_table']:
        print(f"         {row['co_code']}: target={row['target_pct']}% actual={row['actual_pct']}% dev=+-{row['deviation']}% [{row['status']}]")
    for row in st['blooms_table']:
        print(f"         {row['level_code']}: target={row['target_pct']}% actual={row['actual_pct']}% dev=+-{row['deviation']}% [{row['status']}]")

    # Verify analysis saved
    r = client.get(f'/api/papers/{paper_id}/analysis', headers=hdr(faculty_tok))
    assert r.status_code == 200
    analysis = r.json()
    print(f"       Analysis saved: CO={list(analysis['co_distribution'].keys())}, Bloom's={list(analysis['blooms_distribution'].keys())}")

    # Step 6: Faculty submits
    r = client.post(f'/api/papers/{paper_id}/transition', headers=hdr(faculty_tok),
                    json={'action': 'submit', 'comments': 'Ready for review'})
    assert r.status_code == 200, f"Submit failed: {r.text}"
    print(f"\nPASS Step 6: Paper submitted (status={r.json()['status']})")

    # Step 7: HOD takes for review and approves
    r = client.post(f'/api/papers/{paper_id}/transition', headers=hdr(hod_tok),
                    json={'action': 'hod_review', 'comments': 'Taking for review'})
    assert r.status_code == 200
    r = client.post(f'/api/papers/{paper_id}/transition', headers=hdr(hod_tok),
                    json={'action': 'hod_approve', 'comments': 'CO/Bloom distribution looks good'})
    assert r.status_code == 200
    print(f"PASS Step 7: HOD approved (status={r.json()['status']})")

    # Step 8: Principal reviews and approves
    r = client.post(f'/api/papers/{paper_id}/transition', headers=hdr(principal_tok),
                    json={'action': 'principal_review', 'comments': 'Taking for review'})
    assert r.status_code == 200
    r = client.post(f'/api/papers/{paper_id}/transition', headers=hdr(principal_tok),
                    json={'action': 'principal_approve', 'comments': 'Approved'})
    assert r.status_code == 200
    print(f"PASS Step 8: Principal approved (status={r.json()['status']})")

    # Step 9: Exam Cell finalizes
    r = client.post(f'/api/papers/{paper_id}/transition', headers=hdr(examcell_tok),
                    json={'action': 'exam_cell_review', 'comments': 'Preparing for exam'})
    assert r.status_code == 200
    r = client.post(f'/api/papers/{paper_id}/transition', headers=hdr(examcell_tok),
                    json={'action': 'finalize', 'comments': 'Finalized and locked'})
    assert r.status_code == 200
    print(f"PASS Step 9: Paper finalized (status={r.json()['status']})")

    # Final checks
    r = client.get(f'/api/papers/{paper_id}', headers=hdr(faculty_tok))
    assert r.json()['status'] == 'finalized'

    r = client.get(f'/api/papers/{paper_id}/history', headers=hdr(faculty_tok))
    history = r.json()
    print(f"\n       Workflow history ({len(history)} steps):")
    for h in history:
        print(f"         {h['from_status']} -> {h['to_status']}: {h['comments'][:40]}")

    print("\n=== ALL STEPS PASSED ===")

if __name__ == '__main__':
    run()
