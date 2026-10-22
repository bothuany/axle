// Where each voice line starts in the film (seconds), shared by build.mjs (picture, captions) and mix.mjs (sound).
// Every line sits inside its beat (STORYBOARD.md); word times come from the transcript of each generated line.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const VO = { '01a': 0.6, '01b': 4.3, '02': 6.6, '03': 12.6, '04': 22.4, '05': 30.6, '06a': 40.6, '06c': 47.3, '06b': 50.4, '07': 54.6, '08': 62.3, '09': 68.8, '10': 74.2 }

export const timing = shots => {
	const words = id => JSON.parse(readFileSync(join(shots, 'vo', `${id}.words.json`), 'utf8'))
	const at = (id, word) => VO[id] + words(id).find(w => w.text.toLowerCase().startsWith(word.toLowerCase())).start
	const voEnd = id => VO[id] + words(id).at(-1).end
	return { words, at, voEnd }
}

// Music: silent under the hook, in on the downbeat of the turn, down to nothing under the held frame's line.
export const MUSIC = { in: 12.0, heldFrom: 68.0, heldTo: 72.0, end: 80 }

// Sound effects, each tied to a change on screen.
export const sfx = ({ at }) => [
	['tick', 0.15, 0.6], ['chime', 1.2, 0.5],
	...Array.from({ length: 15 }, (_, i) => ['tick', 6.15 + i * 0.22, 0.35]),
	['whoosh', 11.7, 0.6],
	['tick', 13.4, 0.6], ['tick', 15.0, 0.6],
	['pulse', at('04', 'HTTP'), 0.8], ['pulse', at('04', 'Kafka') + 0.3, 0.8], ['pulse', at('04', 'table') + 0.1, 0.8],
	['whoosh', 29.7, 0.35], ['tick', 33.8, 0.5], ['tick', 37.6, 0.5],
	['chime', at('06a', 'needs'), 0.7],
	// The avatar style switches to pixel pets (dock and island repaint at once).
	['whoosh', 46.85, 0.3], ['tick', 47.9, 0.7], ['tick', 47.98, 0.5],
	['drop', 50.2, 0.8],
	['thump', 54.0, 0.6], ['thump', 62.0, 0.6], ['tick', 64.4, 0.8], ['thump', 66.0, 0.6], ['thump', 68.0, 0.5],
	['hit', 74.0, 0.9],
]
