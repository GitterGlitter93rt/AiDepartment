from pathlib import Path
from pypdf import PdfReader, PdfWriter

BASE = Path('docs/07-sales/training-manual/roi-forms/generated')
FILES = [
    '01_missed_call_roi.pdf',
    '02_lead_response_roi.pdf',
    '06_employee_capacity_roi.pdf',
    '14_final_roi_payback.pdf',
]

writer = PdfWriter()
for filename in FILES:
    path = BASE / filename
    reader = PdfReader(str(path))
    if len(reader.pages) != 1:
        raise RuntimeError(f'{filename} must remain a one-page field worksheet')
    writer.append(reader)

output = BASE / 'YAD_ROI_Core_Field_Kit.pdf'
with output.open('wb') as f:
    writer.write(f)

print(f'Generated {output}')
