/** One printed line of the official DOCX (page 1..604, line 1..n within the page), with the paragraph it belongs to. */
export interface DocxLine {
  readonly page: number;
  readonly line: number;
  readonly text: string;
  readonly paragraph: number;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string): string =>
  s.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (_m, dec: string | undefined, hex: string | undefined, name: string | undefined) =>
    name ? ENTITIES[name]! : String.fromCodePoint(dec ? Number(dec) : parseInt(hex!, 16)),
  );

/**
 * Reads the page and line layout of the official KFGQPC DOCX from its `word/document.xml`: text (<w:t>) accumulates on the current line; every
 * <w:br/> ends the line, a <w:br w:type="page"/> also ends the page; the end of a paragraph ends the line. Empty lines are not lines.
 * (This is how the document is built: one printed line per break. The converter proves it by cross-checking every ayah against the CSV.)
 */
export function readDocxLines(documentXml: string): DocxLine[] {
  const lines: DocxLine[] = [];
  const token = /<w:p[\s>]|<\/w:p>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br(\s[^>]*)?\/>/g;
  let page = 1;
  let lineNo = 0;
  let paragraph = -1;
  let current: string[] = [];
  const flush = (endPage: boolean): void => {
    const text = current.join('').replace(/\u00a0/g, ' ').trim();
    if (text) {
      lineNo += 1;
      lines.push({ page, line: lineNo, text, paragraph });
    }
    current = [];
    if (endPage) {
      page += 1;
      lineNo = 0;
    }
  };
  for (let m = token.exec(documentXml); m !== null; m = token.exec(documentXml)) {
    const t = m[0];
    if (t.startsWith('<w:p')) paragraph += 1;
    else if (t === '</w:p>') flush(false);
    else if (t.startsWith('<w:tab')) current.push(' ');
    else if (t.startsWith('<w:br')) flush(/w:type="page"/.test(m[2] ?? ''));
    else current.push(decode(m[1] ?? ''));
  }
  flush(false);
  return lines;
}
