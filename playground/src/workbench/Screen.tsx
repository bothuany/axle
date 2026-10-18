// The "screen" of the demo: a Mac's menu bar with the camera notch, the Axle window under it, and the desktop status overlay that
// hangs from the notch while agents run (Axle's optional overlay, drawn by the page the real app uses).
import { Island } from './pages'
import { Window } from './Window'

const MENUS = ['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Window', 'Help']

function MenuBar() {
  const time = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(2026, 0, 15, 10, 41))
  return (
    <div className="menubar" aria-hidden="true">
      <b>Axle</b>
      {MENUS.map(m => (
        <span key={m}>{m}</span>
      ))}
      <div className="right">
        <svg className="m" viewBox="0 0 24 24"><path d="M2 8.800a15 15 0 0 1 20 0M5.500 12.400a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0" /><circle cx="12" cy="19.500" r=".8" fill="#f2f2f2" /></svg>
        <svg className="m" viewBox="0 0 24 24"><rect x="2" y="7" width="18" height="10" rx="2.500" /><path d="M22 10.500v3" /><rect x="4" y="9" width="10" height="6" rx="1" fill="#f2f2f2" /></svg>
        <span style={{ padding: 0 }}>{time}</span>
      </div>
    </div>
  )
}

export function Screen() {
  return (
    <div className="screen" id="screen">
      <MenuBar />
      <div className="notch" aria-hidden="true" />
      <Island />
      <Window />
    </div>
  )
}

