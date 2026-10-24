import { Document, Packer, Paragraph, TextRun } from 'docx';
import {
  extractAttachmentText,
  isIndexable,
} from './attachment-index.service';

describe('attachment text extraction', () => {
  it('knows which files it can index', () => {
    expect(isIndexable('.PDF')).toBe(true);
    expect(isIndexable('.docx')).toBe(true);
    expect(isIndexable('.png')).toBe(false);
    expect(isIndexable(null)).toBe(false);
  });

  it('extracts text from DOCX', async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun('Quarterly revenue report')] }),
            new Paragraph({ children: [new TextRun('Totals by region')] }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    const text = await extractAttachmentText('.docx', buffer);
    expect(text).toContain('Quarterly revenue report');
    expect(text).toContain('Totals by region');
  });

  // PDF extraction loads pdf.js via dynamic import(), which Jest's VM
  // cannot run; it is covered by the upload end-to-end check instead.

  it('reads plain text files as UTF-8', async () => {
    const text = await extractAttachmentText('.md', Buffer.from('# Café notes'));
    expect(text).toBe('# Café notes');
  });
});
