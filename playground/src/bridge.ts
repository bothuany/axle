// What the pages inside the workbench (the canvas and the code editor run in iframes) may ask of it. They are same-origin pages of
// this site, so the workbench hands them one small object on its window instead of a message protocol for each question.
export interface WorkbenchBridge {
  /** The agent's change is in the files (the code the canvas and the editors show is the changed code). */
  edited(): boolean
  /** The change was kept: the canvas stops marking it. */
  kept(): boolean
  keep(): void
  /** Put the files back the way they were before the change. */
  undo(): void
}

declare global {
  interface Window {
    __axle?: WorkbenchBridge
  }
}

/** The workbench around this page, or nothing when the page runs alone (a developer opening canvas.html directly). */
export function workbench(): WorkbenchBridge | undefined {
  try {
    return window.parent !== window ? window.parent.__axle : undefined
  } catch {
    return undefined
  }
}
