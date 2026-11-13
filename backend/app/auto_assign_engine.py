"""
Auto-assignment engine: given CO% targets and Bloom's% targets,
automatically assign CO and Bloom's level to each question slot
in a paper using marks-weighted distribution.

Algorithm:
1. Sort slots by marks descending (biggest slots first)
2. For each CO target (% of total paper marks):
   - Calculate how many marks need to be assigned to that CO
   - Fill slots greedily until the CO's marks quota is reached
3. Same for Bloom's levels
4. Handle OR groups: both alternatives get same CO/Bloom's assignment
5. Recalculate actual distribution after assignment
"""
from __future__ import annotations
from typing import Optional
import math


class SlotAssignment:
    """Represents a single paper question slot."""
    def __init__(
        self,
        slot_db_id: int,
        slot_id: str,
        marks: float,
        is_or: bool = False,
        or_group: Optional[str] = None,
        section_name: str = "",
    ):
        self.slot_db_id = slot_db_id
        self.slot_id = slot_id
        self.marks = marks
        self.is_or = is_or
        self.or_group = or_group
        self.section_name = section_name
        self.assigned_co: Optional[str] = None
        self.assigned_blooms: Optional[str] = None


def auto_assign_co_blooms(
    slots: list[SlotAssignment],
    total_marks: float,
    co_targets: dict[str, float],      # {co_code: target_percent}
    blooms_targets: dict[str, float],   # {blooms_code: target_percent}
) -> list[SlotAssignment]:
    """
    Auto-assign CO and Bloom's level to each slot.

    Rules:
    - OR-group slots (alternatives) get the SAME assignment as their canonical.
    - When assigning a canonical slot, deduct BOTH the canonical marks AND the
      marks of all its OR mirrors from the quota — because a student who answers
      the OR alternative also covers the same CO marks.
    - Target-ceiling constrained assignment: each CO/Bloom's gets an exact integer
      target (via Largest-Remainder). Slots are sorted largest-contribution first and
      assigned to the bucket with the most remaining capacity, but never exceeding
      the LR ceiling. Ties in remaining capacity are broken by original key order
      (stable, independent of alphabetic/insertion order) to prevent CO1/CO2 always
      winning ties and starving CO3/CO4.
    - If targets don't sum to 100%, they are normalised.

    Returns the same list with assigned_co and assigned_blooms filled in.
    """
    import re as _re

    if not slots or total_marks <= 0:
        return slots

    # Step 1: Normalise targets to sum to 100
    def normalise(targets: dict) -> dict:
        total = sum(targets.values())
        if total <= 0:
            return {}
        return {k: v / total * 100 for k, v in targets.items()}

    co_norm = normalise(co_targets)
    bl_norm = normalise(blooms_targets)

    # Step 2: (normalised targets used directly by balanced assignment — no explicit quota needed)

    # Step 3: Identify canonical (non-OR) slots and build OR-mirror maps.
    #
    # Two OR patterns in use:
    # Pattern A: mandatory slot has no or_group; OR alt has or_group="Xb_or"
    #            → alt mirrors the last non-OR slot seen before it
    # Pattern B: mandatory has or_group="Q4_or"; alt has same or_group
    #            → each alt mirrors the mandatory with matching base slot_id
    #              (strip _altN suffix from the OR slot's slot_id)
    canonical: list[SlotAssignment] = []
    canonical_by_slot_id: dict[str, SlotAssignment] = {}
    or_group_canonical: dict[str, SlotAssignment] = {}

    last_non_or: Optional[SlotAssignment] = None
    for slot in slots:
        if not slot.is_or:
            canonical.append(slot)
            canonical_by_slot_id[slot.slot_id] = slot
            last_non_or = slot
        else:
            if slot.or_group and slot.or_group not in or_group_canonical:
                if last_non_or:
                    or_group_canonical[slot.or_group] = last_non_or
                else:
                    or_group_canonical[slot.or_group] = slot
                    canonical.append(slot)
                    canonical_by_slot_id[slot.slot_id] = slot

    # Build map: canonical slot_id → total OR-mirror marks for that canonical.
    # When we assign a canonical slot, its OR mirrors carry the same CO/Bloom's,
    # so their marks also count toward the CO coverage quota.
    or_mirror_marks: dict[str, float] = {}   # canonical slot_id → sum of OR mirror marks
    for slot in slots:
        if not slot.is_or or not slot.or_group:
            continue
        base_id = _re.sub(r'_alt\d+$', '', slot.slot_id)
        if base_id in canonical_by_slot_id:
            canon_id = base_id
        elif slot.or_group in or_group_canonical:
            canon_id = or_group_canonical[slot.or_group].slot_id
        else:
            continue
        or_mirror_marks[canon_id] = or_mirror_marks.get(canon_id, 0.0) + slot.marks

    # Step 4: Sort canonical slots by marks descending (largest first).
    canonical_sorted = sorted(canonical, key=lambda s: s.marks, reverse=True)

    # Denominator for bucket ceilings = full paper total (mandatory + OR alt marks).
    # This matches compute_actual_distribution which now counts all slots, so
    # actual marks == target marks after auto-assign.
    total_contribution_sum = sum(s.marks for s in slots)   # all slots including OR alts
    if total_contribution_sum <= 0:
        total_contribution_sum = total_marks

    def _assign_balanced(
        canonical_sorted: list[SlotAssignment],
        keys: list[str],
        target_pct: dict[str, float],
    ) -> dict[str, str]:
        """
        Assign each canonical slot to a bucket (CO or Bloom's level) using a
        ceiling-constrained balanced assignment.

        Each bucket gets an integer ceiling = LR(target_pct, total_contribution_sum).
        A canonical slot's contribution = its own marks + all its OR-mirror marks,
        because both get the same CO/Bloom's assignment and both count in the summary.
        Slots are assigned largest-contribution first to the bucket with the most
        remaining capacity.
        If no bucket can accept without exceeding its ceiling, the bucket with
        the most remaining capacity (or least overage) is chosen as fallback.

        This guarantees each CO hits exactly its LR-computed target when the
        slot structure allows it — and stays as close as possible when it doesn't.

        Returns {slot_id: assigned_key}.
        """
        # Ceilings in contribution space (full paper total incl. OR alts)
        contrib_ceil: dict[str, int] = _largest_remainder(target_pct, total_contribution_sum)

        assigned: dict[str, str] = {}
        dist_so_far: dict[str, float] = {k: 0.0 for k in keys}

        for slot in canonical_sorted:
            # Each canonical slot's contribution = its marks + all its OR-mirror marks.
            # OR mirrors will inherit the same CO/Bloom's, so they all count together.
            contrib = slot.marks + or_mirror_marks.get(slot.slot_id, 0.0)

            # Sort buckets by priority:
            #  1. Best fit: prefer the bucket whose remaining capacity is CLOSEST
            #     to the contribution (ascending abs diff).  A bucket that this
            #     slot fills exactly leaves no slack to accidentally absorb later
            #     small slots.  This prevents a bucket with a large surplus from
            #     "stealing" a slot that would perfectly complete a tight bucket.
            #  2. Most remaining capacity (descending) — break fit ties by filling
            #     the emptiest bucket first.
            #  3. Original key order for deterministic final tie-breaking.
            key_index = {k: i for i, k in enumerate(keys)}
            def sort_key(k):
                cap = contrib_ceil[k] - dist_so_far[k]
                fit = abs(cap - contrib)          # 0 = perfect fit
                return (fit, -cap, key_index[k])

            ordered = sorted(keys, key=sort_key)

            # Accept the first bucket that won't exceed its ceiling
            chosen = None
            for k in ordered:
                if dist_so_far[k] + contrib <= contrib_ceil[k]:
                    chosen = k
                    break

            # Fallback: strict ceiling impossible — pick the bucket with most remaining cap
            if chosen is None:
                chosen = max(keys, key=lambda k: contrib_ceil[k] - dist_so_far[k])

            assigned[slot.slot_id] = chosen
            dist_so_far[chosen] += contrib

        return assigned

    # Step 5: Assign CO to canonical slots.
    if co_norm:
        co_keys = list(co_norm.keys())
        co_assignment = _assign_balanced(canonical_sorted, co_keys, co_norm)
        for slot in canonical_sorted:
            slot.assigned_co = co_assignment.get(slot.slot_id)
    else:
        for slot in canonical_sorted:
            slot.assigned_co = None

    # Step 6: Assign Bloom's to canonical slots.
    if bl_norm:
        bl_keys = list(bl_norm.keys())
        bl_assignment = _assign_balanced(canonical_sorted, bl_keys, bl_norm)
        for slot in canonical_sorted:
            slot.assigned_blooms = bl_assignment.get(slot.slot_id)
    else:
        for slot in canonical_sorted:
            slot.assigned_blooms = None

    # Step 7: Mirror CO and Bloom's assignments to OR alternatives.
    for slot in slots:
        if not slot.is_or or not slot.or_group:
            continue
        base_id = _re.sub(r'_alt\d+$', '', slot.slot_id)
        if base_id in canonical_by_slot_id:
            canonical_slot = canonical_by_slot_id[base_id]
        elif slot.or_group in or_group_canonical:
            canonical_slot = or_group_canonical[slot.or_group]
        else:
            continue
        slot.assigned_co = canonical_slot.assigned_co
        slot.assigned_blooms = canonical_slot.assigned_blooms

    return slots


