export const GITHUB_REPO = 'vega-org/vega-desktop';
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
const PLACEHOLDER_NOTES_PATTERN = /^automated release of vega\.?$/i;

export type MarkdownInline =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: MarkdownInline[] }
  | { type: 'italic'; children: MarkdownInline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; label: string; href: string };

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; inlines: MarkdownInline[] }
  | { type: 'paragraph'; inlines: MarkdownInline[] }
  | { type: 'unordered-list'; items: MarkdownInline[][] }
  | { type: 'ordered-list'; items: MarkdownInline[][] }
  | { type: 'blockquote'; inlines: MarkdownInline[] }
  | { type: 'code-block'; content: string }
  | { type: 'divider' };

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^(?:app-)?v/i, '').trim();
}

export function formatVersionLabel(version: string): string {
  const normalized = normalizeVersion(version);
  return normalized ? `v${normalized}` : '';
}

function parseVersionParts(version: string): number[] {
  const normalized = normalizeVersion(version);
  if (!normalized) return [];
  return normalized.split('.').map((part) => {
    const match = /^\d+/.exec(part.trim());
    return match ? Number(match[0]) : 0;
  });
}

export function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = parseVersionParts(latest);
  const currentParts = parseVersionParts(current);
  if (latestParts.length === 0 || currentParts.length === 0) return false;
  const length = Math.max(latestParts.length, currentParts.length, 3);
  for (let i = 0; i < length; i++) {
    const latestPart = latestParts[i] ?? 0;
    const currentPart = currentParts[i] ?? 0;
    if (latestPart > currentPart) return true;
    if (latestPart < currentPart) return false;
  }
  return false;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function isSafeHttpUrl(url: string): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function formatReleaseNotes(rawBody?: string | null): string {
  if (typeof rawBody !== 'string') return '';
  const normalized = rawBody.replace(/\r\n?/g, '\n').trim();
  if (!normalized || PLACEHOLDER_NOTES_PATTERN.test(normalized)) {
    return '';
  }

  const lines = normalized.split('\n');
  const kept: string[] = [];
  let skippingDownloads = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^#{1,6}\s+.*downloads\b.*$/i.test(trimmed)) {
      skippingDownloads = true;
      continue;
    }

    if (skippingDownloads) {
      if (trimmed === '' || trimmed.startsWith('|')) {
        continue;
      }
      skippingDownloads = false;
    }

    kept.push(line);
  }

  const cleaned = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned || normalized;
}

