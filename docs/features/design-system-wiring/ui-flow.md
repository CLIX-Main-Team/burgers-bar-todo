# design-system-wiring — UI flow

The user-facing surface of the design-system wiring feature. This is a rule-4 planning artifact;
its spec (PRD input) is docs/design-system/, its build ticket is GitHub issue #101, and it sits
alongside plan.md and test-cases.md. Written text-first per rule 11: this prose is the authority.
No drawn diagram is kept for it; if one is later wanted it is a separate Excalidraw file rendered
from this text.

## Why this document is not "not applicable"

A retheme changes no flow — same screens, same steps, same routes, same fields; only the paint
moves onto tokens. On that basis this document would be recorded as not applicable. It is not,
because this feature makes one behavioural addition with a user-facing surface: the light/dark
theme toggle. Rule 4 requires the flow of that control to be captured. Everything else below is
recorded as retheme, no flow change, so the record is explicit rather than silent.

## No flow change — the rethemed surfaces

The following surfaces are restyled and otherwise behave exactly as their existing flows describe;
those flows are unchanged and are not restated here.

- The four pre-auth screens — login, accept/set-password, reset-request, reset-consume — keep the
  flow in docs/features/auth/ui-flow.md. The visible change: the brand cream canvas and warm ink
  type, the gold primary submit (dark ink on gold), the accent-coloured forgot-password link, and
  48px controls. The language toggle is unchanged in behaviour.
- The people-management surface — the invite form and the user list with its resend/revoke and
  deactivate actions — keeps its flow. The visible change: user-status now reads through the soft
  status variants (invited as warning, active as success, deactivated as neutral), and controls
  adopt the tokens and the 48px height.
- The shell — the header, the two-tab bottom nav, and the account menu — keeps its flow. The
  visible change: branded chrome, and the active tab now carries the accent-foreground label and a
  gold primary dot rather than a slate weight change.

## New control — the theme toggle

What it is. A light/dark switch that changes the app's colour theme. It lives in the account menu
behind the header avatar, beside the existing language toggle, rendered as the same segmented
control pattern: a small two-option control, one option pressed at a time, labelled Light and Dark.

Where it is. The account menu, opened by tapping the header avatar. The menu already carries the
signed-in identity, the language toggle, Manage users (managers and admins), and the logout
actions; the theme toggle is added as a labelled row above the language toggle.

How it behaves.

1. On first ever load, the app is in light theme. There is no detection of the device's system
   theme (a deliberate decision, #68); the app starts light and the user chooses.
2. Tapping Dark stamps the dark theme immediately across the whole app — the current screen and
   every screen after it — with no reload and no navigation. Tapping Light returns to light the same
   way. The pressed option always reflects the theme currently showing.
3. The choice is remembered. It persists across reloads, across sign-out and back in, and across app
   relaunch, until the user changes it again. On a return visit the app opens in the remembered
   theme with no flash of the other theme first.
4. The toggle is reachable and operable the same way in Hebrew and in English; its position mirrors
   with direction like the rest of the menu, and its two options keep their order.

What it does not do. It does not sync across devices (the choice is per device), and it does not
expose a third "system/auto" option — only Light and Dark, matching the class-based-explicit
decision in #68.

## Accessibility

The toggle is a fieldset of two buttons carrying aria-pressed, the same accessible pattern the
language toggle uses; the pressed option is the current theme. Its hit area meets the 44px floor.
Both themes carry the full token palette certified in tokens.md against the contrast bars, so the
app is legible and the focus ring is visible in either theme. This is stated in principles.md and
met by the tokens; this feature adds no new pairing.
