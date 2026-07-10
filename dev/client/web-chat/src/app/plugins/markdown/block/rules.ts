import { BlockMDRule } from './type';

const HEADING_REG_1 = /^(#{1,6}) +(.+)\n?/m;
export const HeadingRule: BlockMDRule = {
  match: (text) => text.match(HEADING_REG_1),
  html: (match, parseInline) => {
    const [, g1, g2] = match;
    const level = g1.length;
    return `<h${level} data-md="${g1}">${parseInline ? parseInline(g2) : g2}</h${level}>`;
  },
};

const CODEBLOCK_MD_1 = '```';
const CODEBLOCK_REG_1 = /^( {0,3})`{3}(\S*)[^\S\n]*\n((?:.*\n)+?)^ {0,3}`{3} *(?!.)\n?/m;
const stripCodeBlockFenceIndent = (body: string, fenceIndentLength: number): string => {
  if (fenceIndentLength <= 0) return body;
  return body.replace(new RegExp(`^ {0,${fenceIndentLength}}`, 'gm'), '');
};
export const CodeBlockRule: BlockMDRule = {
  match: (text) => text.match(CODEBLOCK_REG_1),
  html: (match) => {
    const [, fenceIndent = '', g1, g2] = match;
    const body = stripCodeBlockFenceIndent(g2, fenceIndent.length);
    // use last identifier after dot, e.g. for "example.json" gets us "json" as language code.
    const langCode = g1 ? g1.substring(g1.lastIndexOf('.') + 1) : null;
    const filename = g1 !== langCode ? g1 : null;
    const classNameAtt = langCode ? ` class="language-${langCode}"` : '';
    const filenameAtt = filename ? ` data-label="${filename}"` : '';
    return `<pre data-md="${CODEBLOCK_MD_1}"><code${classNameAtt}${filenameAtt}>${body}</code></pre>`;
  },
};

const BLOCKQUOTE_MD_1 = '>';
const QUOTE_LINE_PREFIX = /^> */;
const BLOCKQUOTE_TRAILING_NEWLINE = /\n$/;
const BLOCKQUOTE_REG_1 = /(^>.*\n?)+/m;
export const BlockQuoteRule: BlockMDRule = {
  match: (text) => text.match(BLOCKQUOTE_REG_1),
  html: (match, parseInline) => {
    const [blockquoteText] = match;

    const lines = blockquoteText
      .replace(BLOCKQUOTE_TRAILING_NEWLINE, '')
      .split('\n')
      .map((lineText) => {
        const line = lineText.replace(QUOTE_LINE_PREFIX, '');
        if (parseInline) return `${parseInline(line)}<br/>`;
        return `${line}<br/>`;
      })
      .join('');
    return `<blockquote data-md="${BLOCKQUOTE_MD_1}">${lines}</blockquote>`;
  },
};

const TABLE_MD_1 = '|';
const TABLE_MIN_DELIMITER_LENGTH = 3;
const TABLE_DELIMITER_CELL_REG = /^:?-{3,}:?$/;

const splitTableRow = (lineText: string): string[] => {
  const trimmedLine = lineText.trim();
  const withoutLeadingPipe = trimmedLine.startsWith('|') ? trimmedLine.slice(1) : trimmedLine;
  const withoutOuterPipes = withoutLeadingPipe.endsWith('|')
    ? withoutLeadingPipe.slice(0, -1)
    : withoutLeadingPipe;
  return withoutOuterPipes.split('|').map((cell) => cell.trim());
};

const isTableContentLine = (lineText: string): boolean => lineText.trim().includes('|');

const isTableDelimiterLine = (lineText: string): boolean => {
  const cells = splitTableRow(lineText);
  return (
    cells.length >= 2 &&
    cells.every((cell) => {
      const normalizedCell = cell.replace(/\s+/g, '');
      return (
        normalizedCell.length >= TABLE_MIN_DELIMITER_LENGTH &&
        TABLE_DELIMITER_CELL_REG.test(normalizedCell)
      );
    })
  );
};

const findTableMatch = (text: string): RegExpMatchArray | null => {
  const lines = text.split('\n');
  let offset = 0;

  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index];
    const delimiterLine = lines[index + 1];

    if (isTableContentLine(headerLine) && isTableDelimiterLine(delimiterLine)) {
      const headerCells = splitTableRow(headerLine);
      const delimiterCells = splitTableRow(delimiterLine);
      if (headerCells.length === delimiterCells.length) {
        let endIndex = index + 2;
        while (endIndex < lines.length && isTableContentLine(lines[endIndex])) {
          endIndex += 1;
        }

        const tableText = lines.slice(index, endIndex).join('\n');
        const match = [tableText] as RegExpMatchArray;
        match.index = offset;
        match.input = text;
        return match;
      }
    }

    offset += headerLine.length + 1;
  }

  return null;
};