def compute_actual_distribution(
    slots: list[SlotAssignment],
    total_marks: float,
) -> dict:
    """
    Compute actual CO and Bloom's distribution from assigned slots.

    ALL slots (mandatory + OR alternatives) contribute to CO/Bloom's mark
    totals, because the paper as a whole assigns that many marks to each CO
    and the summary denominator is the full paper total (e.g. 88m).

    Actual % = all-slot CO marks * 100 / total_marks
    total_marks_counted = mandatory-only (used for analysis elsewhere).
    """
    co_marks: dict[str, float] = {}
    bl_marks: dict[str, float] = {}
    total_counted = 0.0

    for slot in slots:
        if not slot.is_or:
            total_counted += slot.marks   # mandatory-only total for analysis
        if slot.assigned_co:
            co_marks[slot.assigned_co] = co_marks.get(slot.assigned_co, 0) + slot.marks
        if slot.assigned_blooms:
            bl_marks[slot.assigned_blooms] = bl_marks.get(slot.assigned_blooms, 0) + slot.marks

    def to_dist(m_map: dict) -> dict:
        return {
            k: {
                "raw_marks": round(m, 2),
                "percent": round(m / total_marks * 100, 1) if total_marks > 0 else 0,
            }
            for k, m in m_map.items()
        }

    return {
        "co_distribution": to_dist(co_marks),
        "blooms_distribution": to_dist(bl_marks),
        "total_marks_counted": round(total_counted, 2),
    }


