"""Read a syllabus PDF -> subject code, subject name, units with % weightage."""
import io
import re

import pdfplumber

try:
    import pytesseract
except Exception:
    pytesseract = None

ROMAN = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5, "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10}


class SyllabusError(ValueError):
    pass


def _clean(s):
    return re.sub(r"\s+", " ", (s or "").replace("\x00", " ")).strip()


def _num(s):
    m = re.search(r"\d+(?:\.\d+)?", (s or "").replace(",", "."))
    return float(m.group()) if m else None


def _unit_no(s):
    s = _clean(s).lower().strip(".:")
    if s.isdigit():
        return int(s)
    m = re.search(r"\d+", s)
    if m:
        return int(m.group())
    return ROMAN.get(s)


def _ocr_header(page):
    if pytesseract is None:
        return ""
    try:
        w, h = page.width, page.height
        img = page.crop((0, 0, w, h * 0.35)).to_image(resolution=250).original
        return pytesseract.image_to_string(img)
    except Exception:
        return ""


def _find_program(t):
    m = re.search(r"\b(?:program(?:me)?|degree)(?:\s*name)?\s*[:\-–]\s*(.+)", t, re.I)
    if m:
        v = _clean(re.split(r"\s{2,}|\bsem(?:ester)?\b", m.group(1), flags=re.I)[0]).strip(" .,;:|")
        if v:
            return v[:255]
    lines = [_clean(l) for l in (t or "").splitlines() if _clean(l)]
    for i, l in enumerate(lines):
        if i > 0 and re.match(r"(?:course|subject|paper)\s*(?:name|title)\s*[:\-–]", l, re.I):
            cand = lines[i - 1]
            if len(cand) <= 120 and not cand.endswith(":") and not re.search(
                    r"university|college|institute|school of|faculty|department", cand, re.I):
                return cand
    return None


def parse_subject(text):
    out = {"subject_code": None, "subject_name": None, "semester": None, "program": None}
    t = text or ""
    m = re.search(
        r"(?:course|subject|paper)\s*code\s*[:\-–]?\s*([A-Za-z0-9][A-Za-z0-9\-_/.]*)", t, re.I)
    if not m:
        m = re.search(r"\bcode\s*[:\-–]\s*([A-Za-z0-9][A-Za-z0-9\-_/.]*)", t, re.I)
    if m:
        out["subject_code"] = m.group(1).strip(" .,;:|")
    m = re.search(
        r"(?:course|subject|paper)\s*(?:name|title)\s*[:\-–]\s*(.+)|title of the course\s*[:\-–]\s*(.+)", t, re.I)
    if m:
        name = m.group(1) or m.group(2)
        name = re.split(r"\s{2,}|\bsem(?:ester)?\b|\b(?:course|subject|paper)\s*code\b", name, flags=re.I)[0]
        out["subject_name"] = _clean(name).strip(" .,;:|")[:255] or None
    # semester: 1, 1st, VII, 7th
    m = re.search(r"\bsem(?:ester)?\b\s*[:\-–]?\s*(\d{1,2}(?!\d)|[ivx]{1,4}\b)", t, re.I) \
        or re.search(r"\b(\d{1,2})(?:st|nd|rd|th)\s*sem(?:ester)?\b", t, re.I)
    if m:
        v = m.group(1).lower()
        n = int(v) if v.isdigit() else ROMAN.get(v)
        if n and 1 <= n <= 12:
            out["semester"] = n
    out["program"] = _find_program(t)
    return out

_PCT_RE = re.compile(r"^\s*\d+(?:[.,]\d+)?\s*%?\s*$")


def _is_unit_cell(s):
    s = _clean(s).lower().strip(".:")
    return bool(s) and (s.isdigit() or s in ROMAN)


