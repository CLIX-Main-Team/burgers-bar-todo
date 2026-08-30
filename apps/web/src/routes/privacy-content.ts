import type { AppLocale } from '../i18n/messages.js'

// The privacy policy, in both interface languages. Apple and Google each require a public
// URL to a policy before a listing can be submitted, and both then check it against what
// the app actually does — a generic template is a rejection risk, so every claim below was
// written against apps/api/src/db/schema.ts and the services the API really calls.
//
// It lives here rather than in i18n/messages.ts because that catalogue is UI chrome, short
// strings read a dozen at a time; a legal document dropped into it would bury them.
//
// TWO VALUES ARE STILL PLACEHOLDERS. The stores require a named controller and a working
// contact address, so `policyContact` below must be filled in with the client's registered
// business name and a mailbox someone reads before either store listing is submitted. The
// route is deliberately not linked from anywhere in the app until then. The account-deletion
// page shares the same address, so filling it in here fixes both.
export const policyContact = {
  en: { name: '[registered business name]', email: '[contact email]' },
  he: { name: '[שם העסק הרשום]', email: '[כתובת דוא"ל ליצירת קשר]' },
} as const

export interface PolicySection {
  heading: string
  paragraphs?: string[]
  bullets?: string[]
  // An in-app document this section points at, rendered as a link after its prose. Used to
  // send a reader from the policy to the account-deletion page, which Google Play requires
  // to be reachable and self-explanatory on its own.
  link?: { href: string; label: string }
}

export interface PolicyDocument {
  title: string
  lastUpdated: string
  intro: string
  sections: PolicySection[]
}

