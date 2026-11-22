import React from 'react';
import {
  parseMarkdownBlocks,
  type MarkdownBlock,
  type MarkdownInline,
} from '../../lib/updater/releaseNotes';
import { isTauriRuntime } from '../../platform/host';

function openReleaseLink(href: string): void {
  if (isTauriRuntime()) {
    import('@tauri-apps/plugin-opener')
      .then(({ openUrl }) => openUrl(href))
      .catch(() => {
        window.open(href, '_blank', 'noopener,noreferrer');
      });
    return;
  }
  window.open(href, '_blank', 'noopener,noreferrer');
}

function renderInlines(
  inlines: MarkdownInline[],
  keyPrefix: string,
): React.ReactNode[] {
  return inlines.map((token, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (token.type) {
      case 'text':
        return <React.Fragment key={key}>{token.value}</React.Fragment>;
      case 'bold':
        return (
          <strong key={key}>
            {renderInlines(token.children, `${key}-b`)}
          </strong>
        );
      case 'italic':
        return (
          <em key={key}>{renderInlines(token.children, `${key}-i`)}</em>
        );
      case 'code':
        return <code key={key}>{token.value}</code>;
      case 'link':
        return (
          <a
            key={key}
            href={token.href}
            className="app-update-md-link"
            onClick={(event) => {
              event.preventDefault();
              openReleaseLink(token.href);
            }}
          >
            {token.label}
          </a>
        );
    }
  });
}

function renderBlock(block: MarkdownBlock, index: number): React.ReactNode {
  const key = `md-block-${index}`;
  switch (block.type) {
    case 'heading': {
      const children = renderInlines(block.inlines, key);
      if (block.level <= 2) return <h3 key={key}>{children}</h3>;
      if (block.level === 3) return <h4 key={key}>{children}</h4>;
      return <h5 key={key}>{children}</h5>;
    }
    case 'paragraph':
      return <p key={key}>{renderInlines(block.inlines, key)}</p>;
    case 'unordered-list':
      return (
        <ul key={key}>
          {block.items.map((item, itemIdx) => (
            <li key={`${key}-li-${itemIdx}`}>
              {renderInlines(item, `${key}-li-${itemIdx}`)}
            </li>
          ))}
        </ul>
      );
    case 'ordered-list':
      return (
        <ol key={key}>
          {block.items.map((item, itemIdx) => (
            <li key={`${key}-li-${itemIdx}`}>
              {renderInlines(item, `${key}-li-${itemIdx}`)}
            </li>
          ))}
        </ol>
      );
    case 'blockquote':
      return (
        <blockquote key={key}>
          {renderInlines(block.inlines, key)}
        </blockquote>
      );
    case 'code-block':
      return (
        <pre key={key}>
          <code>{block.content}</code>
        </pre>
      );
    case 'divider':
      return <hr key={key} />;
  }
}

interface ReleaseNotesMarkdownProps {
  markdown: string;
}

export const ReleaseNotesMarkdown: React.FC<ReleaseNotesMarkdownProps> = ({
  markdown,
}) => {
  const blocks = React.useMemo(() => parseMarkdownBlocks(markdown), [markdown]);
  return <div className="app-update-markdown">{blocks.map(renderBlock)}</div>;
};
