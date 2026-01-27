import express from "express";
import { googleClientFromAccessToken } from "../services/googleClient.js";

export const driveRouter = express.Router();

const SUPPORTED_MIME_TYPES = [
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
];

// GET /drive/files?limit=100
driveRouter.get("/files", async (req, res) => {
  try {
    const { drive } = googleClientFromAccessToken(req.googleAccessToken);

    const limit = Math.min(Number(req.query.limit) || 100, 200);

    const mimeQ = SUPPORTED_MIME_TYPES.map((m) => `mimeType='${m}'`).join(" or ");
    const q = `(${mimeQ}) and trashed=false`;

    const resp = await drive.files.list({
      q,
      pageSize: limit,
      orderBy: "modifiedTime desc",
      fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    });

    res.json({ files: resp.data.files || [] });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// GET /drive/search?q=abc&limit=100
driveRouter.get("/search", async (req, res) => {
  try {
    const { drive } = googleClientFromAccessToken(req.googleAccessToken);

    const qText = String(req.query.q || "").trim();
    if (!qText) return res.status(400).json({ error: "q is required" });

    const limit = Math.min(Number(req.query.limit) || 100, 200);

    const mimeQ = SUPPORTED_MIME_TYPES.map((m) => `mimeType='${m}'`).join(" or ");
    // Search guide: use files.list with q filters :contentReference[oaicite:5]{index=5}
    const q = `name contains '${qText.replace(/'/g, "\\'")}' and (${mimeQ}) and trashed=false`;

    const resp = await drive.files.list({
      q,
      pageSize: limit,
      orderBy: "modifiedTime desc",
      fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    });

    res.json({ files: resp.data.files || [] });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// POST /drive/content { fileId, mimeType }
driveRouter.post("/content", async (req, res) => {
  try {
    const { fileId, mimeType } = req.body || {};
    if (!fileId) return res.status(400).json({ error: "fileId is required" });

    const clients = googleClientFromAccessToken(req.googleAccessToken);

    // DOCS
    if (mimeType === "application/vnd.google-apps.document") {
      const doc = await clients.docs.documents.get({ documentId: fileId });
      const title = doc.data.title || "Untitled Doc";

      const text = extractDocText(doc.data);
      return res.json({
        name: title,
        mimeType,
        content: text,
        note: "Google Docs text content",
        characterCount: text.length,
      });
    }

    // SLIDES
    if (mimeType === "application/vnd.google-apps.presentation") {
      const pres = await clients.slides.presentations.get({ presentationId: fileId });
      const title = pres.data.title || "Untitled Slides";

      const text = extractSlidesText(pres.data);
      return res.json({
        name: title,
        mimeType,
        content: text,
        note: "Google Slides text content",
      });
    }

    // SHEETS (sample similar to Apps Script)
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

        // Values API: spreadsheets.values.get :contentReference[oaicite:6]{index=6}
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

      const combined = parts.join("\n\n---\n\n");
      return res.json({
        name: title,
        mimeType,
        content: combined,
        note: "Google Sheets content formatted as text",
        sheetCount: sheets.length,
      });
    }

    return res.status(400).json({
      error: "Unsupported mimeType. Only Docs/Sheets/Slides are supported.",
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/** ---------------- extraction helpers ---------------- **/

function extractDocText(doc) {
  const out = [];
  const content = doc.body?.content || [];

  for (const el of content) {
    const para = el.paragraph;
    if (!para) continue;

    const elems = para.elements || [];
    for (const pe of elems) {
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
        const te = el.shape.text.textElements || [];
        for (const t of te) {
          const c = t.textRun?.content;
          if (c && c.trim()) texts.push(c.trim());
        }
      }

      // tables
      if (el.table?.tableRows) {
        for (const row of el.table.tableRows) {
          for (const cell of row.tableCells || []) {
            const te = cell.text?.textElements || [];
            for (const t of te) {
              const c = t.textRun?.content;
              if (c && c.trim()) texts.push(`[Table Cell]: ${c.trim()}`);
            }
          }
        }
      }
    }

    if (texts.length) {
      blocks.push(`--- Slide ${idx + 1} ---\n${texts.join("\n")}`);
    }
  });

  return blocks.join("\n\n").trim();
}

function colToA1(n) {
  // 1 -> A, 26 -> Z, 27 -> AA
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}
