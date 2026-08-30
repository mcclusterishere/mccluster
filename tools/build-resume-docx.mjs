/* ============================================================
   BUILD THE RÉSUMÉ .DOCX.

   Same law as the PDF: the résumé is matthew-mccluster.html, and this is
   a rendering of it. Nothing here is typed by hand, so there is no third
   copy of the career history to go stale next to the page and the PDF.

   WHY A .DOCX AT ALL, WHEN A PDF EXISTS.
   Applicant tracking systems. A large share of them still parse .doc/.docx
   more reliably than PDF, and plenty of recruiters are required to submit
   a Word file to their own client's portal. Handing somebody a PDF when
   their system wants Word means they retype it — badly, at speed, with
   your dates.

   SO THIS FILE IS BUILT FOR A PARSER, NOT FOR A DESIGNER.
   The PDF can be typeset. This cannot, and every choice below is about
   surviving a machine that reads top to bottom:

     - no tables. ATS parsers routinely flatten a two-column table into
       one scrambled line, which is how "ISNI 0000 0005" ends up as a job
       title. The identifier block is plain paragraphs here even though
       the PDF sets it in two columns.
     - no text boxes, no headers, no footers. Content in a Word header is
       invisible to a large share of parsers.
     - real heading styles, so the outline is machine-readable rather than
       just bold text that looks like a heading.
     - one job per paragraph group, in the order a human reads them:
       dates, then title, then employer.

   Run:  node tools/build-resume-docx.mjs
   ============================================================ */
import { readFileSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, ExternalHyperlink, convertInchesToTwip,
} from "docx";
import { parseResume } from "./resume-parse.mjs";

const ROOT = path.dirname(new URL(import.meta.url).pathname).replace(/\/tools$/, "");
const PAGE = path.join(ROOT, "matthew-mccluster.html");
const OUT_DIR = path.join(ROOT, "assets", "resume");
const OUT = path.join(OUT_DIR, "matthew-mccluster-resume.docx");

const r = parseResume(readFileSync(PAGE, "utf8"));

const INK = "111111";
const DIM = "444444";
const RUBY = "8A0F18";

const rule = {
  bottom: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB", space: 2 },
};

const kids = [];

/* ---- the header block: name, title, contact ---- */
kids.push(new Paragraph({
  spacing: { after: 40 },
  children: [new TextRun({
    text: r.kicker.toUpperCase(), bold: true, size: 15,
    color: RUBY, characterSpacing: 30,
  })],
}));
kids.push(new Paragraph({
  spacing: { after: 40 },
  children: [new TextRun({ text: r.name, bold: true, size: 44, color: INK })],
}));
kids.push(new Paragraph({
  spacing: { after: 40 },
  children: [new TextRun({ text: r.role, size: 21, color: DIM })],
}));
if (r.contact) {
  kids.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: r.contact, size: 19, color: DIM })],
  }));
}

/* ---- the summary ---- */
if (r.summary) {
  kids.push(new Paragraph({
    spacing: { after: 160 },
    children: [new TextRun({ text: r.summary, size: 19, color: INK })],
  }));
}

const heading = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  border: rule,
  spacing: { before: 260, after: 120 },
  children: [new TextRun({
    text: text.toUpperCase(), bold: true, size: 22, color: INK, characterSpacing: 12,
  })],
});

for (const sec of r.sections) {
  kids.push(heading(sec.title));

  if (sec.kind === "facts") {
    for (const f of sec.items) {
      kids.push(new Paragraph({
        spacing: { after: 70 },
        children: [
          new TextRun({ text: f.label ? f.label + " " : "", bold: true, size: 19, color: INK }),
          new TextRun({ text: f.value, size: 19, color: DIM }),
        ],
      }));
    }
  } else if (sec.kind === "roles") {
    /* dates, title, employer — three lines, no table. A parser reads this
       the way a person does; a two-column layout is where they scramble. */
    for (const j of sec.items) {
      kids.push(new Paragraph({
        spacing: { before: 100, after: 0 },
        children: [new TextRun({
          text: j.years.toUpperCase(), bold: true, size: 16, color: RUBY, characterSpacing: 14,
        })],
      }));
      kids.push(new Paragraph({
        spacing: { after: 0 },
        children: [new TextRun({ text: j.title, bold: true, size: 20, color: INK })],
      }));
      kids.push(new Paragraph({
        spacing: { after: j.bullets?.length ? 40 : 70 },
        children: [new TextRun({ text: j.where, size: 19, color: DIM })],
      }));
      /* Accomplishments. Word's own bullet numbering, not a literal "•":
         a typed bullet is a character an ATS reads as part of the sentence,
         while a real numbering definition is structure it can skip. */
      for (const b of j.bullets ?? []) {
        kids.push(new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 30 },
          children: [new TextRun({ text: b, size: 18, color: INK })],
        }));
      }
    }
  } else if (sec.kind === "ids") {
    for (const i of sec.items) {
      kids.push(new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: i.label + ": ", bold: true, size: 19, color: INK }),
          new TextRun({ text: i.value, size: 19, color: DIM }),
        ],
      }));
    }
  } else {
    for (const p of sec.items) {
      kids.push(new Paragraph({
        spacing: { after: 100 },
        children: [new TextRun({ text: p, size: 19, color: INK })],
      }));
    }
  }
}

/* ---- the footer, as content rather than a Word footer ----
   A real header/footer is invisible to a good share of ATS parsers, so
   the provenance line is the last paragraph of the body instead. */
kids.push(new Paragraph({
  border: { top: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB", space: 6 } },
  spacing: { before: 300 },
  children: [
    new TextRun({ text: "Full record: ", size: 17, color: DIM }),
    new ExternalHyperlink({
      link: "https://matthew.mccluster.org/matthew-mccluster.html",
      children: [new TextRun({ text: "matthew.mccluster.org", size: 17, color: DIM, underline: {} })],
    }),
    new TextRun({ text: `  ·  ${r.name} · McCluster Corp`, size: 17, color: DIM }),
  ],
}));

const doc = new Document({
  creator: r.name,
  title: `${r.name} — Résumé`,
  description: r.role,
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 19, color: INK } },
      heading1: { run: { font: "Calibri", bold: true, color: INK } },
    },
  },
  sections: [{
    properties: {
      page: {
        /* US Letter. docx-js defaults to A4, which prints with a margin
           strip on every American printer. */
        size: { width: 12240, height: 15840 },
        margin: {
          top: convertInchesToTwip(0.6), bottom: convertInchesToTwip(0.6),
          left: convertInchesToTwip(0.7), right: convertInchesToTwip(0.7),
        },
      },
    },
    children: kids,
  }],
});

mkdirSync(OUT_DIR, { recursive: true });
const buf = await Packer.toBuffer(doc);
writeFileSync(OUT, buf);
console.log(`wrote assets/resume/matthew-mccluster-resume.docx (${(buf.length / 1024).toFixed(0)} KB)`);
console.log(`  ${r.sections.length} sections, ${r.sections.find((s) => s.kind === "roles")?.items.length ?? 0} roles, ${(r.sections.find((s) => s.kind === "roles")?.items ?? []).reduce((n, j) => n + (j.bullets?.length ?? 0), 0)} bullets`);
