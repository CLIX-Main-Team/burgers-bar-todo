import type { AppLocale } from '../i18n/messages.js'
import { policyContact } from './privacy-content.js'
import type { PolicyDocument } from './privacy-content.js'

// The public account-deletion page Google Play's data-deletion policy requires of any app
// with accounts (support.google.com/googleplay/android-developer/answer/13327111). Play checks
// three things and this page is shaped around them: it loads without a login, the way to ask
// is the first thing on it, and it names the app as the listing does — "Burger's Bar Staff",
// see docs/mobile/store-listing.md. The URL entered in the Data safety form is this route.
//
// What it promises is what the system can actually do. There is no self-service delete: the
// API only ever deactivates a user (auth.ts, "the record is retained ... so historical
// assignment stays readable"), and tasks.created_by / projects.created_by have no cascade, so
// removing a person's row means their authored work is transferred first. That is an operator
// doing it by hand on request, which is exactly what Play accepts ("a customer service email
// or a form they can submit a request through") — so the page describes that and nothing more.
//
// Apple's 5.1.1(v) asks for deletion to be startable inside the app. It is written for apps
// where the user signs themselves up; here management opens every account and there is no
// public sign-up, which is the basis for not shipping an in-app delete button. If review
// pushes back, the answer is a screen that posts this same request.
//
// The contact address is the SAME placeholder the privacy policy carries and has to be filled
// in with the client's real mailbox before either listing is submitted.
export const deleteAccountPolicy: Record<AppLocale, PolicyDocument> = {
  en: {
    title: 'Deleting your account',
    lastUpdated: 'Last updated: 30 August 2026',
    intro:
      'Burger’s Bar Staff is an internal app for people who work at Burger’s Bar. Accounts are opened by management, and this page explains how to have yours and the data attached to it deleted.',
    sections: [
      {
        heading: 'How to ask',
        paragraphs: [
          `Write to ${policyContact.en.email} from the work address your account uses, and say that you are asking for your Burger’s Bar Staff account to be deleted. You do not have to give a reason. If you no longer have access to that mailbox, ask your branch manager to send the request on your behalf so we can confirm it is really you.`,
        ],
      },
      {
        heading: 'What is deleted',
        bullets: [
          'Your account itself: name, work email, role, branch, interface language and the stored hash of your password.',
          'Your sign-ins: every session token, so the account cannot be used again.',
          'Your device registrations for notifications, and with them any further notification.',
          'Your assistant conversations, both the questions you asked and the answers you were given.',
          'Your assignments: your name comes off every task and every checklist step it is on.',
          'The timestamp of when you last used the app.',
        ],
      },
      {
        heading: 'What is kept, and why',
        bullets: [
          'The work itself. Tasks, projects and checklists belong to the branch rather than to a person, so they stay and a manager takes over anything you created. Your name is removed from them.',
          'Records the business has to keep by law, such as employment and payroll records. Those live outside this app and are not affected by deleting your account here.',
        ],
      },
      {
        heading: 'How long it takes',
        paragraphs: [
          'A request is acknowledged within a few working days and completed within 30 days at the latest. Once it is done, the account is gone and cannot be restored.',
        ],
      },
      {
        heading: 'The rest of the policy',
        paragraphs: [
          'What the app stores while your account exists, and who else processes it, is set out in full in the privacy policy.',
        ],
        link: { href: '/privacy', label: 'Privacy policy' },
      },
    ],
  },
  he: {
    title: 'מחיקת החשבון שלך',
    lastUpdated: 'עודכן לאחרונה: 30 באוגוסט 2026',
    intro:
      'האפליקציה של צוות ברגרס בר היא כלי פנימי לעובדי הרשת. החשבונות נפתחים על ידי ההנהלה, ועמוד זה מסביר כיצד למחוק את החשבון שלך ואת המידע הקשור אליו.',
    sections: [
      {
        heading: 'כיצד מבקשים',
        paragraphs: [
          `שלחו הודעה אל ${policyContact.he.email} מכתובת הדוא"ל בעבודה שרשומה בחשבון, וציינו שאתם מבקשים למחוק את חשבונכם באפליקציה של צוות ברגרס בר. אין צורך לנמק. אם אין לכם עוד גישה לתיבה הזו, בקשו ממנהל הסניף להעביר את הבקשה עבורכם, כדי שנוכל לוודא שאכן מדובר בכם.`,
        ],
      },
      {
        heading: 'מה נמחק',
        bullets: [
          'החשבון עצמו: שם, דוא"ל בעבודה, תפקיד, סניף, שפת ממשק והגיבוב השמור של הסיסמה.',
          'ההתחברויות שלך: כל אסימוני ההתחברות, כך שלא ניתן להשתמש בחשבון שוב.',
          'רישומי המכשירים שלך לקבלת התראות, ועמם כל התראה נוספת.',
          'השיחות שלך עם העוזר, גם השאלות ששאלת וגם התשובות שקיבלת.',
          'ההקצאות שלך: שמך יורד מכל משימה ומכל שלב ברשימת המשימות שהיה מוקצה לך.',
          'חותמת הזמן של השימוש האחרון שלך באפליקציה.',
        ],
      },
      {
        heading: 'מה נשמר, ומדוע',
        bullets: [
          'העבודה עצמה. משימות, פרויקטים ורשימות משימות שייכים לסניף ולא לאדם, ולכן הם נשארים ומנהל נכנס במקומך לכל מה שיצרת. שמך מוסר מהם.',
          'רישומים שהעסק מחויב לשמור על פי חוק, כגון רישומי העסקה ושכר. אלה מתנהלים מחוץ לאפליקציה הזו ומחיקת החשבון כאן אינה נוגעת בהם.',
        ],
      },
      {
        heading: 'כמה זמן זה לוקח',
        paragraphs: [
          'הבקשה מאושרת בתוך מספר ימי עבודה ומבוצעת בתוך 30 יום לכל היותר. לאחר הביצוע החשבון נמחק ולא ניתן לשחזרו.',
        ],
      },
      {
        heading: 'שאר המדיניות',
        paragraphs: [
          'איזה מידע נשמר כל עוד החשבון קיים, ומי עוד מעבד אותו, מפורט במלואו במדיניות הפרטיות.',
        ],
        link: { href: '/privacy', label: 'מדיניות פרטיות' },
      },
    ],
  },
}