export function buildReleaseTagUrl(version: string): string {
  const cleanVersion = normalizeVersion(version);
  return cleanVersion
    ? `https://github.com/${GITHUB_REPO}/releases/tag/app-v${cleanVersion}`
    : `https://github.com/${GITHUB_REPO}/releases/latest`;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs = 4500,
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, data: null };
    }
    const data = (await response.json()) as T;
    return { ok: true, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

interface GitHubReleasePayload {
  tag_name?: string;
  html_url?: string;
  body?: string;
}

export async function fetchGitHubReleaseInfo(
  version: string,
  fallbackBody?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ notes: string; releaseUrl: string }> {
  const cleanVersion = normalizeVersion(version);
  const defaultUrl = buildReleaseTagUrl(version);
  const fallbackNotes =
    formatReleaseNotes(fallbackBody) || 'A new version of Vega is available.';

  if (!cleanVersion) {
    return { notes: fallbackNotes, releaseUrl: defaultUrl };
  }

  let releaseData: GitHubReleasePayload | null = null;
  const tagResult = await fetchJsonWithTimeout<GitHubReleasePayload>(
    `${GITHUB_RELEASES_API}/tags/app-v${encodeURIComponent(cleanVersion)}`,
    fetchImpl,
  );

  if (tagResult.ok && tagResult.data) {
    releaseData = tagResult.data;
  } else if (tagResult.status === 404) {
    const latestResult = await fetchJsonWithTimeout<GitHubReleasePayload>(
      `${GITHUB_RELEASES_API}/latest`,
      fetchImpl,
    );
    if (
      latestResult.ok &&
      latestResult.data &&
      normalizeVersion(latestResult.data.tag_name ?? '') === cleanVersion
    ) {
      releaseData = latestResult.data;
    }
  }

  const notes =
    formatReleaseNotes(releaseData?.body) ||
    formatReleaseNotes(fallbackBody) ||
    'A new version of Vega is available.';
  const releaseUrl =
    releaseData?.html_url && isSafeHttpUrl(releaseData.html_url)
      ? releaseData.html_url
      : defaultUrl;

  return { notes, releaseUrl };
}

function pushText(tokens: MarkdownInline[], value: string): void {
  if (!value) return;
  const prev = tokens[tokens.length - 1];
  if (prev?.type === 'text') {
    prev.value += value;
  } else {
    tokens.push({ type: 'text', value });
  }
}

function findClosingDelimiter(
  text: string,
  start: number,
  delimiter: string,
): number {
  let index = start;
  while (index < text.length) {
    if (text[index] === '\\' && index + 1 < text.length) {
      index += 2;
      continue;
    }
    if (text.startsWith(delimiter, index)) {
      if (
        delimiter === '_' &&
        index + 1 < text.length &&
        /[a-z0-9]/i.test(text[index + 1])
      ) {
        index++;
        continue;
      }
      return index;
    }
    index++;
  }
  return -1;
}

function trimBareUrl(raw: string): { url: string; trailing: string } {
  let url = raw;
  let trailing = '';
  while (url.length > 0 && /[.,;:!?'"\])]/.test(url[url.length - 1])) {
    const last = url[url.length - 1];
    if (last === ')' && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) {
      break;
    }
    trailing = last + trailing;
    url = url.slice(0, -1);
  }
  return { url, trailing };
}

export function parseInlineMarkdown(text: string): MarkdownInline[] {
  const tokens: MarkdownInline[] = [];
  let index = 0;

  while (index < text.length) {
    if (text[index] === '\\' && index + 1 < text.length) {
      pushText(tokens, text[index + 1]);
      index += 2;
      continue;
    }

    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1);
      if (end > index + 1) {
        tokens.push({ type: 'code', value: text.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (text[index] === '[') {
      const closeBracket = text.indexOf(']', index + 1);
      if (closeBracket > index + 1 && text[closeBracket + 1] === '(') {
        const closeParen = text.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const label = text.slice(index + 1, closeBracket);
          const href = text.slice(closeBracket + 2, closeParen).trim();
          if (isSafeHttpUrl(href)) {
            tokens.push({ type: 'link', label, href });
          } else {
            pushText(tokens, label);
          }
          index = closeParen + 1;
          continue;
        }
      }
    }

    if (text.startsWith('**', index)) {
      const end = findClosingDelimiter(text, index + 2, '**');
      if (end > index + 2) {
        tokens.push({
          type: 'bold',
          children: parseInlineMarkdown(text.slice(index + 2, end)),
        });
        index = end + 2;
        continue;
      }
    }

    if (text[index] === '*' && !text.startsWith('**', index)) {
      const end = findClosingDelimiter(text, index + 1, '*');
      if (end > index + 1) {
        tokens.push({
          type: 'italic',
          children: parseInlineMarkdown(text.slice(index + 1, end)),
        });
        index = end + 1;
        continue;
      }
    }

    if (
      text[index] === '_' &&
      (index === 0 || /[\s([{'"]/.test(text[index - 1]))
    ) {
      const end = findClosingDelimiter(text, index + 1, '_');
      if (end > index + 1) {
        tokens.push({
          type: 'italic',
          children: parseInlineMarkdown(text.slice(index + 1, end)),
        });
        index = end + 1;
        continue;
      }
    }

    if (text.startsWith('https://', index) || text.startsWith('http://', index)) {
      const match = /^https?:\/\/[^\s<>]+/.exec(text.slice(index));
      if (match) {
        const { url, trailing } = trimBareUrl(match[0]);
        if (isSafeHttpUrl(url)) {
          tokens.push({ type: 'link', label: url, href: url });
          if (trailing) pushText(tokens, trailing);
          index += match[0].length;
          continue;
        }
      }
    }

    pushText(tokens, text[index]);
    index++;
  }

  return tokens;
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const normalized = markdown.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      i++;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i++;
      }
      blocks.push({ type: 'code-block', content: codeLines.join('\n') });
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'divider' });
      i++;
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 4) as 1 | 2 | 3 | 4;
      blocks.push({
        type: 'heading',
        level,
        inlines: parseInlineMarkdown(headingMatch[2].trim()),
      });
      i++;
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({
        type: 'blockquote',
        inlines: parseInlineMarkdown(quoteLines.join(' ').trim()),
      });
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items: MarkdownInline[][] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(parseInlineMarkdown(lines[i].trim().replace(/^[-*+]\s+/, '')));
        i++;
      }
      blocks.push({ type: 'unordered-list', items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: MarkdownInline[][] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(parseInlineMarkdown(lines[i].trim().replace(/^\d+\.\s+/, '')));
        i++;
      }
      blocks.push({ type: 'ordered-list', items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const next = lines[i].trim();
      if (
        !next ||
        next.startsWith('```') ||
        /^(?:-{3,}|\*{3,}|_{3,})$/.test(next) ||
        /^(#{1,4})\s+/.test(next) ||
        next.startsWith('>') ||
        /^[-*+]\s+/.test(next) ||
        /^\d+\.\s+/.test(next)
      ) {
        break;
      }
      paragraphLines.push(next);
      i++;
    }
    if (paragraphLines.length > 0) {
      blocks.push({
        type: 'paragraph',
        inlines: parseInlineMarkdown(paragraphLines.join(' ')),
      });
    }
  }

  return blocks;
}
