/// <reference types="@testing-library/jest-dom" />

// Loads jest-dom's type augmentation so its DOM matchers (toHaveAttribute, toHaveClass, …)
// are typed on Vitest's `expect`. Type-only: no runtime effect — the matchers are extended
// onto expect at runtime in vitest.setup.ts. Included via tsconfig's `src` glob.
export {}
