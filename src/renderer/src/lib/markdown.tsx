import { type ReactNode } from 'react'

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\n]+\*)/g

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  INLINE.lastIndex = 0
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    const key = `${match.index}-${token}`
    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded bg-white/5 px-1 py-0.5">
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      nodes.push(
        <a
          key={key}
          href={link?.[2] ?? '#'}
          target="_blank"
          rel="noreferrer"
          className="text-sky-400 underline"
        >
          {link?.[1] ?? token}
        </a>
      )
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

type Block =
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'p'; text: string }

function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const code: string[] = []
      index++
      while (index < lines.length && !lines[index].startsWith('```')) {
        code.push(lines[index])
        index++
      }
      index++
      blocks.push({ kind: 'code', lang, lines: code })
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
      index++
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ''))
        index++
      }
      blocks.push({ kind: 'ul', items })
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ''))
        index++
      }
      blocks.push({ kind: 'ol', items })
      continue
    }
    if (line.startsWith('>')) {
      const text = line.replace(/^>\s?/, '')
      blocks.push({ kind: 'quote', text })
      index++
      continue
    }
    if (line.trim() === '') {
      index++
      continue
    }
    blocks.push({ kind: 'p', text: line })
    index++
  }
  return blocks
}

export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  if (!source.trim()) return null
  const blocks = parse(source)
  return (
    <div className={`answer ${className}`}>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'code':
            return (
              <pre key={i}>
                <code>{block.lines.join('\n')}</code>
              </pre>
            )
          case 'heading':
            return (
              <h2 key={i} style={{ fontSize: block.level <= 2 ? undefined : '0.78rem' }}>
                {renderInline(block.text)}
              </h2>
            )
          case 'ul':
            return (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ol>
            )
          case 'quote':
            return <blockquote key={i}>{renderInline(block.text)}</blockquote>
          default:
            return <p key={i}>{renderInline(block.text)}</p>
        }
      })}
    </div>
  )
}
