// Where each voice line starts in the film (seconds), shared by build.mjs (picture, captions) and mix.mjs (sound).
// The picture is cut to fixed bar lines (120 BPM, 2 s bars, STORYBOARD.md), and every line sits inside its beat; word
// times come from the transcript of each generated line (<shots>/vo/<id>.words.json).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const VO = { '01': 0.5, '02': 5.3, '03': 11.3, '04': 17.3, '05a': 22.3, '05b': 26.3, '06': 34.3, '07': 42.3, '08': 48.5, '09': 55.2 }

export const timing = shots => {
	const words = id => JSON.parse(readFileSync(join(shots, 'vo', `${id}.words.json`), 'utf8'))
	const at = (id, word) => VO[id] + words(id).find(w => w.text.toLowerCase().startsWith(word.toLowerCase())).start
	const voEnd = id => VO[id] + words(id).at(-1).end
	return { words, at, voEnd }
}

// Music runs with the film from 0 (tools/score.py) and fades out at the end.
export const MUSIC = { in: 0, end: 62 }

// Sound effects, each tied to a change on screen: a tick per side bar switch, a whoosh as a tab opens, a pulse per
// cross-service ring, a chime when the dock's row needs you, one low hit with the logo.
export const sfx = ({ at }) => [
	['tick', 5.0, 0.5], ['tick', 7.6, 0.4], ['tick', 9.4, 0.4],
	['tick', 11.4, 0.4], ['whoosh', 12.6, 0.35],
	['pulse', at('04', 'HTTP'), 0.7], ['pulse', at('04', 'Kafka'), 0.7],
	['tick', 25.4, 0.4], ['whoosh', 26.3, 0.35],
	['chime', 35.2, 0.5],
	['tick', 42.0, 0.4],
	['hit', 54.0, 0.8],
]