const normalizeTableRowCells = (lineText: string, columnCount: number): string[] => {
  const cells = splitTableRow(lineText).slice(0, columnCount);
  while (cells.length < columnCount) {
    cells.push('');
  }
  return cells;
};

const renderTableCell = (
  tagName: 'td' | 'th',
  cellText: string,
  parseInline?: (txt: string) => string
): string => {
  const content = parseInline ? parseInline(cellText) : cellText;
  return `<${tagName}>${content}</${tagName}>`;
};

export const TableRule: BlockMDRule = {
  match: findTableMatch,
  html: (match, parseInline) => {
    const [tableText] = match;
    const [headerLine, , ...bodyLines] = tableText.split('\n');
    const columnCount = splitTableRow(headerLine).length;
    const headerCells = normalizeTableRowCells(headerLine, columnCount)
      .map((cell) => renderTableCell('th', cell, parseInline))
      .join('');
    const bodyRows = bodyLines
      .map((lineText) => {
        const cells = normalizeTableRowCells(lineText, columnCount)
          .map((cell) => renderTableCell('td', cell, parseInline))
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');

    return `<table data-md="${TABLE_MD_1}"><thead><tr>${headerCells}</tr></thead>${
      bodyRows ? `<tbody>${bodyRows}</tbody>` : ''
    }</table>`;
  },
};

const ORDERED_LIST_MD_1 = '-';
const O_LIST_ITEM_PREFIX = /^(-|[\da-zA-Z]\.) */;
const O_LIST_START = /^([\d])\./;
const O_LIST_TYPE = /^([aAiI])\./;
const O_LIST_TRAILING_NEWLINE = /\n$/;
const ORDERED_LIST_REG_1 = /(^(?:-|[\da-zA-Z]\.) +.+\n?)+/m;
export const OrderedListRule: BlockMDRule = {
  match: (text) => text.match(ORDERED_LIST_REG_1),
  html: (match, parseInline) => {
    const [listText] = match;
    const [, listStart] = listText.match(O_LIST_START) ?? [];
    const [, listType] = listText.match(O_LIST_TYPE) ?? [];

    const lines = listText
      .replace(O_LIST_TRAILING_NEWLINE, '')
      .split('\n')
      .map((lineText) => {
        const line = lineText.replace(O_LIST_ITEM_PREFIX, '');
        const txt = parseInline ? parseInline(line) : line;
        return `<li><p>${txt}</p></li>`;
      })
      .join('');

    const dataMdAtt = `data-md="${listType || listStart || ORDERED_LIST_MD_1}"`;
    const startAtt = listStart ? ` start="${listStart}"` : '';
    const typeAtt = listType ? ` type="${listType}"` : '';
    return `<ol ${dataMdAtt}${startAtt}${typeAtt}>${lines}</ol>`;
  },
};

const UNORDERED_LIST_MD_1 = '*';
const U_LIST_ITEM_PREFIX = /^\* */;
const U_LIST_TRAILING_NEWLINE = /\n$/;
const UNORDERED_LIST_REG_1 = /(^\* +.+\n?)+/m;
export const UnorderedListRule: BlockMDRule = {
  match: (text) => text.match(UNORDERED_LIST_REG_1),
  html: (match, parseInline) => {
    const [listText] = match;

    const lines = listText
      .replace(U_LIST_TRAILING_NEWLINE, '')
      .split('\n')
      .map((lineText) => {
        const line = lineText.replace(U_LIST_ITEM_PREFIX, '');
        const txt = parseInline ? parseInline(line) : line;
        return `<li><p>${txt}</p></li>`;
      })
      .join('');

    return `<ul data-md="${UNORDERED_LIST_MD_1}">${lines}</ul>`;
  },
};

export const UN_ESC_BLOCK_SEQ = /^\\*(#{1,6} +| {0,3}```|>|\||(-|[\da-zA-Z]\.) +|\* +)/;
export const ESC_BLOCK_SEQ = /^\\(\\*(#{1,6} +| {0,3}```|>|\||(-|[\da-zA-Z]\.) +|\* +))/;
