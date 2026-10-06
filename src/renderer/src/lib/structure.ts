export interface SectionStat {
  heading: string
  level: number
  words: number
  bullets: number
  codeBlocks: number
}

export interface AnswerStructure {
  sections: SectionStat[]
  words: number
  bullets: number
  codeBlocks: number
  hasIntroduction: boolean
  hasContent: boolean
  hasConclusion: boolean
  complete: boolean
}

export const REQUIRED_SECTIONS = [
  { key: 'introduction', label: 'Introduction' },
  { key: 'content', label: 'Content' },
  { key: 'conclusion', label: 'Conclusion' }
] as const

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const FENCE_RE = /^\s*```/
const BULLET_RE = /^\s*(?:[-*+]|\d+\.)\s+/

const normalize = (heading: string): string => heading.toLowerCase().replace(/[^a-z]/g, '')

function emptySection(): SectionStat {
  return { heading: '', level: 0, words: 0, bullets: 0, codeBlocks: 0 }
}

function isBlank(section: SectionStat): boolean {
  return !section.heading && section.words === 0 && section.bullets === 0 && section.codeBlocks === 0
}

function countWords(line: string): number {
  return line.trim().split(/\s+/).filter(Boolean).length
}

export function parseStructure(markdown: string): AnswerStructure {
  const sections: SectionStat[] = []
  let current = emptySection()
  let fenced = false
  let totalBullets = 0
  let totalCodeBlocks = 0

  const commit = (): void => {
    if (!isBlank(current)) sections.push(current)
    current = emptySection()
  }

  for (const line of (markdown ?? '').split(/\r?\n/)) {
    if (FENCE_RE.test(line)) {
      if (fenced) {
        fenced = false
      } else {
        fenced = true
        totalCodeBlocks += 1
        current.codeBlocks += 1
      }
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading && !fenced) {
      commit()
      current = { heading: heading[2].trim(), level: heading[1].length, words: 0, bullets: 0, codeBlocks: 0 }
      continue
    }

    if (fenced) continue

    if (BULLET_RE.test(line)) {
      current.bullets += 1
      totalBullets += 1
      current.words += countWords(line)
      continue
    }
    current.words += countWords(line)
  }
  commit()

  const words = sections.reduce((sum, section) => sum + section.words, 0)
  const keys = sections.map((section) => normalize(section.heading))
  const match = (test: (key: string) => boolean): boolean => keys.some((key) => key.length > 0 && test(key))

  const hasIntroduction = match((key) => key.startsWith('intro'))
  const hasContent = match(
    (key) => key.startsWith('content') || key.startsWith('body') || key.startsWith('mainpoint') || key.startsWith('detail')
  )
  const hasConclusion = match(
    (key) =>
      key.startsWith('conclu') ||
      key.startsWith('summary') ||
      key.startsWith('closing') ||
      key.startsWith('wrapup') ||
      key.startsWith('final')
  )

  return {
    sections,
    words,
    bullets: totalBullets,
    codeBlocks: totalCodeBlocks,
    hasIntroduction,
    hasContent,
    hasConclusion,
    complete: hasIntroduction && hasContent && hasConclusion
  }
}

export function sectionPresence(structure: AnswerStructure): Array<{ label: string; present: boolean }> {
  return [
    { label: REQUIRED_SECTIONS[0].label, present: structure.hasIntroduction },
    { label: REQUIRED_SECTIONS[1].label, present: structure.hasContent },
    { label: REQUIRED_SECTIONS[2].label, present: structure.hasConclusion }
  ]
}
