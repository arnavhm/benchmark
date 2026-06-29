#!/usr/bin/env python3
"""Simple Markdown -> PDF converter using reportlab.

This script renders the markdown file as preformatted text into a PDF.
It's intentionally lightweight to avoid external HTML engines.
"""

import os
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Preformatted


def md_to_pdf(md_path, pdf_path):
    with open(md_path, "r", encoding="utf-8") as f:
        text = f.read()

    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=letter,
        rightMargin=40,
        leftMargin=40,
        topMargin=40,
        bottomMargin=40,
    )
    styles = getSampleStyleSheet()
    normal = styles["Normal"]
    code_style = styles["Code"] if "Code" in styles else normal

    # Build flowables: title (first line if starts with #), then preformatted body
    flowables = []
    lines = text.splitlines()
    if lines:
        first = lines[0].strip()
        if first.startswith("#"):
            title = first.lstrip("#").strip()
            flowables.append(Paragraph(title, styles["Title"]))
            flowables.append(Spacer(1, 12))

    # Use Preformatted to preserve code fences and indentation
    flowables.append(Preformatted(text, code_style))

    doc.build(flowables)


if __name__ == "__main__":
    md_path = os.path.join(os.path.dirname(__file__), "..", "REPORT_SNIPPETS.md")
    md_path = os.path.abspath(md_path)
    pdf_path = os.path.splitext(md_path)[0] + ".pdf"

    if not os.path.exists(md_path):
        print("Markdown file not found:", md_path)
        sys.exit(2)

    md_to_pdf(md_path, pdf_path)
    print("Generated:", pdf_path)
