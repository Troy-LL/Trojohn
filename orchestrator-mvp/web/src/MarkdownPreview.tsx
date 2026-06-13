import Markdown from 'react-markdown';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

/** Renders worker/judge text as formatted markdown instead of raw `**bold**` strings. */
export function MarkdownPreview({ content, className = '' }: MarkdownPreviewProps) {
  if (!content.trim()) return null;
  return (
    <div className={`markdown-preview ${className}`.trim()}>
      <Markdown>{content}</Markdown>
    </div>
  );
}
