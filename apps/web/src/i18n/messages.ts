// The message catalogue for the pre-auth screens and the in-app touchpoints, in the
// two interface languages (ADR-0005): English (LTR) and Hebrew (RTL). use-intl reads
// one of these two trees by the active locale; the tree shapes must stay identical so
// every key resolves in both languages. This is the SPA's own copy of the pattern
// Clix-CRM's message files establish (engineering-design, internationalization).
//
// The non-enumerating flows deliberately carry a single generic string each
// (login.failed, resetRequest.confirmation): the UI renders exactly that message and
// never branches its wording on the reason (ui-flow, non-enumerating responses).

export const messages = {
  en: {
    common: {
      appName: 'Burgers Bar',
      email: 'Email',
      password: 'Password',
      newPassword: 'New password',
      passwordHint: 'At least {min} characters.',
      submit: 'Submit',
      cancel: 'Cancel',
      close: 'Close',
      working: 'Working…',
      networkError: 'Could not reach the server. Please try again.',
      languageEnglish: 'English',
      languageHebrew: 'עברית',
      language: 'Language',
      theme: 'Theme',
      themeLight: 'Light',
      themeDark: 'Dark',
      tabTasks: 'Tasks',
      tabAssistant: 'Assistant',
      // The role-gated desktop side-nav rows (#209). Named as destinations, not the account
      // menu's "Manage …" actions: the nav promotes People and Locations to peers of Tasks
      // and Assistant, so they carry the screen's own noun.
      navPeople: 'People',
      navLocations: 'Locations',
      primaryNav: 'Primary',
    },
    authFrame: {
      // The warm front-door line on the pre-auth brand panel and mobile cap. The decided
      // pre-auth voice line from issue #119 (warm-plain, written natively per language, not
      // a literal translation — map #116, principle #4), chosen over the prototype's
      // placeholder now that the microcopy decision has landed.
      tagline: 'Your shift starts here.',
    },
    login: {
      title: 'Sign in',
      submit: 'Sign in',
      failed: 'Those credentials did not work. Check your email and password and try again.',
      forgotPassword: 'Forgot your password?',
    },
    accept: {
      title: 'Set your password',
      intro: 'Welcome. Set a password to finish setting up your account.',
      displayName: 'Your name',
      submit: 'Set password and continue',
      badToken:
        'This invite link is no longer valid. Ask the person who invited you to send a fresh link.',
      missingToken: 'This page needs an invite link. Open the link from your invite email.',
    },
    resetRequest: {
      title: 'Reset your password',
      intro: 'Enter your email and we will send a reset link if an account exists.',
      submit: 'Send reset link',
      confirmation: 'If an account exists for that address, a reset link is on its way.',
      backToLogin: 'Back to sign in',
    },
    resetConsume: {
      title: 'Choose a new password',
      submit: 'Set new password',
      success: 'Your password has been reset. Sign in with your new password.',
      badToken:
        'This reset link is no longer valid. Request a new one and we will send a fresh link.',
      requestNew: 'Request a new reset link',
      missingToken: 'This page needs a reset link. Open the link from your reset email.',
    },
    app: {
      account: 'Account',
      signedInAs: 'Signed in as {role}',
      logout: 'Log out',
      logoutAll: 'Log out of all devices',
      logoutAllConfirmTitle: 'Log out of all devices?',
      logoutAllConfirmBody:
        'This ends your session on every device where you are signed in, including this one.',
      manageUsers: 'Manage users',
      manageLocations: 'Manage locations',
    },
    tasks: {
      title: 'Tasks',
      // The board's display states (#213): loading is Skeleton cards, empty invites the first
      // task, error says what to do next without apology (principle 4).
      emptyTitle: 'No tasks yet',
      emptyBody: 'Create the first task for this location.',
      // The employee empty board: warm, and honest that there is nothing to do here — no create
      // call to action, because an employee cannot create tasks (#223, principle 4).
      emptyTitleEmployee: 'No tasks assigned to you',
      emptyBodyEmployee: "All clear — nothing's assigned to you right now.",
      errorTitle: "Couldn't load the board",
      errorBody: 'Check your connection and try again.',
      tryAgain: 'Try again',
      loadingBoard: 'Loading tasks',
      // The priority sort is a per-viewer lens: one control that turns the high→low sort on, and
      // the same control turns it back off to the shared manual order (it never changes anyone
      // else's board or the saved order).
      sortByPriority: 'Sort by priority',
      manualOrder: 'Manual order',
      sortByPriorityOn: 'Sorted by priority (high to low)',
      // The mobile board's segmented status tabs (owner decision 2026-08): the accessible name
      // of the tab group — each tab's own label is its status name and count.
      statusTabs: 'Filter by status',
      // Slice D — the drag-reorder surface (#135). The handle names the task it moves so a
      // screen-reader user knows what they picked up; a failed drag rolls back and says so.
      dragHandle: 'Reorder {title}',
      // The employee grip's label: their drag can only move a task between lanes (a status
      // change), never reorder, so the verb says what the gesture can actually do.
      dragMoveHandle: 'Move {title}',
      reorderFailed: 'Could not save the new order.',
      backlog: 'Backlog',
      assignedTo: 'Assigned to',
      createdBy: 'Created by {name}',
      // The task's branch, shown only on an admin's chain-wide surfaces (card chip + edit sheet
      // line) — a manager or employee only ever sees their own location, so naming it is noise.
      taskLocation: 'Location: {name}',
      // The Tasks-tab badge (#136): the visible count pill carries this as its accessible label,
      // so a screen reader hears what the number means, not a bare digit.
      unseenBadge: '{count} new assignments',
      due: 'Due {date}',
      completed: 'Completed {date}',
      statusNotStarted: 'Not started',
      statusInProgress: 'In progress',
      statusDone: 'Done',
      priorityLow: 'Low',
      priorityNormal: 'Normal',
      priorityHigh: 'High',
      // Slice B — the manager/admin write surface (#133). Only a manager or admin ever sees these;
      // an employee's board carries no write controls (the API refuses them regardless).
      newTask: 'New task',
      createHeading: 'New task',
      editHeading: 'Edit task',
      fieldTitle: 'Title',
      fieldDescription: 'Description',
      fieldPriority: 'Priority',
      fieldStatus: 'Status',
      fieldDueDate: 'Due date',
      fieldAssignees: 'Assignees',
      fieldLocation: 'Location',
      locationPlaceholder: 'Choose a location',
      locationsLoadFailed: 'Could not load locations.',
      assigneesEmpty: 'No one at this location to assign yet.',
      backlogHint: 'Leave everyone unchecked to keep this in the backlog.',
      create: 'Create task',
      save: 'Save changes',
      edit: 'Edit',
      delete: 'Delete',
      confirmDelete: 'Delete this task?',
      // The card's overflow menu (#213): the accessible name of a card's actions button, and
      // the "Move to…" group that changes status — drag's keyboard-and-touch equivalent.
      taskActions: 'Actions for {title}',
      moveTo: 'Move to',
      // The employee StatusControl pill (#223): the accessible name of the status menu it opens,
      // naming which task's status changes (the pill's visible status label names the trigger).
      changeStatus: 'Change status for {title}',
      // Slice C — the status write, reached through the overflow "Move to…" for a manager (#134,
      // #213) and the StatusControl pill for an employee (#223).
      statusFailed: 'That status could not be saved. Try again.',
      writeForbidden: 'You are not allowed to make that change.',
      writeFailed: 'That change could not be saved. Check the details and try again.',
      deleteFailed: 'That task could not be deleted. Refresh and try again.',
      // The content-header's desktop-only board search (#215): a per-viewer client filter over
      // the loaded titles, with a warm line when a search matches nothing on a non-empty board.
      searchPlaceholder: 'Search tasks',
      searchNoMatches: 'No tasks match your search.',
    },
    // The assistant conversation surface (#93). Only the app's own chrome lives here — a
    // question, a reply, and the free text the staff member types are never catalogued (they
    // are user content, shown verbatim in whatever language they were written).
    assistant: {
      title: 'Assistant',
      // The first-run state before the first question is asked: a warm heading over the invitation.
      emptyTitle: 'How can I help?',
      empty: 'Ask about an opening routine, a policy, or how something is done.',
      // The composer: the field's placeholder, its accessible label, and the send action.
      placeholder: 'Ask the assistant…',
      inputLabel: 'Your question',
      send: 'Send',
      // The transient "the model is answering" indicator (ADR-0003: one synchronous call).
      thinking: 'Finding an answer…',
      // A failed answer is a transient hiccup, not a thread turn: an inline notice and the
      // retry that re-asks the preserved question in place (ADR-0003).
      failed: 'That answer didn’t come through. Try again.',
      retry: 'Try again',
      // Names the conversation region and a reply for assistive tech.
      conversationLabel: 'Conversation with the assistant',
      answerLabel: 'Assistant answer',
      // Names the attribution chip row (#227) — the knowledge docs a grounded answer drew on.
      sourcesLabel: 'Sources',
      // The thread drawer (#94): the trigger's accessible label, the drawer heading, the
      // start-fresh action, the list's accessible label, and its loading / empty / error states.
      openThreads: 'Your conversations',
      threads: 'Conversations',
      newThread: 'New conversation',
      threadsListLabel: 'Your conversations',
      threadsLoading: 'Loading your conversations…',
      threadsEmpty: 'No conversations yet.',
      threadsLoadFailed: 'Your conversations could not be loaded. Try again.',
      closeThreads: 'Close',
      // Deleting a conversation (#257): the row's action menu, its destructive item, the
      // confirmation, and the failure notice. The delete is hard — the history is gone.
      threadActions: 'Actions for {title}',
      deleteThread: 'Delete',
      confirmDeleteThread: 'Delete this conversation?',
      deleteThreadFailed: 'The conversation could not be deleted. Try again.',
      // Example-question chips on an empty thread: a short prompt and three tappable openers,
      // written natively (not literal translations) to orient someone new to the Assistant.
      examplesLabel: 'Try asking',
      example1: 'What is the opening routine?',
      example2: 'How do I handle a customer refund?',
      example3: 'What goes on the closing checklist?',
    },
    invites: {
      heading: 'People',
      createHeading: 'Invite someone',
      displayName: 'Display name',
      role: 'Role',
      location: 'Location',
      locationPlaceholder: 'Choose a location',
      // Decision 7 — the invite empty-state: an Admin with no Location yet is prompted to
      // create one first (L2's /locations screen) rather than shown an empty picker.
      locationEmpty: 'No locations yet. Create one before inviting people to it.',
      locationEmptyLink: 'Create a location',
      locationsLoadFailed: 'Could not load locations.',
      roleAdmin: 'Admin',
      roleManager: 'Manager',
      roleEmployee: 'Employee',
      send: 'Send invite',
      sent: 'Invite sent to {email}.',
      managerFixedRole: 'New people you invite join as Employees at your Location.',
      conflict: 'That email already has an account or a pending invite.',
      invalidRequest: 'Please check the details and try again.',
      forbidden: 'You are not allowed to create that invite.',
    },
    users: {
      heading: 'People',
      email: 'Email',
      name: 'Name',
      role: 'Role',
      status: 'Status',
      actions: 'Actions',
      statusInvited: 'Invited',
      statusActive: 'Active',
      statusDeactivated: 'Deactivated',
      location: 'Location',
      locationChainWide: 'Chain-wide',
      filterLocation: 'Filter by location',
      filterAllLocations: 'All locations',
      resend: 'Resend invite',
      revoke: 'Revoke invite',
      deactivate: 'Deactivate',
      reactivate: 'Reactivate',
      emptyInvited: 'No pending invites.',
      emptyActive: 'No active people.',
      emptyDeactivated: 'No deactivated people.',
      actionFailed: 'That action could not be completed. Refresh and try again.',
      loadFailed: 'Could not load the people list.',
      // The roster's display states (people build, mockup #179), matching the board's set.
      loading: 'Loading people',
      emptyTitle: 'No one here yet',
      emptyBody: 'Invite your first teammate to this location.',
      inviteCta: 'Invite someone',
      errorTitle: "Couldn't load people",
      errorBody: 'Check your connection and try again.',
      tryAgain: 'Try again',
      // The per-row overflow menu and its deactivate confirm. {name} is the person the menu
      // acts on, so a screen-reader user hears whose actions they opened.
      rowMenu: 'Actions for {name}',
      deactivateConfirmTitle: 'Deactivate {name}?',
      deactivateConfirmBody:
        'They lose access immediately. Their account is kept, so you can reactivate them later.',
    },
    locations: {
      heading: 'Locations',
      createHeading: 'Add a location',
      name: 'Location name',
      namePlaceholder: 'e.g. Downtown',
      create: 'Add location',
      created: 'Location "{name}" added.',
      // Same-name branches are legitimate (decision 5), so an exact match is a soft confirm,
      // not a block — the API never rejects a duplicate.
      duplicateConfirm: 'A Location named "{name}" already exists — create anyway?',
      createAnyway: 'Create anyway',
      createFailed: 'That location could not be created. Try again.',
      forbidden: 'You are not allowed to manage locations.',
      listHeading: 'All locations',
      empty: 'No Locations yet — create the first branch.',
      rename: 'Rename',
      save: 'Save',
      renameFailed: 'That location could not be renamed. Try again.',
      loadFailed: 'Could not load the locations list.',
    },
  },
  he: {
    common: {
      appName: 'בורגרס בר',
      email: 'אימייל',
      password: 'סיסמה',
      newPassword: 'סיסמה חדשה',
      passwordHint: 'לפחות {min} תווים.',
      submit: 'שליחה',
      cancel: 'ביטול',
      close: 'סגירה',
      working: 'מעבד…',
      networkError: 'לא ניתן היה להתחבר לשרת. נסו שוב.',
      languageEnglish: 'English',
      languageHebrew: 'עברית',
      language: 'שפה',
      theme: 'ערכת נושא',
      themeLight: 'בהיר',
      themeDark: 'כהה',
      tabTasks: 'משימות',
      tabAssistant: 'עוזר',
      navPeople: 'אנשים',
      navLocations: 'סניפים',
      primaryNav: 'ראשי',
    },
    authFrame: {
      tagline: 'המשמרת מתחילה כאן.',
    },
    login: {
      title: 'כניסה',
      submit: 'כניסה',
      failed: 'הפרטים לא התאימו. בדקו את האימייל והסיסמה ונסו שוב.',
      forgotPassword: 'שכחתם את הסיסמה?',
    },
    accept: {
      title: 'הגדרת סיסמה',
      intro: 'ברוכים הבאים. הגדירו סיסמה כדי לסיים את הקמת החשבון.',
      displayName: 'השם שלכם',
      submit: 'הגדרת סיסמה והמשך',
      badToken: 'קישור ההזמנה כבר אינו תקף. בקשו מהמזמין לשלוח קישור חדש.',
      missingToken: 'לעמוד זה נדרש קישור הזמנה. פתחו את הקישור מאימייל ההזמנה.',
    },
    resetRequest: {
      title: 'איפוס סיסמה',
      intro: 'הזינו את האימייל ונשלח קישור לאיפוס אם קיים חשבון.',
      submit: 'שליחת קישור לאיפוס',
      confirmation: 'אם קיים חשבון עבור כתובת זו, קישור לאיפוס בדרך.',
      backToLogin: 'חזרה לכניסה',
    },
    resetConsume: {
      title: 'בחירת סיסמה חדשה',
      submit: 'הגדרת סיסמה חדשה',
      success: 'הסיסמה אופסה. היכנסו עם הסיסמה החדשה.',
      badToken: 'קישור האיפוס כבר אינו תקף. בקשו קישור חדש ונשלח לכם אחד.',
      requestNew: 'בקשת קישור איפוס חדש',
      missingToken: 'לעמוד זה נדרש קישור איפוס. פתחו את הקישור מאימייל האיפוס.',
    },
    app: {
      account: 'חשבון',
      signedInAs: 'מחוברים כ{role}',
      logout: 'התנתקות',
      logoutAll: 'התנתקות מכל המכשירים',
      logoutAllConfirmTitle: 'להתנתק מכל המכשירים?',
      logoutAllConfirmBody: 'הפעולה תסיים את ההתחברות שלך בכל המכשירים שבהם נכנסת, כולל מכשיר זה.',
      manageUsers: 'ניהול משתמשים',
      manageLocations: 'ניהול סניפים',
    },
    tasks: {
      title: 'משימות',
      // מצבי התצוגה של הלוח (#213): טעינה בשלדי כרטיסים, ריק מזמין למשימה הראשונה, ושגיאה
      // שאומרת מה לעשות הלאה בלי התנצלות (עיקרון 4).
      emptyTitle: 'אין עדיין משימות',
      emptyBody: 'צרו את המשימה הראשונה של הסניף.',
      // הלוח הריק של העובד: חם, וכן — אין כאן מה לעשות, בלי קריאה לפעולה, כי עובד אינו יכול
      // ליצור משימות (#223, עיקרון 4).
      emptyTitleEmployee: 'לא שובצו לך משימות',
      emptyBodyEmployee: 'הכול נקי — כרגע שום דבר לא משובץ לך.',
      errorTitle: 'טעינת הלוח נכשלה',
      errorBody: 'בדקו את החיבור ונסו שוב.',
      tryAgain: 'ניסיון חוזר',
      loadingBoard: 'טוען משימות',
      sortByPriority: 'מיון לפי עדיפות',
      manualOrder: 'סדר ידני',
      sortByPriorityOn: 'ממוין לפי עדיפות (מהגבוהה לנמוכה)',
      // לשוניות הסטטוס של הלוח בנייד — השם הנגיש של קבוצת הלשוניות.
      statusTabs: 'סינון לפי סטטוס',
      dragHandle: 'שינוי סדר {title}',
      // ידית הגרירה של עובד — הגרירה שלו רק מעבירה בין עמודות (שינוי סטטוס), לא משנה סדר.
      dragMoveHandle: 'העברת {title}',
      reorderFailed: 'לא ניתן היה לשמור את הסדר החדש.',
      backlog: 'ממתין לשיבוץ',
      assignedTo: 'משובץ ל',
      createdBy: 'נוצר על ידי {name}',
      // הסניף של המשימה — מוצג רק למנהל רשת בתצוגה חוצת-סניפים.
      taskLocation: 'סניף: {name}',
      // תג המשימות (#136): התווית הנגישה של מונה השיבוצים החדשים.
      unseenBadge: '{count} שיבוצים חדשים',
      due: 'יעד {date}',
      completed: 'הושלם {date}',
      statusNotStarted: 'טרם התחיל',
      statusInProgress: 'בתהליך',
      statusDone: 'הושלם',
      priorityLow: 'נמוכה',
      priorityNormal: 'רגילה',
      priorityHigh: 'גבוהה',
      // Slice B — משטח הכתיבה של מנהל/מנהל מערכת (#133). רק מנהל או מנהל מערכת רואים אותם.
      newTask: 'משימה חדשה',
      createHeading: 'משימה חדשה',
      editHeading: 'עריכת משימה',
      fieldTitle: 'כותרת',
      fieldDescription: 'תיאור',
      fieldPriority: 'עדיפות',
      fieldStatus: 'סטטוס',
      fieldDueDate: 'תאריך יעד',
      fieldAssignees: 'משובצים',
      fieldLocation: 'סניף',
      locationPlaceholder: 'בחרו סניף',
      locationsLoadFailed: 'לא ניתן היה לטעון את הסניפים.',
      assigneesEmpty: 'אין עדיין מי לשבץ בסניף הזה.',
      backlogHint: 'השאירו את כולם לא מסומנים כדי להשאיר את המשימה בהמתנה לשיבוץ.',
      create: 'יצירת משימה',
      save: 'שמירת שינויים',
      edit: 'עריכה',
      delete: 'מחיקה',
      confirmDelete: 'למחוק את המשימה הזו?',
      // תפריט הפעולות של הכרטיס (#213): השם הנגיש של כפתור הפעולות, וקבוצת "העברה אל" ששנה
      // את הסטטוס — המקבילה במקלדת ובמגע לגרירה.
      taskActions: 'פעולות עבור {title}',
      moveTo: 'העברה אל',
      // כפתור ה-StatusControl של העובד (#223): השם הנגיש של תפריט הסטטוס שהוא פותח, שמציין
      // באיזו משימה משנים את הסטטוס (תווית הסטטוס הגלויה של הכפתור מציינת את המפעיל).
      changeStatus: 'שינוי הסטטוס של {title}',
      // Slice C — כתיבת הסטטוס, שמגיעים אליה דרך "העברה אל" בתפריט אצל מנהל (#134, #213) ודרך
      // כפתור ה-StatusControl אצל עובד (#223).
      statusFailed: 'לא ניתן היה לשמור את הסטטוס. נסו שוב.',
      writeForbidden: 'אינכם רשאים לבצע שינוי זה.',
      writeFailed: 'לא ניתן היה לשמור את השינוי. בדקו את הפרטים ונסו שוב.',
      deleteFailed: 'לא ניתן היה למחוק את המשימה. רעננו ונסו שוב.',
      searchPlaceholder: 'חיפוש משימות',
      searchNoMatches: 'אין משימות שתואמות לחיפוש.',
    },
    assistant: {
      title: 'עוזר',
      emptyTitle: 'איך אפשר לעזור?',
      empty: 'שאלו על נוהל פתיחה, על מדיניות, או איך עושים משהו.',
      placeholder: 'שאלו את העוזר…',
      inputLabel: 'השאלה שלכם',
      send: 'שליחה',
      thinking: 'מחפש תשובה…',
      failed: 'התשובה לא הגיעה. נסו שוב.',
      retry: 'נסו שוב',
      conversationLabel: 'שיחה עם העוזר',
      answerLabel: 'תשובת העוזר',
      sourcesLabel: 'מקורות',
      openThreads: 'השיחות שלכם',
      threads: 'שיחות',
      newThread: 'שיחה חדשה',
      threadsListLabel: 'השיחות שלכם',
      threadsLoading: 'טוען את השיחות שלכם…',
      threadsEmpty: 'אין עדיין שיחות.',
      threadsLoadFailed: 'לא ניתן היה לטעון את השיחות. נסו שוב.',
      closeThreads: 'סגירה',
      threadActions: 'פעולות עבור {title}',
      deleteThread: 'מחיקה',
      confirmDeleteThread: 'למחוק את השיחה?',
      deleteThreadFailed: 'לא ניתן היה למחוק את השיחה. נסו שוב.',
      examplesLabel: 'אפשר לשאול',
      example1: 'מהו נוהל הפתיחה?',
      example2: 'איך מטפלים בהחזר ללקוח?',
      example3: 'מה נכלל ברשימת הסגירה?',
    },
    invites: {
      heading: 'אנשים',
      createHeading: 'הזמנת אדם',
      displayName: 'שם לתצוגה',
      role: 'תפקיד',
      location: 'סניף',
      locationPlaceholder: 'בחרו סניף',
      locationEmpty: 'עדיין אין סניפים. צרו סניף לפני שתזמינו אליו אנשים.',
      locationEmptyLink: 'יצירת סניף',
      locationsLoadFailed: 'לא ניתן היה לטעון את הסניפים.',
      roleAdmin: 'מנהל מערכת',
      roleManager: 'מנהל',
      roleEmployee: 'עובד',
      send: 'שליחת הזמנה',
      sent: 'הזמנה נשלחה אל {email}.',
      managerFixedRole: 'אנשים שתזמינו יצטרפו כעובדים בסניף שלכם.',
      conflict: 'לאימייל הזה כבר קיים חשבון או הזמנה ממתינה.',
      invalidRequest: 'בדקו את הפרטים ונסו שוב.',
      forbidden: 'אינכם רשאים ליצור הזמנה כזו.',
    },
    users: {
      heading: 'אנשים',
      email: 'אימייל',
      name: 'שם',
      role: 'תפקיד',
      status: 'סטטוס',
      actions: 'פעולות',
      statusInvited: 'הוזמן',
      statusActive: 'פעיל',
      statusDeactivated: 'מושבת',
      location: 'סניף',
      locationChainWide: 'כלל הרשת',
      filterLocation: 'סינון לפי סניף',
      filterAllLocations: 'כל הסניפים',
      resend: 'שליחת הזמנה מחדש',
      revoke: 'ביטול הזמנה',
      deactivate: 'השבתה',
      reactivate: 'הפעלה מחדש',
      emptyInvited: 'אין הזמנות ממתינות.',
      emptyActive: 'אין אנשים פעילים.',
      emptyDeactivated: 'אין אנשים מושבתים.',
      actionFailed: 'לא ניתן היה להשלים את הפעולה. רעננו ונסו שוב.',
      loadFailed: 'לא ניתן היה לטעון את רשימת האנשים.',
      loading: 'טוען אנשים',
      emptyTitle: 'עדיין אין כאן אף אחד',
      emptyBody: 'הזמינו את חבר הצוות הראשון לסניף הזה.',
      inviteCta: 'הזמנת אדם',
      errorTitle: 'לא ניתן היה לטעון אנשים',
      errorBody: 'בדקו את החיבור ונסו שוב.',
      tryAgain: 'נסו שוב',
      rowMenu: 'פעולות עבור {name}',
      deactivateConfirmTitle: 'להשבית את {name}?',
      deactivateConfirmBody: 'הגישה תיחסם מיד. החשבון נשמר, כך שתוכלו להפעיל אותו מחדש בהמשך.',
    },
    locations: {
      heading: 'סניפים',
      createHeading: 'הוספת סניף',
      name: 'שם הסניף',
      namePlaceholder: 'לדוגמה, מרכז העיר',
      create: 'הוספת סניף',
      created: 'הסניף "{name}" נוסף.',
      duplicateConfirm: 'כבר קיים סניף בשם "{name}" — ליצור בכל זאת?',
      createAnyway: 'ליצור בכל זאת',
      createFailed: 'לא ניתן היה ליצור את הסניף. נסו שוב.',
      forbidden: 'אינכם רשאים לנהל סניפים.',
      listHeading: 'כל הסניפים',
      empty: 'אין עדיין סניפים — צרו את הסניף הראשון.',
      rename: 'שינוי שם',
      save: 'שמירה',
      renameFailed: 'לא ניתן היה לשנות את שם הסניף. נסו שוב.',
      loadFailed: 'לא ניתן היה לטעון את רשימת הסניפים.',
    },
  },
} as const

export type AppLocale = keyof typeof messages
export type AppMessages = (typeof messages)[AppLocale]