export const privacyPolicy: Record<AppLocale, PolicyDocument> = {
  en: {
    title: 'Privacy Policy',
    lastUpdated: 'Last updated: 30 August 2026',
    intro:
      'Burger’s Bar Staff is an internal tool for people who work at Burger’s Bar. Accounts are created by management and the app is not open to the public. This policy explains what the app stores about you, why it stores it, and who else can see it.',
    sections: [
      {
        heading: 'Who is responsible',
        paragraphs: [
          `The data described here is held by ${policyContact.en.name}, which decides how it is used. Questions, corrections and deletion requests go to ${policyContact.en.email}.`,
        ],
      },
      {
        heading: 'What the app stores',
        bullets: [
          'Your account: name, work email, role, branch and interface language. Your password is kept only as an Argon2 hash, never as readable text.',
          'Your work: tasks you create or are assigned, their descriptions, due dates, status changes and completion times.',
          'Your assistant conversations: the questions you type and the answers returned, kept so a thread can be reopened later.',
          'Your notification device: if you allow notifications, the device token issued by the operating system and whether the device is Android or iOS.',
          'Your sessions: a hashed session token with the times it was created, last used, and expires.',
          'Your activity: the time you last used the app. Management and your colleagues see it on the staff list as “online” or as when you were last active. It is a single timestamp, not a record of what you did.',
        ],
      },
      {
        heading: 'What the app does not collect',
        bullets: [
          'No location data, and no access to your camera, photos, microphone, contacts or files.',
          'No advertising identifier and no advertising SDK. Nothing here is sold, and nothing is shared for advertising.',
          'No analytics or tracking SDK of any kind. Your IP address and device fingerprint are not recorded alongside your session.',
        ],
      },
      {
        heading: 'Why it is stored',
        bullets: [
          'To run the task board and show each person the work for their branch.',
          'To notify you when someone assigns you a task.',
          'To answer your questions from the company’s own documents.',
          'To keep you signed in, and to let management create and manage staff accounts.',
        ],
      },
      {
        heading: 'Who else processes it',
        paragraphs: [
          'The app relies on a small number of service providers. They act on our instructions and none of them receive your data for their own advertising.',
        ],
        bullets: [
          'Our application host and database provider, which run the server and store everything described above.',
          'Our web host, which serves the browser version of the app.',
          'Google: Drive holds the company documents the assistant reads, and Firebase Cloud Messaging delivers notifications to your device.',
          'Our AI provider, OpenRouter, which passes an assistant question and the relevant excerpts of company documents to the language model that answers it. The text of your question leaves our servers for this purpose.',
          'Our email provider, which delivers invitations and password-reset messages.',
        ],
      },
      {
        heading: 'Where it is kept',
        paragraphs: ['Application data is stored on servers in the European Union.'],
      },
      {
        heading: 'How long it is kept',
        bullets: [
          'Account and work data stay for as long as the account exists. Deleting an account also deletes its task assignments and its registered notification devices.',
          'Sessions expire on their own, and signing out deletes the session immediately.',
          'Assistant threads stay until they are deleted.',
        ],
      },
      {
        heading: 'How it is protected',
        bullets: [
          'All traffic is encrypted with HTTPS.',
          'Passwords are hashed with Argon2, and session, invitation and reset tokens are stored only as hashes, so a copy of the database yields no usable login.',
          'On Android, system backup is switched off for this app, so a signed-in session is never carried into a cloud backup or onto another device.',
        ],
      },
      {
        heading: 'Your rights',
        paragraphs: [
          `You can ask for a copy of your data, ask for it to be corrected, or ask for it to be deleted, by writing to ${policyContact.en.email}. Under Israel’s Protection of Privacy Law you have the right to inspect and correct your data. Where the GDPR applies you also have the right to object to processing, to ask for it to be restricted, and to complain to a supervisory authority.`,
        ],
      },
      {
        heading: 'Deleting your account',
        paragraphs: [
          'Accounts are opened and closed by management, so yours is normally closed for you when you stop working here. You can also ask for it to be deleted yourself, at any time and without giving a reason.',
        ],
        link: { href: '/delete-account', label: 'How to delete your account' },
      },
      {
        heading: 'Children',
        paragraphs: ['The app is for employees of the business and is not directed at children.'],
      },
      {
        heading: 'Changes to this policy',
        paragraphs: [
          'If this policy changes, the date at the top of the page changes with it. A material change will also be announced inside the app.',
        ],
      },
    ],
  },
  he: {
    title: 'מדיניות פרטיות',
    lastUpdated: 'עודכן לאחרונה: 30 באוגוסט 2026',
    intro:
      'האפליקציה של צוות ברגרס בר היא כלי פנימי לעובדי הרשת. החשבונות נפתחים על ידי ההנהלה והאפליקציה אינה פתוחה לציבור. מדיניות זו מסבירה איזה מידע נשמר עליך, לשם מה הוא נשמר, ומי עוד רואה אותו.',
    sections: [
      {
        heading: 'מי אחראי למידע',
        paragraphs: [
          `המידע המתואר כאן מוחזק על ידי ${policyContact.he.name}, שהוא הקובע כיצד ייעשה בו שימוש. שאלות, תיקונים ובקשות למחיקה יש להפנות אל ${policyContact.he.email}.`,
        ],
      },
      {
        heading: 'איזה מידע נשמר',
        bullets: [
          'פרטי החשבון: שם, דוא"ל בעבודה, תפקיד, סניף ושפת ממשק. הסיסמה נשמרת רק כגיבוב Argon2 ולעולם לא כטקסט קריא.',
          'העבודה שלך: משימות שיצרת או שהוקצו לך, התיאורים שלהן, תאריכי יעד, שינויי סטטוס ומועדי השלמה.',
          'השיחות שלך עם העוזר: השאלות שהקלדת והתשובות שהתקבלו, כדי שניתן יהיה לפתוח שיחה מחדש בהמשך.',
          'המכשיר לקבלת התראות: אם אישרת התראות, מזהה המכשיר שהנפיקה מערכת ההפעלה והאם מדובר במכשיר אנדרואיד או iOS.',
          'ההתחברויות שלך: אסימון התחברות מגובב, יחד עם מועדי היצירה, השימוש האחרון והתפוגה שלו.',
          'הפעילות שלך: המועד שבו השתמשת באפליקציה לאחרונה. ההנהלה והעמיתים שלך רואים אותו ברשימת הצוות כ״מחובר״ או כמועד הפעילות האחרונה. מדובר בחותמת זמן אחת בלבד, ולא ברישום של מה שעשית.',
        ],
      },
      {
        heading: 'איזה מידע אינו נאסף',
        bullets: [
          'אין איסוף מיקום, ואין גישה למצלמה, לתמונות, למיקרופון, לאנשי הקשר או לקבצים שלך.',
          'אין מזהה פרסומי ואין ערכות פיתוח פרסומיות. המידע אינו נמכר ואינו משותף לצורכי פרסום.',
          'אין כלי אנליטיקה או מעקב מכל סוג. כתובת ה‑IP שלך וטביעת האצבע של המכשיר אינן נרשמות לצד ההתחברות.',
        ],
      },
      {
        heading: 'לשם מה המידע נשמר',
        bullets: [
          'להפעלת לוח המשימות ולהצגת העבודה של כל אדם בסניף שלו.',
          'כדי להודיע לך כשמישהו מקצה לך משימה.',
          'כדי לענות על שאלותיך מתוך המסמכים של החברה עצמה.',
          'כדי לשמור אותך מחובר, וכדי לאפשר להנהלה לפתוח ולנהל חשבונות עובדים.',
        ],
      },
      {
        heading: 'מי עוד מעבד את המידע',
        paragraphs: [
          'האפליקציה נשענת על מספר מצומצם של ספקי שירות. הם פועלים לפי הוראותינו, ואף אחד מהם אינו מקבל את המידע שלך לצורכי פרסום משלו.',
        ],
        bullets: [
          'ספק האירוח ומסד הנתונים שלנו, שמריצים את השרת ושומרים את כל המתואר למעלה.',
          'ספק אירוח האתר, שמגיש את גרסת הדפדפן של האפליקציה.',
          'גוגל: שירות Drive מחזיק את מסמכי החברה שהעוזר קורא, ושירות Firebase Cloud Messaging מעביר את ההתראות למכשיר שלך.',
          'ספק הבינה המלאכותית שלנו, OpenRouter, שמעביר את שאלתך ואת הקטעים הרלוונטיים ממסמכי החברה אל מודל השפה שמנסח את התשובה. לצורך זה נוסח השאלה שלך יוצא מהשרתים שלנו.',
          'ספק הדואר האלקטרוני שלנו, שמעביר הזמנות והודעות לאיפוס סיסמה.',
        ],
      },
      {
        heading: 'היכן המידע נשמר',
        paragraphs: ['מידע האפליקציה נשמר על שרתים באיחוד האירופי.'],
      },
      {
        heading: 'כמה זמן המידע נשמר',
        bullets: [
          'פרטי החשבון והעבודה נשמרים כל עוד החשבון קיים. מחיקת חשבון מוחקת עמו גם את הקצאות המשימות ואת המכשירים הרשומים לקבלת התראות.',
          'ההתחברויות פגות מעצמן, והתנתקות מוחקת את ההתחברות מיד.',
          'שיחות העוזר נשמרות עד שמוחקים אותן.',
        ],
      },
      {
        heading: 'כיצד המידע מוגן',
        bullets: [
          'כל התעבורה מוצפנת ב‑HTTPS.',
          'הסיסמאות מגובבות ב‑Argon2, ואסימוני ההתחברות, ההזמנה והאיפוס נשמרים כגיבוב בלבד, כך שעותק של מסד הנתונים אינו מספק אפשרות התחברות.',
          'באנדרואיד הגיבוי המערכתי מבוטל עבור האפליקציה, כך שהתחברות פעילה לעולם אינה עוברת לגיבוי בענן או למכשיר אחר.',
        ],
      },
      {
        heading: 'הזכויות שלך',
        paragraphs: [
          `באפשרותך לבקש עותק של המידע שלך, לבקש את תיקונו או לבקש את מחיקתו, בפנייה אל ${policyContact.he.email}. על פי חוק הגנת הפרטיות בישראל עומדת לך הזכות לעיין במידע ולתקנו. במקומות שבהם חלה תקנת ה‑GDPR עומדות לך גם הזכות להתנגד לעיבוד, לבקש את הגבלתו ולהגיש תלונה לרשות פיקוח.`,
        ],
      },
      {
        heading: 'מחיקת החשבון שלך',
        paragraphs: [
          'החשבונות נפתחים ונסגרים על ידי ההנהלה, ולכן החשבון שלך נסגר עבורך כשאתה מפסיק לעבוד כאן. באפשרותך גם לבקש את מחיקתו בעצמך, בכל עת וללא צורך בנימוק.',
        ],
        link: { href: '/delete-account', label: 'כיצד מוחקים את החשבון' },
      },
      {
        heading: 'קטינים',
        paragraphs: ['האפליקציה מיועדת לעובדי העסק ואינה מכוונת לילדים.'],
      },
      {
        heading: 'שינויים במדיניות',
        paragraphs: [
          'אם המדיניות תשתנה, התאריך שבראש העמוד ישתנה עמה. שינוי מהותי יוכרז גם בתוך האפליקציה.',
        ],
      },
    ],
  },
}
