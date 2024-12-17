#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { sync: globSync } = require('glob');
const { execFile } = require('child_process');
const translate = require('@vitalets/google-translate-api');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const tesseract = require('node-tesseract-ocr');

// Adjust these as needed
const SOURCE_DIR = path.join(__dirname, 'Contracts');
const TARGET_LANG = 'en';
const PDTOCAIRO_PATH = '/opt/homebrew/bin/pdftocairo'; // Change if different on your system

const tesseractConfig = {
  lang: "chi_sim", // Ensure this language pack is installed
  oem: 1,
  psm: 3,
};

(async () => {
  try {
    if (!await fs.pathExists(SOURCE_DIR)) {
      throw new Error(`Source directory not found: ${SOURCE_DIR}`);
    }

    const pdfFiles = globSync(path.join(SOURCE_DIR, '**/*.pdf'), { nodir: true });

    if (pdfFiles.length === 0) {
      console.log("No PDF files found in the specified directory.");
      process.exit(0);
    }

    for (const pdfFilePath of pdfFiles) {
      console.log(`Processing: ${pdfFilePath}`);

      let extractedText = '';
      try {
        extractedText = await extractTextFromImagePDF(pdfFilePath);
      } catch (err) {
        console.error(`Failed to extract text (OCR) from ${pdfFilePath}:`, err);
        continue;
      }

      if (!extractedText.trim()) {
        console.warn(`No text found in ${pdfFilePath} after OCR. Skipping translation.`);
        continue;
      }

      let translatedText;
      try {
        translatedText = await translateText(extractedText, TARGET_LANG);
      } catch (err) {
        console.error(`Translation failed for ${pdfFilePath}:`, err);
        continue;
      }

      let translatedPdfBytes;
      try {
        translatedPdfBytes = await createTranslatedPDF(translatedText);
      } catch (err) {
        console.error(`Failed to create translated PDF for ${pdfFilePath}:`, err);
        continue;
      }

      const { dir, name, ext } = path.parse(pdfFilePath);
      const outputPath = path.join(dir, `${name}-en${ext}`);
      try {
        await fs.writeFile(outputPath, translatedPdfBytes);
      } catch (err) {
        console.error(`Failed to write translated PDF to ${outputPath}:`, err);
        continue;
      }

      console.log(`Translated PDF saved to ${outputPath}`);
    }

    console.log("Processing complete.");
  } catch (err) {
    console.error("An error occurred:", err);
  }
})();

async function extractTextFromImagePDF(pdfPath) {
  const outputDir = path.join(__dirname, 'temp_ocr_output', path.basename(pdfPath, path.extname(pdfPath)));
  await fs.ensureDir(outputDir);

  // Convert PDF to PNG images using system pdftocairo
  await new Promise((resolve, reject) => {
    const args = ['-png', '-scale-to', '1024', pdfPath, path.join(outputDir, 'page')];
    execFile(PDTOCAIRO_PATH, args, (error) => {
      if (error) return reject(error);
      resolve();
    });
  });

  const images = globSync(path.join(outputDir, 'page*.png'));
  if (images.length === 0) {
    throw new Error("No images generated from PDF. Check Poppler installation.");
  }

  let fullText = '';
  for (const img of images) {
    const text = await tesseract.recognize(img, tesseractConfig);
    fullText += text.trim() + '\n';
  }

  // Clean up temp images
  await fs.remove(outputDir);

  return fullText;
}

async function translateText(text, targetLang) {
  const result = await translate(text, { to: targetLang });
  return result.text;
}

async function createTranslatedPDF(translatedText) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 12;
  const lineHeight = fontSize * 1.2;

  const { width, height } = page.getSize();
  const margin = 50;
  let y = height - margin;
  
  const translatedLines = translatedText.split('\n');

  for (const line of translatedLines) {
    let remainingLine = line;
    const maxWidth = width - 2 * margin;

    while (remainingLine.length > 0) {
      const wrapIndex = findWrapIndex(remainingLine, font, fontSize, maxWidth);
      const toWrite = remainingLine.substring(0, wrapIndex);
      page.drawText(toWrite, {
        x: margin,
        y: y,
        size: fontSize,
        font: font
      });
      remainingLine = remainingLine.substring(wrapIndex);
      y -= lineHeight;
      if (y < margin) {
        const newPage = pdfDoc.addPage();
        y = newPage.getSize().height - margin;
      }
    }
  }

  return pdfDoc.save();
}

function findWrapIndex(text, font, fontSize, maxWidth) {
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const slice = text.substring(0, mid);
    const width = font.widthOfTextAtSize(slice, fontSize);
    if (width > maxWidth) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return Math.max(1, low - 1);
}