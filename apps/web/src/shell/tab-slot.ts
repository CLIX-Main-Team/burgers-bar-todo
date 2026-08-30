// The bottom bar's cell, factored out of bottom-tabs.tsx because two files build one: the bar
// draws the destination slots and the account menu draws the trigger that sits beside them as
// the last slot. Importing these from bottom-tabs.tsx would put a cycle between the two
// modules, since the bar imports the menu.

// A tab is a column, not a row: glyph over label, centred, `flex-1` so the row divides itself
// between however many destinations the signed-in role holds.
// No horizontal padding: the slot is already the narrowest thing in the shell, and the four
// pixels it would cost are four the longest label needs. The glyph and label are centred, so
// the cells stay visually separated without it.
export const TAB_SLOT =
  'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-nav-gold'

// The selection mark. On the rail, "here" is a solid blue pill wrapping the whole row; a
// full-slot fill reads far heavier in a bar, where the slots sit shoulder to shoulder, so the
// pill shrinks to sit behind the glyph alone and the label carries the selected ink under it.
// Same blue, same fill-weight glyph, one third the area.
export const TAB_PILL = 'grid h-7 w-12 flex-none place-items-center rounded-full'

// The caption step, 11.5px. It was 10px while the bar carried six cells, where 61px of label
// clipped a nine-glyph word; at five cells a 360px phone gives each 72px and the type scale
// fits again. Cutting a cell bought back the label size, which is most of why the bar reads
// calmer now and not only shorter.
export const TAB_LABEL = 'max-w-full truncate text-caption font-semibold leading-tight'