def build_gap_report(
    actual: dict,
    co_targets: dict[str, float],
    blooms_targets: dict[str, float],
    tolerance: float = 2.0,   # ← 2% per CO/Bloom's level (allows marks-rounding granularity)
) -> list[str]:
    """
    Return list of gap messages where actual deviates > tolerance from target.
    Default tolerance is 2% — accommodates discrete question-mark granularity
    (e.g. a 25% target on a 60-mark paper can land at 24.78% or 25.89%).
    """
    gaps = []
    co_dist = actual.get("co_distribution", {})
    bl_dist = actual.get("blooms_distribution", {})

    def normalise(t):
        s = sum(t.values())
        return {k: v / s * 100 for k, v in t.items()} if s > 0 else t

    co_t = normalise(co_targets)
    bl_t = normalise(blooms_targets)

    for co, target_pct in co_t.items():
        actual_pct = co_dist.get(co, {}).get("percent", 0.0)
        diff = abs(actual_pct - target_pct)
        if diff > tolerance:
            gaps.append(
                f"{co}: target {target_pct:.1f}% vs actual {actual_pct:.1f}%  "
                f"(deviation {diff:.1f}%)"
            )

    for bl, target_pct in bl_t.items():
        actual_pct = bl_dist.get(bl, {}).get("percent", 0.0)
        diff = abs(actual_pct - target_pct)
        if diff > tolerance:
            gaps.append(
                f"{bl}: target {target_pct:.1f}% vs actual {actual_pct:.1f}%  "
                f"(deviation {diff:.1f}%)"
            )

    return gaps


