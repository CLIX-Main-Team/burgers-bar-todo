// The shell's single readable content column. Header, content, and tab bar all cap
// their inner width to this and centre it, so the tabs line up under the content on a
// wide screen and everything shares one phone-first, max-width-capped column (PRD,
// stories 8/23). Kept as one constant so the readable width is changed in one place
// rather than edited across every shell surface.
export const CONTENT_COLUMN = 'mx-auto w-full max-w-lg'