def _find_unit_rows(pdf):
    units = {}
    layout = None
    done = False
    for page in pdf.pages:
        if done:
            break
        for tb in page.extract_tables():
            if done:
                break
            if not tb or not tb[0]:
                continue
            header = [_clean(c).lower() for c in tb[0]]
            # a real header names the weightage column; a data cell is not a header
            pct_i = next((i for i, c in enumerate(header) if "weightage" in c or "weight" in c), None)
            if pct_i is not None:
                unit_i = next((i for i, c in enumerate(header) if c.startswith("unit")), 0)
                hrs_i = next((i for i, c in enumerate(header) if "hour" in c), None)
                body_i = next((i for i, c in enumerate(header) if i not in (unit_i, pct_i, hrs_i)), 1)
                layout = (len(header), unit_i, pct_i, hrs_i, body_i)
                rows = tb[1:]
            elif layout and len(header) == layout[0]:
                # the unit table continues on a later page; rows that are not unit rows are skipped below
                rows = tb
                _, unit_i, pct_i, hrs_i, body_i = layout
            else:
                continue
            for row in rows:
                if len(row) <= max(unit_i, pct_i):
                    continue
                if _clean(row[0]).lower().startswith("total"):
                    done = True
                    break
                # only genuine unit rows: unit cell is a number and the weightage cell is a number (25 or 25%)
                if not _is_unit_cell(row[unit_i]) or not _PCT_RE.match(row[pct_i] or ""):
                    continue
                n = _unit_no(row[unit_i])
                pct = _num(row[pct_i])
                if n is None or pct is None:
                    continue
                body = (row[body_i] or "").strip()
                name = _clean(body.split("\n")[0]) if body else f"Unit {n}"
                units.setdefault(n, {
                    "unit_code": f"U{n}",
                    "unit_name": name[:255],
                    "weight_percent": pct,
                    "teaching_hours": _num(row[hrs_i]) if hrs_i is not None else None,
                })
            if sum(u["weight_percent"] for u in units.values()) >= 99.5:
                done = True
    return [units[k] for k in sorted(units)]


CO_RE = re.compile(r"^\s*(?:CO|C\.O\.?)\s*[-.]?\s*(\d{1,2})\b\s*[:.)\-–]?\s*(.*)$", re.I)
STOP_RE = re.compile(r"^\s*(unit|total|text\s*book|reference|course\s+content|teaching|practical|list of|suggested|e-?resources|prerequisite|mapping)\b", re.I)


def _good_desc(d):
    return bool(d) and len(d) >= 8 and re.search(r"[A-Za-z]{3}", d) is not None


def _find_cos(pdf):
    cos = {}
    for page in pdf.pages:
        for tb in page.extract_tables():
            if not tb:
                continue
            header = [_clean(c).lower() for c in (tb[0] or [])]
            po_i = next((i for i, c in enumerate(header)
                         if c in ("po", "pos") or c.startswith("po ") or "program outcome" in c or "mapping" in c), None)
            for row in tb:
                cells = [_clean(c) for c in (row or [])]
                if not cells:
                    continue
                m = CO_RE.match(cells[0])
                if not m:
                    continue
                n = int(m.group(1))
                rest = [c for i, c in enumerate(cells[1:], 1) if c and i != po_i]
                desc = (m.group(2) or "").strip() or (max(rest, key=len) if rest else "")
                if not _good_desc(desc):
                    continue
                po = cells[po_i] if po_i is not None and po_i < len(cells) and cells[po_i] else None
                cos.setdefault(n, {"co_code": f"CO{n}", "description": desc[:2000], "po_mapping": po})
    if not cos:
        cur = None
        for page in pdf.pages:
            for line in (page.extract_text() or "").splitlines():
                m = CO_RE.match(line)
                if m:
                    desc = _clean(m.group(2))
                    if _good_desc(desc):
                        cur = int(m.group(1))
                        cos.setdefault(cur, {"co_code": f"CO{cur}", "description": desc, "po_mapping": None})
                    else:
                        cur = None
                elif cur is not None and line.strip() and not STOP_RE.match(line) and len(cos[cur]["description"]) < 400:
                    cos[cur]["description"] = _clean(cos[cur]["description"] + " " + line)
                else:
                    cur = None
    return [cos[k] for k in sorted(cos)]


def parse_syllabus(data: bytes):
    if not data[:5] == b"%PDF-":
        raise SyllabusError("This file is not a PDF")
    try:
        pdf = pdfplumber.open(io.BytesIO(data))
    except Exception:
        raise SyllabusError("This PDF could not be opened")
    with pdf:
        if not pdf.pages:
            raise SyllabusError("The PDF has no pages")
        first_text = pdf.pages[0].extract_text() or ""
        subject = parse_subject(first_text)
        if not (subject["subject_code"] and subject["subject_name"]):
            ocr = parse_subject(_ocr_header(pdf.pages[0]))
            for k, v in ocr.items():
                subject[k] = subject[k] or v
        units = _find_unit_rows(pdf)
        cos = _find_cos(pdf)
    total = round(sum(u["weight_percent"] for u in units), 2)
    warnings = []
    if not subject["subject_code"]:
        warnings.append("Subject code was not found. Please type it in.")
    if not subject["subject_name"]:
        warnings.append("Subject name was not found. Please type it in.")
    if not units:
        warnings.append("No unit table with % weightage was found. Please add the units by hand.")
    elif abs(total - 100) > 0.5:
        warnings.append(f"The unit percentages add up to {total}%, not 100%. Please check them.")
    if not cos:
        warnings.append("No course outcomes (CO1, CO2...) were found in this PDF. Please add them by hand.")
    return {"subject": subject, "units": units, "cos": cos, "total_weight": total, "warnings": warnings}
