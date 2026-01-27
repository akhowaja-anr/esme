import { googleClientFromAccessToken } from "./googleClient.js";

export async function getDriveFileContent({ accessToken, fileId, mimeType }) {
  const clients = googleClientFromAccessToken(accessToken);

  // DOCS
  if (mimeType === "application/vnd.google-apps.document") {
    const doc = await clients.docs.documents.get({ documentId: fileId });
    const title = doc.data.title || "Untitled Doc";
    const text = extractDocText(doc.data);

    return {
      name: title,
      mimeType,
      content: text,
      note: "Google Docs text content",
    };
  }

  // SLIDES
  if (mimeType === "application/vnd.google-apps.presentation") {
    const pres = await clients.slides.presentations.get({ presentationId: fileId });
    const title = pres.data.title || "Untitled Slides";
    const text = extractSlidesText(pres.data);

    return {
      name: title,
      mimeType,
      content: text,
      note: "Google Slides text content",
    };
  }

  // SHEETS (sample like Apps Script)
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    const meta = await clients.sheets.spreadsheets.get({ spreadsheetId: fileId });
    const title = meta.data.properties?.title || "Untitled Sheet";

    const sheets = meta.data.sheets || [];
    const MAX_ROWS = 100;
    const MAX_COLS = 50;

    const parts = [];
    for (const s of sheets) {
      const sheetName = s.properties?.title;
      if (!sheetName) continue;

      const range = `'${sheetName.replace(/'/g, "''")}'!A1:${colToA1(MAX_COLS)}${MAX_ROWS}`;

      const valuesResp = await clients.sheets.spreadsheets.values.get({
        spreadsheetId: fileId,
        range,
        valueRenderOption: "FORMATTED_VALUE",
      });

      const values = valuesResp.data.values || [];
      if (!values.length) continue;

      let block = `\n[Sheet: ${sheetName} (Data Sample)]\n`;
      block += values.map((row) => row.join(" | ")).join("\n");
      parts.push(block);
    }

    return {
      name: title,
      mimeType,
      content: parts.join("\n\n---\n\n"),
      note: "Google Sheets content formatted as text",
    };
  }

  throw new Error(`Unsupported mimeType: ${mimeType}`);
}

/** -------- helpers -------- **/

function extractDocText(doc) {
  const out = [];
  const content = doc.body?.content || [];
  for (const el of content) {
    const para = el.paragraph;
    if (!para) continue;
    for (const pe of para.elements || []) {
      const tr = pe.textRun;
      if (tr?.content) out.push(tr.content);
    }
  }
  return out.join("").trim();
}

function extractSlidesText(pres) {
  const slides = pres.slides || [];
  const blocks = [];

  slides.forEach((slide, idx) => {
    const texts = [];
    const pageElements = slide.pageElements || [];

    for (const el of pageElements) {
      // shapes with text
      if (el.shape?.text?.textElements) {
        for (const t of el.shape.text.textElements || []) {
          const c = t.textRun?.content;
          if (c && c.trim()) texts.push(c.trim());
        }
      }

      // tables
      if (el.table?.tableRows) {
        for (const row of el.table.tableRows) {
          for (const cell of row.tableCells || []) {
            for (const t of cell.text?.textElements || []) {
              const c = t.textRun?.content;
              if (c && c.trim()) texts.push(`[Table Cell]: ${c.trim()}`);
            }
          }
        }
      }
    }

    if (texts.length) blocks.push(`--- Slide ${idx + 1} ---\n${texts.join("\n")}`);
  });

  return blocks.join("\n\n").trim();
}

function colToA1(n) {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
