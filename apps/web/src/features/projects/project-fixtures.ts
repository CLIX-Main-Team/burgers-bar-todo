import type { TaskStatus } from '@burgers/shared'

// Sample projects for the v2 Projects screen (round 10). There is no projects table, no
// endpoint and no write path yet — the owner's call was front-end first, backend later — so
// this file is the whole data layer, and the screen says so on its face rather than looking
// like a surface that lost its data.
//
// A project reuses the board's own TaskStatus rather than inventing a parallel vocabulary:
// it wears the same three dots and reads the same three words the lanes do, which is what
// makes the two screens feel like one app. When the real table lands it should keep that.
//
// Both languages are written here rather than run through the message catalogue: these are
// placeholder rows, not app copy, and the catalogue should not carry names that will be
// deleted the day the backend exists.

export interface DemoProject {
  id: string
  name: { en: string; he: string }
  // The branch a project belongs to, or null when it runs across the whole chain.
  branch: { en: string; he: string } | null
  owners: { en: string; he: string }[]
  done: number
  total: number
  status: TaskStatus
}

const YAEL = { en: 'Yael Bar', he: 'יעל בר' }
const AMIT = { en: 'Amit Cohen', he: 'עמית כהן' }
const ORI = { en: 'Ori Mizrahi', he: 'אורי מזרחי' }
const SHAHAR = { en: 'Shahar Adler', he: 'שחר אדלר' }

export const DEMO_PROJECTS: DemoProject[] = [
  {
    id: 'p1',
    name: { en: 'Winter menu rollout', he: 'השקת תפריט החורף' },
    branch: null,
    owners: [YAEL, AMIT],
    done: 8,
    total: 14,
    status: 'in_progress',
  },
  {
    id: 'p2',
    name: { en: 'Ashdod Marina opening', he: 'פתיחת אשדוד מרינה' },
    branch: { en: 'Ashdod Marina', he: 'אשדוד מרינה' },
    owners: [ORI],
    done: 3,
    total: 21,
    status: 'in_progress',
  },
  {
    id: 'p3',
    name: { en: 'Kashrut audit 2026', he: 'ביקורת כשרות 2026' },
    branch: null,
    owners: [SHAHAR],
    done: 12,
    total: 12,
    status: 'done',
  },
  {
    id: 'p4',
    name: { en: 'Register upgrade', he: 'שדרוג הקופות' },
    branch: { en: 'Dizengoff', he: 'דיזנגוף' },
    owners: [YAEL],
    done: 0,
    total: 6,
    status: 'not_started',
  },
]

// A finished project reads 100% even if the counts were edited to disagree, and an empty one
// never divides by zero.
export function completionPercent(project: DemoProject): number {
  if (project.total === 0) return 0
  return Math.round((Math.min(project.done, project.total) / project.total) * 100)
}
