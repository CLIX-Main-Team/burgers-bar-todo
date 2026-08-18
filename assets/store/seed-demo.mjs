// Fills a throwaway database with the shift that appears in the store screenshots.
//
// The listing cannot use production: the client's real board is their operational data, and
// the one test account there holds a single leftover task, which photographs as an app with
// nothing in it. So the screenshots are shot against this: a plausible Tuesday at a branch
// that does not exist, in Hebrew, with no client content anywhere in it.
//
// It writes plain rows rather than going through the API because nothing here needs the
// app's rules — it is a picture, not a fixture. The one exception is the password, hashed
// with the same argon2id the API verifies with, so the screenshot script can really sign in.
//
//   DEMO_DATABASE_URL=postgres://burgers:burgers@localhost:5570/burgers_store_demo \
//     node assets/store/seed-demo.mjs
import { hash } from '@node-rs/argon2'
import pg from 'pg'

const DATABASE_URL = process.env.DEMO_DATABASE_URL
if (!DATABASE_URL) {
  console.error('Set DEMO_DATABASE_URL. Never point this at production.')
  process.exit(1)
}
if (/render|supabase|amazonaws/i.test(DATABASE_URL)) {
  console.error('That looks like a hosted database. This script only seeds a local one.')
  process.exit(1)
}

const PASSWORD = process.env.DEMO_PASSWORD ?? 'Demo-Shift-2026!'

const STAFF = [
  { email: 'yael@demo.local', name: 'יעל אברהמי', role: 'manager' },
  { email: 'noa@demo.local', name: 'נועה בר־און', role: 'employee' },
  { email: 'omri@demo.local', name: 'עומרי כהן', role: 'employee' },
]

// A shift's worth of work, spread across the three columns so the board photographs with
// each status tab carrying something.
const TASKS = [
  {
    title: 'פתיחת עמדת הגריל',
    description: 'הדלקת הגריל, בדיקת טמפרטורה, ניקוי משטחי העבודה לפני תחילת המשמרת.',
    status: 'not_started',
    priority: 'high',
    assignees: [1],
  },
  {
    title: 'ספירת מלאי לחמניות ובשר',
    description: 'ספירה מול טופס המלאי היומי והזמנה מהספק אם חסר.',
    status: 'not_started',
    priority: 'normal',
    assignees: [2],
  },
  {
    title: 'בדיקת טמפרטורת המקררים',
    description: 'רישום הטמפרטורות בשלושת המקררים ובמקפיא ביומן הבקרה.',
    status: 'in_progress',
    priority: 'high',
    assignees: [1, 2],
  },
  {
    title: 'סידור אזור הישיבה לפני הפתיחה',
    description: 'ניגוב שולחנות, סידור כיסאות והשלמת מפיות וסכו״ם.',
    status: 'in_progress',
    priority: 'normal',
    assignees: [2],
  },
  {
    title: 'החלפת שמן בטיגון',
    description: 'סינון והחלפה לפי מד הצבע, ורישום התאריך על המדבקה.',
    status: 'not_started',
    priority: 'normal',
    assignees: [1],
  },
  {
    title: 'הזמנת ירקות לשבוע הבא',
    description: 'עגבניות, חסה ובצל מול הספק הקבוע, לפי הצריכה של השבוע האחרון.',
    status: 'not_started',
    priority: 'low',
    assignees: [0],
  },
  {
    title: 'בדיקת מלאי אריזות ושקיות',
    description: 'השלמה מהמחסן האחורי לפני שעת העומס.',
    status: 'not_started',
    priority: 'normal',
    assignees: [2],
  },
  {
    title: 'תדרוך קצר לצוות על התפריט החדש',
    description: 'עשר דקות לפני הפתיחה, כולל המנה החדשה והאלרגנים שלה.',
    status: 'in_progress',
    priority: 'high',
    assignees: [0, 1],
  },
  {
    title: 'העברת משמרת לצוות הערב',
    description: 'סיכום קצר על המלאי, התקלות והזמנות פתוחות.',
    status: 'done',
    priority: 'normal',
    assignees: [0],
  },
  {
    title: 'ניקוי מכונת המשקאות',
    description: 'שטיפת הראשים והחלפת הסירופ לפי הנוהל.',
    status: 'done',
    priority: 'low',
    assignees: [2],
  },
]

// One answered question per language, so the assistant screenshot shows the feature doing its
// job rather than an empty composer. The answers are written the way the deployed assistant
// answers: grounded, short, and in the language the question was asked in — an English listing
// should not photograph a Hebrew conversation.
const THREADS = [
  {
    title: 'מה נוהל בדיקת טמפרטורת המקררים?',
    question: 'מה נוהל בדיקת טמפרטורת המקררים?',
    answer:
      'לפי נוהל הבקרה היומי, יש לרשום את הטמפרטורה בכל אחד משלושת המקררים ובמקפיא בתחילת המשמרת ובסופה.\n\nהטווח התקין למקררים הוא 1° עד 4°, ולמקפיא מינוס 18° ומטה. חריגה נרשמת ביומן ומדווחת מיד למנהל המשמרת.',
  },
  {
    title: 'What is the fridge temperature check?',
    question: 'What is the fridge temperature check?',
    answer:
      'The daily control procedure asks for the temperature of all three fridges and the freezer, recorded at the start and at the end of every shift.\n\nFridges should read between 1° and 4°, and the freezer at minus 18° or below. Anything outside that goes in the log and is reported to the shift manager straight away.',
  },
]

const { Client } = pg
const client = new Client({ connectionString: DATABASE_URL })
await client.connect()

const passwordHash = await hash(PASSWORD)

const { rows: locationRows } = await client.query(
  'insert into locations (name) values ($1) returning id',
  ['סניף הרצליה'],
)
const locationId = locationRows[0].id

const userIds = []
for (const person of STAFF) {
  const { rows } = await client.query(
    `insert into users (email, display_name, role, location_id, status, password_hash, preferred_language)
     values ($1, $2, $3, $4, 'active', $5, 'he') returning id`,
    [person.email, person.name, person.role, locationId, passwordHash],
  )
  userIds.push(rows[0].id)
}

let position = 0
for (const task of TASKS) {
  const { rows } = await client.query(
    `insert into tasks (location_id, created_by, title, description, status, priority, position,
                        completed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning id`,
    [
      locationId,
      userIds[0],
      task.title,
      task.description,
      task.status,
      task.priority,
      position++,
      task.status === 'done' ? new Date() : null,
    ],
  )
  for (const index of task.assignees) {
    await client.query('insert into task_assignees (task_id, user_id) values ($1, $2)', [
      rows[0].id,
      userIds[index],
    ])
  }
}

for (const thread of THREADS) {
  const { rows } = await client.query(
    'insert into threads (user_id, title) values ($1, $2) returning id',
    [userIds[0], thread.title],
  )
  await client.query(
    `insert into messages (thread_id, role, content) values ($1, 'user', $2), ($1, 'agent', $3)`,
    [rows[0].id, thread.question, thread.answer],
  )
}

await client.end()
console.log(`Seeded ${STAFF.length} staff, ${TASKS.length} tasks and ${THREADS.length} threads.`)
console.log(`Sign in as ${STAFF[0].email} / ${PASSWORD}`)
