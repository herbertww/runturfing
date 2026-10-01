#!/usr/bin/env python
"""
Overlay PATHIC INDUSTRIES' details onto the D&B DUNS application form.

The form is a flat PDF with no AcroForm fields, so values are drawn at absolute
coordinates lifted from the text layer of the original (see frags extraction in
the session that produced this). Coordinates are PDF user space, origin at the
bottom-left of a 612x792 page.

Everything here comes from the ACRA Business Profile dated 25 Jun 2026 except
the fields listed in UNKNOWN, which only the applicant can answer. Those are
drawn as a grey rule so the gaps are obvious rather than silently blank.

    python scripts/fill_duns_form.py IN.pdf OUT.pdf
"""

from __future__ import annotations

import sys
from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import Color
from reportlab.pdfgen import canvas

INK = Color(0.05, 0.10, 0.20)      # near-black blue, reads as filled in
MUTED = Color(0.45, 0.48, 0.55)    # for N/A and notes
FONT = "Helvetica"
BOLD = "Helvetica-Bold"

# --- the answers ------------------------------------------------------------

ENTITY = "PATHIC INDUSTRIES"
UEN = "53526751K"
OWNER = "ENG WEIWEN, HERBERT"
ADDRESS = "226 JURONG EAST STREET 21, #22-835, SINGAPORE 600226"
REGISTERED = "25-06-26"

# Fields only the applicant can fill. Drawn as a rule with a faint caption.
UNKNOWN = "____________________"


def text(c, x, y, s, size=9.5, font=FONT, color=INK):
    c.setFillColor(color)
    c.setFont(font, size)
    c.drawString(x, y, s)


def blank(c, x, y, width=120, caption=""):
    """A field left for the applicant, so it is visibly unanswered."""
    c.setStrokeColor(MUTED)
    c.setLineWidth(0.6)
    c.line(x, y - 1.5, x + width, y - 1.5)
    if caption:
        text(c, x + width + 5, y, caption, size=6.5, color=MUTED)


def tick(c, x, y, size=9):
    """A checkmark drawn as two strokes — the form's boxes are printed glyphs."""
    c.setStrokeColor(INK)
    c.setLineWidth(1.4)
    c.line(x, y + size * 0.35, x + size * 0.35, y)
    c.line(x + size * 0.35, y, x + size, y + size * 0.75)


def page1(c):
    text(c, 175, 640.1, ENTITY, size=11, font=BOLD)

    text(c, 140, 603.6, OWNER)
    text(c, 140, 591.5, "Owner")
    blank(c, 140, 579.2, 150, "your mobile")
    blank(c, 140, 567.1, 190, "business email")

    # "Has HQ Physical Office Address in Singapore" — registered address is the
    # operating address, so section (A).
    tick(c, 69.5, 519)

    text(c, 347, 472.3, ADDRESS, size=7.2)

    # Rented / Owned / Leased — the applicant's call.
    text(c, 78, 436, "(tick one)", size=6.5, color=MUTED)
    blank(c, 96, 423.5, 60)               # Area
    blank(c, 258, 423.5, 90, "if leased") # Lease expiry
    text(c, 320, 398.6, "Admin", size=9)
    blank(c, 165, 373.8, 120, "your mobile")

    text(c, 68, 330, "Sections (B) and (C) not applicable.", size=7.5, color=MUTED)


def page2(c):
    # Legal Structure: Proprietorship is the third bracket on that line.
    tick(c, 459, 664.5, size=8)
    text(c, 128.3, 620, "Sole-proprietorship registered with ACRA.", size=7, color=MUTED)

    text(c, 330, 607.0, REGISTERED)
    text(c, 330, 592.0, REGISTERED)
    text(c, 342, 577.0, UEN, font=BOLD)
    text(c, 330, 561.8, "N/A", color=MUTED)
    text(c, 330, 546.2, "N/A", color=MUTED)

    text(c, 250, 522.8, "No")
    text(c, 185, 511.0, "N/A", color=MUTED)

    text(c, 155, 476.9, "N/A - sole proprietorship (no share capital)", size=8.5, color=MUTED)
    blank(c, 160, 428.2, 105)
    text(c, 160, 418, "NIL if pre-revenue", size=6.5, color=MUTED)
    blank(c, 400, 428.2, 90)
    text(c, 190, 404.4, "1")

    blank(c, 120, 371.9, 150)
    blank(c, 145, 339.6, 200, "business email")

    # Line of Business -> Service
    tick(c, 340, 292.5, size=8)

    # Business Operations table, first row.
    text(c, 90, 213, "Development of software and applications (SSIC 62011)", size=8)
    text(c, 505, 213, "100", size=8)

    text(c, 186, 109.2, "Runturfing", size=8)


def page3(c):
    text(c, 300, 657.5, OWNER)
    text(c, 300, 641.6, "Owner")
    blank(c, 300, 625.6, 80, "years")

    # Management profile, first row.
    text(c, 72, 502.1, OWNER, size=7.5)
    text(c, 194, 502.1, "Owner", size=7.5)
    blank(c, 262, 502.1, 70)
    text(c, 356, 502.1, REGISTERED, size=7.5)
    blank(c, 420, 502.1, 45)
    tick(c, 489, 500.5, size=7)

    text(c, 165, 369.4, "N/A - sole proprietorship, no group structure.", size=8, color=MUTED)


def page4(c):
    text(c, 150, 645, "N/A - no affiliates", size=8, color=MUTED)

    blank(c, 130, 516, 215)
    text(c, 380, 516, "bank holding the business account", size=6.5, color=MUTED)

    text(c, 250, 426.6, REGISTERED)
    text(c, 72, 375, f"{OWNER} (Sole Proprietor)", size=8.5)
    text(c, 380, 375, "N/A", size=8.5, color=MUTED)
    text(c, 491, 375, "100", size=8.5)

    text(c, 250, 288.2, "Attaching ACRA Business Profile dated 25 Jun 2026.", size=7.5, color=MUTED)
    text(c, 150, 205, "N/A - pre-revenue", size=8, color=MUTED)


def page6(c):
    text(c, 150, 616.9, OWNER)
    text(c, 405, 616.9, "Owner")
    blank(c, 120, 573.7, 110, "date you sign")
    blank(c, 395, 573.7, 140, "sign by hand")


PAGES = {0: page1, 1: page2, 2: page3, 3: page4, 5: page6}


def main() -> int:
    src = Path(sys.argv[1] if len(sys.argv) > 1
               else r"C:\Users\kievery\Desktop\DUNS-number-application-form_SG-updated.pdf")
    out = Path(sys.argv[2] if len(sys.argv) > 2
               else r"C:\Users\kievery\Desktop\DUNS-application-PATHIC-INDUSTRIES-filled.pdf")

    reader = PdfReader(str(src))
    writer = PdfWriter()

    for i, page in enumerate(reader.pages):
        if i in PAGES:
            buf = BytesIO()
            c = canvas.Canvas(buf, pagesize=(float(page.mediabox.width), float(page.mediabox.height)))
            PAGES[i](c)
            c.save()
            buf.seek(0)
            page.merge_page(PdfReader(buf).pages[0])
        writer.add_page(page)

    with open(out, "wb") as fh:
        writer.write(fh)

    print(f"wrote {out}")
    print(f"{len(reader.pages)} pages, {len(PAGES)} overlaid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