def _largest_remainder(targets_pct: dict[str, float], total_marks: float) -> dict[str, int]:
    """
    Distribute ``total_marks`` (integer) among keys in proportion to their
    target percentages using the Largest-Remainder / Hamilton method.

    Guarantees:  sum(result.values()) == round(total_marks)
    This avoids the classic rounding bug where  int(round(pct/100 * total))
    applied independently per key sums to total ± N (e.g. 88 instead of 86).
    """
    total = int(round(total_marks))
    if total <= 0 or not targets_pct:
        return {k: 0 for k in targets_pct}

    pct_sum = sum(targets_pct.values())
    if pct_sum <= 0:
        return {k: 0 for k in targets_pct}

    # Exact fractional marks
    exact = {k: v / pct_sum * total for k, v in targets_pct.items()}

    # Integer floors
    floors = {k: int(v) for k, v in exact.items()}
    remainder_needed = total - sum(floors.values())

    # Sort keys by descending fractional part to award remainders
    fractional = sorted(exact.keys(), key=lambda k: exact[k] - floors[k], reverse=True)
    for k in fractional[:remainder_needed]:
        floors[k] += 1

    return floors


def build_summary_table(
    slots: list[SlotAssignment],
    total_marks: float,
    co_targets: dict[str, float],
    blooms_targets: dict[str, float],
) -> dict:
    """
    Build the CO and Bloom's summary table.

    Target Marks use the Largest-Remainder (Hamilton) method so they always
    sum exactly to total_marks — avoids the rounding artefact where
    int(round(25% × 86)) × 4 = 88 ≠ 86.
    """
    actual = compute_actual_distribution(slots, total_marks)

    def normalise(t):
        s = sum(t.values())
        return {k: v / s * 100 for k, v in t.items()} if s > 0 else t

    co_norm = normalise(co_targets)
    bl_norm = normalise(blooms_targets)

    # Compute target marks with exact integer allocation (sum = total_marks)
    co_target_marks  = _largest_remainder(co_norm, total_marks)
    bl_target_marks  = _largest_remainder(bl_norm, total_marks)

    # Build CO table
    co_table = []
    for co_code, target_pct in sorted(co_norm.items()):
        actual_entry = actual["co_distribution"].get(co_code, {"raw_marks": 0.0, "percent": 0.0})
        target_marks = co_target_marks[co_code]
        # Actual % = actual assigned marks * 100 / total_marks
        actual_pct   = round(actual_entry["raw_marks"] * 100 / total_marks, 1) if total_marks > 0 else 0.0
        deviation    = round(abs(actual_pct - target_pct), 1)

        # Count ALL slots assigned to this CO (mandatory + OR alts)
        slot_ids = [s.slot_id for s in slots if s.assigned_co == co_code]

        actual_marks = round(actual_entry["raw_marks"], 2)
        co_table.append({
            "co_code": co_code,
            "target_pct": round(target_pct, 1),
            "target_marks": target_marks,
            "actual_marks": actual_marks,
            "actual_pct": actual_pct,
            "deviation": deviation,
            "status": "ok" if deviation <= 2.0 else "gap",
            "slot_count": len(slot_ids),
            "slot_ids": slot_ids,
        })

    # Build Bloom's table
    blooms_table = []
    BLOOMS_ORDER = ['R', 'U', 'Ap', 'An', 'E', 'C']
    for bl_code in BLOOMS_ORDER:
        target_pct   = bl_norm.get(bl_code, 0.0)
        actual_entry = actual["blooms_distribution"].get(bl_code, {"raw_marks": 0.0, "percent": 0.0})
        target_marks = bl_target_marks.get(bl_code, 0)
        # Actual % = actual assigned marks * 100 / total_marks
        actual_pct   = round(actual_entry["raw_marks"] * 100 / total_marks, 1) if total_marks > 0 else 0.0
        deviation    = round(abs(actual_pct - target_pct), 1)

        slot_ids = [s.slot_id for s in slots if s.assigned_blooms == bl_code]

        actual_marks_bl = round(actual_entry["raw_marks"], 2)
        if target_pct > 0 or actual_pct > 0:
            blooms_table.append({
                "level_code": bl_code,
                "target_pct": round(target_pct, 1),
                "target_marks": target_marks,
                "actual_marks": actual_marks_bl,
                "actual_pct": actual_pct,
                "deviation": deviation,
                "status": "ok" if deviation <= 2.0 else "gap",
                "slot_count": len(slot_ids),
                "slot_ids": slot_ids,
            })

    return {
        "co_table": co_table,
        "blooms_table": blooms_table,
        "total_marks": total_marks,
        "co_ok": all(r["status"] == "ok" for r in co_table),
        "blooms_ok": all(r["status"] == "ok" for r in blooms_table),
    }
