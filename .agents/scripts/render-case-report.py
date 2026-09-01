import fitz
from pathlib import Path

source = Path("screenshots/Pixely_Careers_Client_Case_Report_PX-2609-002.pdf")
output = Path(".agents/outputs/case-report")
output.mkdir(parents=True, exist_ok=True)
document = fitz.open(source)
for index, page in enumerate(document):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
    pixmap.save(output / f"page-{index + 1}.png")
print(f"rendered {document.page_count} pages")