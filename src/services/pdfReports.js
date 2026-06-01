import PDFDocument from "pdfkit";

function addWrappedList(doc, items = []) {
  for (const item of items) {
    doc.text(`- ${item}`, { indent: 20 });
    doc.moveDown(0.3);
  }
}

function addMetrics(doc, report) {
  const metrics = report.overall?.metrics || {};
  doc.font("Helvetica-Bold").fontSize(14).text("Overall Scores");
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(11);

  for (const [key, value] of Object.entries(metrics)) {
    doc.text(`${key.replace(/_/g, " ")}: ${value}/10`, { indent: 20 });
  }
  doc.moveDown();
}

function buildReportPdf(report, title, includeQuestionBreakdown) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.font("Helvetica-Bold").fontSize(18).text(title);
    doc.moveDown();
    doc.font("Helvetica").fontSize(11);
    doc.text(`Report ID: ${report.report_id || "N/A"}`);
    doc.text(`Date: ${report.generated_date || "N/A"}`);
    doc.moveDown();

    addMetrics(doc, report);

    const ats = report.ats_analysis || {};
    doc.font("Helvetica-Bold").fontSize(14).text("ATS Analysis");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(11);
    doc.text(`ATS Score: ${ats.ats_score || 0}/100`, { indent: 20 });
    doc.text(`Skills Found: ${(ats.skills_found || []).join(", ")}`, { indent: 20 });
    doc.moveDown(0.5);
    doc.text("Improvements:", { indent: 20 });
    addWrappedList(doc, ats.improvements || []);
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(14).text("Strengths");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(11);
    addWrappedList(doc, report.strengths || []);
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(14).text("Areas to Improve");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(11);
    addWrappedList(doc, report.areas_to_improve || []);
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(14).text("Interview Tips");
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(11);
    addWrappedList(doc, report.interview_tips || []);

    if (includeQuestionBreakdown && report.question_breakdown?.length) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(14).text("Question-wise Performance");
      doc.moveDown();
      doc.font("Helvetica").fontSize(10);

      for (const item of report.question_breakdown) {
        const ev = item.evaluation || {};
        doc.font("Helvetica-Bold").text(`Q${item.number}: ${item.question || ""}`);
        doc.font("Helvetica").text(`Answer: ${item.answer || ""}`);
        doc.text(`Scores: confidence ${ev.confidence || 0}, body ${ev.body_language || 0}, knowledge ${ev.knowledge || 0}, fluency ${ev.fluency || 0}, relevance ${ev.skill_relevance || 0}`);
        if (ev.feedback) {
          doc.text(`Feedback: ${ev.feedback}`);
        }
        doc.moveDown();
      }
    }

    doc.end();
  });
}

export function generatePerformancePdf(report) {
  return buildReportPdf(report, "Interview Performance Report", true);
}

export function generateAtsPdf(report) {
  return buildReportPdf(report, "ATS Candidate Report", false);
}
