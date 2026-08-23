// The rectangle a floating panel is actually allowed to occupy: the nearest ancestor that
// scrolls or hides its overflow, narrowed by the viewport.
//
// Every popover in this app needs it for the same reason. A menu or a date panel is positioned
// against the control that opened it, but what CLIPS it is whichever ancestor stopped being
// `overflow: visible` — the shell's content region on both shells, the task dialog's own card,
// a lane that scrolls. Measured against the window instead, a panel is pushed back from an edge
// it was never going to reach and cut off at the one it was.
export function clipBounds(from: HTMLElement) {
  let node = from.parentElement
  let rect: DOMRect | undefined
  while (node && !rect) {
    const { overflowX, overflowY } = getComputedStyle(node)
    if (overflowX !== 'visible' || overflowY !== 'visible') rect = node.getBoundingClientRect()
    node = node.parentElement
  }
  return {
    left: Math.max(0, rect?.left ?? 0),
    right: Math.min(window.innerWidth, rect?.right ?? window.innerWidth),
    top: Math.max(0, rect?.top ?? 0),
    bottom: Math.min(window.innerHeight, rect?.bottom ?? window.innerHeight),
  }
}

// How close to an edge a panel may come before it is pushed back in.
export const CLIP_GUTTER = 8
