import fs from "node:fs";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

const output = process.argv[2] || "screenshots/Pixely_Careers_Client_Case_Report_PX-2609-002.pdf";
const doc = new jsPDF({ unit: "pt", format: "a4" });
const margin = 42;
const pageWidth = doc.internal.pageSize.getWidth();
const pageHeight = doc.internal.pageSize.getHeight();
const blue = [37, 99, 235];
const navy = [30, 41, 59];
const slate = [100, 116, 139];
const light = [241, 245, 249];
let cursorY = 0;

const section = (title, body, head) => {
  if (cursorY + 110 > pageHeight - 54) {
    doc.addPage();
    cursorY = 48;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...navy);
  doc.text(title.toUpperCase(), margin, cursorY);
  autoTable(doc, {
    startY: cursorY + 8,
    head: head ? [head] : undefined,
    body,
    theme: "grid",
    margin: { left: margin, right: margin, bottom: 54 },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 5, overflow: "linebreak", valign: "top", textColor: navy, lineColor: [226, 232, 240], lineWidth: 0.35 },
    headStyles: { fillColor: blue, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 135, fontStyle: "bold", fillColor: light } },
    rowPageBreak: "avoid",
  });
  cursorY = doc.lastAutoTable.finalY + 25;
};

doc.setFillColor(...light);
doc.roundedRect(margin, 32, pageWidth - margin * 2, 92, 8, 8, "F");
doc.setFillColor(...blue);
doc.rect(margin, 32, 7, 92, "F");
doc.setFont("helvetica", "bold");
doc.setTextColor(...navy);
doc.setFontSize(18);
doc.text("PIXELY CAREERS", margin + 22, 59);
doc.setFontSize(13);
doc.text("CLIENT CASE REPORT", margin + 22, 84);
doc.setFont("helvetica", "normal");
doc.setFontSize(9);
doc.setTextColor(...slate);
doc.text("Order PX-2609-002 · Generated Sep 01, 2026 · 7:48 PM", margin + 22, 104);
cursorY = 153;

section("Case Overview", [
  ["Client", "Ali Shamshad"],
  ["Order ID", "PX-2609-002"],
  ["Order Status", "New"],
  ["Assigned Designer", "Safwan Masood"],
  ["Order Value", "Rs8,000"],
  ["Client Rating", "5/5"],
  ["Complaints", "1"],
  ["Suggestions", "2"],
]);
section("Client Information", [
  ["Client Name", "Ali Shamshad"],
  ["Client Type", "National"],
  ["Contact", "Recorded in CRM"],
  ["Client Source", "Facebook campaign"],
]);
section("Services & Package", [
  ["Package", "Professional"],
  ["Services", "ATS CV × 1\nLinkedIn Optimization × 1"],
  ["Instructions", "Prepare an executive-ready profile with a clear, achievement-focused narrative."],
]);
section("Financial Summary", [
  ["Order Value", "Rs8,000"],
  ["Advance Received", "Rs4,000"],
  ["Remaining Balance", "Rs4,000"],
  ["Payment Status", "Payment Pending"],
]);
section("Complaint CMP-2609-002", [
  ["Status", "Confirmed"],
  ["Category", "Work Quality Issue"],
  ["Description", "The first draft did not fully follow the agreed formatting instructions."],
  ["Evidence", "Complaint evidence is available in the CRM."],
  ["Resolution", "Revision requested and tracked with the assigned designer."],
]);
section("Client Review REV-2609-002", [
  ["Rating", "5/5"],
  ["Feedback", "The revised delivery was clear, professional, and met expectations."],
  ["WhatsApp Feedback", "Received"],
  ["Facebook Review", "Received"],
  ["Video Testimonial", "Not received"],
]);
section("Suggestion SUG-2609-002", [
  ["Status", "Implemented"],
  ["Suggestion", "Add a clearer pre-delivery quality checklist."],
  ["Implementation Summary", "A checklist was added to the handoff process."],
  ["Implementation Evidence", "Implementation evidence is available in the CRM."],
]);
section("Suggestion SUG-2609-003", [
  ["Status", "New"],
  ["Suggestion", "Send clients a short progress update before final delivery."],
]);
section("Case Timeline", [
  ["Sep 01, 2026 · 6:02 PM", "Order PX-2609-002 created."],
  ["Sep 01, 2026 · 6:15 PM", "Advance payment recorded."],
  ["Sep 01, 2026 · 6:30 PM", "Complaint CMP-2609-002 filed."],
  ["Sep 01, 2026 · 6:45 PM", "Complaint confirmed and designer notified."],
  ["Sep 01, 2026 · 7:10 PM", "Review REV-2609-002 recorded."],
  ["Sep 01, 2026 · 7:25 PM", "Suggestion SUG-2609-002 implemented."],
], ["Date & Time", "Activity"]);
section("Internal Management Notes", [
  ["Complaint CMP-2609-002", "Follow up after the corrected delivery.\nAdmin · Sep 01, 2026 · 6:50 PM"],
], ["Record", "Private Note"]);

const pages = doc.getNumberOfPages();
for (let page = 1; page <= pages; page += 1) {
  doc.setPage(page);
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, pageHeight - 35, pageWidth - margin, pageHeight - 35);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...slate);
  doc.text("Pixely Careers CRM · Client Case Report · PX-2609-002", margin, pageHeight - 19);
  doc.text(`Confidential Internal Record · Page ${page} of ${pages}`, pageWidth - margin, pageHeight - 19, { align: "right" });
}

fs.mkdirSync(new URL("../screenshots/", import.meta.url), { recursive: true });
fs.writeFileSync(output, Buffer.from(doc.output("arraybuffer")));
console.log(output);