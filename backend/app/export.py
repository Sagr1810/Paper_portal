"""
Export finalized papers to PDF, DOCX, or XLSX.
"""
import os
import tempfile
from sqlalchemy.orm import Session
from app import models


def export_paper_file(paper: models.ExamPaper, fmt: str, db: Session) -> str:
    """Returns path to the generated file."""
    if fmt == "pdf":
        return _export_pdf(paper)
    elif fmt == "docx":
        return _export_docx(paper)
    elif fmt == "xlsx":
        return _export_xlsx(paper, db)
    raise ValueError(f"Unknown format: {fmt}")


def _export_pdf(paper: models.ExamPaper) -> str:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib import colors
    from reportlab.lib.units import cm

    path = os.path.join(tempfile.gettempdir(), f"paper_{paper.id}.pdf")
    doc = SimpleDocTemplate(path, pagesize=A4, rightMargin=2*cm, leftMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()
    story = []

    title_style = ParagraphStyle("Title2", parent=styles["Heading1"], fontSize=14, alignment=1)
    story.append(Paragraph(paper.title, title_style))
    story.append(Spacer(1, 0.5*cm))
    story.append(Paragraph(f"Exam Type: {paper.exam_type.replace('_', ' ').title()}  |  Academic Year: {paper.academic_year or 'N/A'}", styles["Normal"]))
    story.append(Spacer(1, 0.5*cm))

    for section in paper.sections:
        story.append(Paragraph(f"<b>{section.section_name}</b>  [{section.marks_allocated} marks]", styles["Heading2"]))
        if section.instructions:
            story.append(Paragraph(section.instructions, styles["Italic"]))
        story.append(Spacer(1, 0.3*cm))
        for idx, pq in enumerate(section.questions):
            q_text = pq.question.question_text if pq.question else "—"
            opt_tag = " (OR)" if pq.is_optional else ""
            story.append(Paragraph(f"Q{idx+1}{opt_tag}. {q_text}  [{pq.assigned_marks} marks]", styles["Normal"]))
            story.append(Spacer(1, 0.2*cm))
        story.append(Spacer(1, 0.5*cm))

    doc.build(story)
    return path


def _export_docx(paper: models.ExamPaper) -> str:
    from docx import Document
    from docx.shared import Pt, Cm
    from docx.enum.text import WD_ALIGN_PARAGRAPH

    path = os.path.join(tempfile.gettempdir(), f"paper_{paper.id}.docx")
    doc = Document()

    title = doc.add_heading(paper.title, level=1)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    doc.add_paragraph(f"Exam Type: {paper.exam_type.replace('_', ' ').title()}  |  Academic Year: {paper.academic_year or 'N/A'}")
    doc.add_paragraph("")

    for section in paper.sections:
        doc.add_heading(f"{section.section_name}  [{section.marks_allocated} marks]", level=2)
        if section.instructions:
            p = doc.add_paragraph(section.instructions)
            p.runs[0].italic = True
        for idx, pq in enumerate(section.questions):
            q_text = pq.question.question_text if pq.question else "—"
            opt_tag = " (OR)" if pq.is_optional else ""
            doc.add_paragraph(f"Q{idx+1}{opt_tag}. {q_text}  [{pq.assigned_marks} marks]")
        doc.add_paragraph("")

    doc.save(path)
    return path


def _export_xlsx(paper: models.ExamPaper, db: Session) -> str:
    import openpyxl
    from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

    path = os.path.join(tempfile.gettempdir(), f"paper_{paper.id}.xlsx")
    wb = openpyxl.Workbook()

    # ── Sheet 1: Slot assignments ──────────────────────────────────────────────
    ws = wb.active
    ws.title = "Slot Assignments"

    # Paper meta rows
    ws.append([paper.title])
    ws.append([f"Exam Type: {paper.exam_type.replace('_', ' ').title()}  |  Academic Year: {paper.academic_year or 'N/A'}"])
    ws.append([])

    # Column headers
    headers = ["Slot", "Type", "Marks", "CO", "Bloom's", "Question Text"]
    ws.append(headers)
    header_row = ws.max_row
    for cell in ws[header_row]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor="DBEAFE")   # light blue

    # Data rows — use model properties so both slot-mode and question-mode work
    for section in paper.sections:
        # Section divider row
        sec_row = ws.max_row + 1
        ws.append([f"  {section.section_name}", "", f"{section.marks_allocated}m"])
        for cell in ws[sec_row]:
            cell.font = Font(bold=True, italic=True, color="1E40AF")
            cell.fill = PatternFill("solid", fgColor="EFF6FF")

        for pq in section.questions:
            slot_label = pq.slot_label or pq.slot_id or f"#{pq.id}"
            slot_type  = "OR Alt" if pq.is_optional else "Mandatory"
            co_code    = pq.co_code   or ""   # property: resolves slot_co OR question.co
            bl_code    = pq.blooms_code or ""  # property: resolves slot_blooms OR question.blooms
            q_text     = pq.question_text or ""  # property: slot_question_text OR question.question_text

            row_data = [slot_label, slot_type, pq.assigned_marks, co_code, bl_code, q_text]
            ws.append(row_data)
            row_num = ws.max_row

            # Highlight OR-alt rows in amber
            if pq.is_optional:
                for cell in ws[row_num]:
                    cell.fill = PatternFill("solid", fgColor="FEF9C3")

            # Highlight CO cell in purple if set
            if co_code:
                ws.cell(row=row_num, column=4).fill = PatternFill("solid", fgColor="EDE9FE")
                ws.cell(row=row_num, column=4).font = Font(bold=True, color="5B21B6")

            # Highlight Bloom's cell in blue if set
            if bl_code:
                ws.cell(row=row_num, column=5).fill = PatternFill("solid", fgColor="DBEAFE")
                ws.cell(row=row_num, column=5).font = Font(bold=True, color="1E40AF")

    # Auto-fit column widths (approximate)
    col_widths = [12, 12, 8, 10, 12, 60]
    for i, w in enumerate(col_widths, start=1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = w

    # ── Sheet 2: CO Summary ────────────────────────────────────────────────────
    if paper.analysis and paper.analysis.co_distribution:
        ws_co = wb.create_sheet("CO Summary")
        ws_co.append(["CO", "Marks", "% of Paper"])
        for cell in ws_co[1]:
            cell.font = Font(bold=True)
            cell.fill = PatternFill("solid", fgColor="EDE9FE")
        for co_code, data in sorted(paper.analysis.co_distribution.items()):
            ws_co.append([co_code, data.get("marks", 0), round(data.get("percent", 0), 1)])
        for col in ["A", "B", "C"]:
            ws_co.column_dimensions[col].width = 16

    # ── Sheet 3: Bloom's Summary ───────────────────────────────────────────────
    if paper.analysis and paper.analysis.blooms_distribution:
        ws_bl = wb.create_sheet("Blooms Summary")
        ws_bl.append(["Level", "Marks", "% of Paper"])
        for cell in ws_bl[1]:
            cell.font = Font(bold=True)
            cell.fill = PatternFill("solid", fgColor="DCFCE7")
        blooms_order = ["R", "U", "Ap", "An", "E", "C"]
        dist = paper.analysis.blooms_distribution
        for bl in blooms_order:
            if bl in dist:
                data = dist[bl]
                ws_bl.append([bl, data.get("marks", 0), round(data.get("percent", 0), 1)])
        for code, data in dist.items():
            if code not in blooms_order:
                ws_bl.append([code, data.get("marks", 0), round(data.get("percent", 0), 1)])
        for col in ["A", "B", "C"]:
            ws_bl.column_dimensions[col].width = 16

    wb.save(path)
    return path
