import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { badRequest } from '../utils/httpError.js';

const MAX_CONTEXT_CHARS = 12000;

export async function extractFileText(file) {
  if (!file) {
    return '';
  }

  const extension = file.originalname.toLowerCase().split('.').pop();
  let text = '';

  if (extension === 'txt') {
    text = file.buffer.toString('utf8');
  } else if (extension === 'pdf') {
    const parsed = await pdfParse(file.buffer);
    text = parsed.text;
  } else if (extension === 'docx') {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer });
    text = parsed.value;
  } else {
    throw badRequest('Only PDF, DOCX, and TXT files are supported');
  }

  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_CONTEXT_CHARS);
}
