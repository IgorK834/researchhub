#!/usr/bin/env python3
"""Project-authored RC fixture generator. No timestamps, external content or optional dependencies."""
import argparse
import hashlib
import math
from pathlib import Path
import random
from xml.sax.saxutils import escape
import zipfile

ROOT = Path(__file__).resolve().parents[2]
DESTINATION = ROOT / "backend/src/main/resources/sample/rc-circuit-lab"
SEED = 316
FILES = ("rc-lab-instructions.pdf", "rc-theory-notes.pdf", "rc-measurements.xlsx", "component-notes.txt")


def pdf(title, lines):
    """One-page PDF with an embedded, explicit object graph and fixed metadata."""
    commands = ["BT /F1 20 Tf 50 790 Td (" + title + ") Tj", "/F1 11 Tf"]
    for line in lines:
        safe = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        commands.append("0 -25 Td (" + safe + ") Tj")
    commands.append("ET")
    stream = "\n".join(commands).encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Title (" + title.encode() + b") /Author (ResearchHub synthetic fixtures) /CreationDate (D:20260101000000Z) >>",
    ]
    result = bytearray(b"%PDF-1.4\n%ResearchHub synthetic fixture\n")
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(result))
        result.extend(str(number).encode() + b" 0 obj\n" + obj + b"\nendobj\n")
    start = len(result)
    result.extend(b"xref\n0 7\n0000000000 65535 f \n")
    for offset in offsets[1:]:
        result.extend(f"{offset:010d} 00000 n \n".encode())
    result.extend(f"trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n{start}\n%%EOF\n".encode())
    return bytes(result)


def measurements():
    rng = random.Random(SEED)
    rows = [("time_s", "voltage_v", "trial", "temperature_c")]
    for trial in range(1, 4):
        for step in range(81):
            time = step / 4
            voltage = round(3.3 * math.exp(-time / 4.86) + rng.gauss(0, 0.008), 6)
            rows.append((time, max(voltage, 0.001), trial, round(22 + rng.gauss(0, 0.12), 2)))
    return rows


def xlsx(path):
    namespace = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    rows = []
    for number, values in enumerate(measurements(), 1):
        cells = []
        for col, value in enumerate(values):
            coordinate = chr(65 + col) + str(number)
            if isinstance(value, str):
                cells.append(f'<c r="{coordinate}" t="inlineStr" s="1"><is><t>{escape(value)}</t></is></c>')
            else:
                cells.append(f'<c r="{coordinate}"><v>{value}</v></c>')
        rows.append(f'<row r="{number}">' + "".join(cells) + '</row>')
    contents = {
        "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": f'<workbook {namespace} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Measurements" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        "xl/styles.xml": f'<styleSheet {namespace}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16324F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0" fillId="0" borderId="0" xfId="0"/><xf fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
        "xl/worksheets/sheet1.xml": f'<worksheet {namespace}><dimension ref="A1:D244"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="4" width="20" customWidth="1"/></cols><sheetData>' + "".join(rows) + '</sheetData><autoFilter ref="A1:D244"/></worksheet>',
    }
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as archive:
        for name in sorted(contents):
            item = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            item.external_attr = 0o644 << 16
            archive.writestr(item, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + contents[name])


def generate(destination=DESTINATION):
    destination.mkdir(parents=True, exist_ok=True)
    (destination / FILES[0]).write_bytes(pdf("RC circuit laboratory protocol", [
        "Synthetic teaching dataset authored for ResearchHub; no real participants.",
        "Objective: estimate the discharge time constant and compare with R times C.",
        "Circuit: a 3.3 V charged capacitor discharges through a 10,000 ohm resistor.",
        "Nominal capacitance C = 470 microfarads; resistance R = 10,000 ohms.",
        "Expected time constant tau = R * C = 4.7 seconds from these component values.",
        "Procedure: charge, disconnect the supply, close the resistor discharge loop.",
        "Record voltage every 0.25 s from 0 to 20 s; repeat for three trials.",
        "The worksheet includes time_s, voltage_v, trial and temperature_c.",
        "Use all immutable rows for the fit; retain inputs, code and output provenance.",
        "The measurements are a simulation with small, fixed-seed measurement noise.",
    ]))
    (destination / FILES[1]).write_bytes(pdf("RC discharge theory notes", [
        "Synthetic teaching notes authored for ResearchHub.",
        "Model: V(t) = V0 * exp(-t / tau), where tau = R * C.",
        "At one time constant the voltage falls to about 36.8 percent of V0.",
        "Expected tau from the nominal component values is 4.7 seconds.",
        "Fit log(V) against time; a negative slope gives tau = -1 / slope.",
        "Only positive, finite voltages and finite, nonnegative times are valid.",
        "A log fit assumes negligible offset and roughly multiplicative errors.",
        "Report this assumption: additive voltage noise can bias a log fit.",
        "Component tolerances and measurement noise explain a modest deviation.",
        "Compare measured and fitted curves, and inspect residuals before conclusions.",
    ]))
    (destination / FILES[3]).write_text(
        "ResearchHub project-authored synthetic component notes.\n"
        "Resistance: 10,000 ohms, tolerance +/- 1 percent.\n"
        "Capacitance: 470 microfarads, tolerance +/- 5 percent.\n"
        "Expected time constant from component values: tau = R * C = 4.7 seconds.\n"
        "Combined worst-case nominal range: 4.42035 to 4.98435 seconds.\n"
        "Voltage supply: 3.3 V. Temperature samples are synthetic, around 22 C.\n"
        "No other environmental measurement was recorded.\n", encoding="utf-8")
    xlsx(destination / FILES[2])
    hashes = {name: hashlib.sha256((destination / name).read_bytes()).hexdigest() for name in FILES}
    (destination / "SHA256SUMS").write_text("".join(f"{digest}  {name}\n" for name, digest in hashes.items()), encoding="ascii")
    return hashes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DESTINATION)
    args = parser.parse_args()
    for name, digest in generate(args.output).items():
        print(f"{digest}  {name}")


if __name__ == "__main__":
    main()
