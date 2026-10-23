// Delivers one rendered episode: the render (its picture untouched, its sound at the loudness below), a phone copy (H.264 High, yuv420p, 30 fps, AAC 48 kHz, faststart, loudness
// normalized to -15 LUFS with true peak under -1.5 dBFS, two-pass) and a contact sheet, then measures the copy.
//   node tools/deliver.mjs <render.mp4> <out dir> <name>      writes <name>.mp4, <name>-phone.mp4, <name>-contact-sheet.jpg
import { mkdirSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const [src, out, name] = process.argv.slice(2)
if (!name) throw new Error('usage: node tools/deliver.mjs <render.mp4> <out dir> <name>')
mkdirSync(out, { recursive: true })
const run = (cmd, a) => {
	const r = spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 26 })
	if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr.slice(-800)}`)
	return r.stdout + r.stderr
}
const full = join(out, `${name}.mp4`)
const phone = join(out, `${name}-phone.mp4`)

// Loudness, pass one: measure.
const LN = 'loudnorm=I=-15:TP=-1.5:LRA=11'
const m = JSON.parse(run('ffmpeg', ['-hide_banner', '-i', src, '-af', `${LN}:print_format=json`, '-f', 'null', '-']).match(/\{[^{}]*"input_i"[^{}]*\}/)[0])
const pass2 = `${LN}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`
// The delivered file keeps the rendered picture as it is and gets the same loudness as the phone copy.
run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:v', 'copy', '-af', pass2, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', full])
run('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-af', pass2, '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', phone])

// Measure the copy: loudness, true peak, the stream, and that moov comes before mdat.
const eb = run('ffmpeg', ['-hide_banner', '-nostats', '-i', phone, '-af', 'ebur128=peak=true', '-f', 'null', '-'])
const I = eb.match(/I:\s+(-?[\d.]+) LUFS/g).at(-1), TP = eb.match(/Peak:\s+(-?[\d.]+) dBFS/g).at(-1)
const probe = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,profile,pix_fmt,width,height,r_frame_rate,sample_rate:format=duration', '-of', 'compact', phone])
const fd = openSync(phone, 'r'), head = Buffer.alloc(1 << 16)
readSync(fd, head, 0, head.length, 0)
closeSync(fd)
const moov = head.indexOf('moov'), mdat = head.indexOf('mdat')
console.log(probe.trim())
console.log('integrated', I, '| true peak', TP, '| faststart', moov >= 0 && (mdat < 0 || moov < mdat))

// Contact sheet: one frame every 2.5 s, 6 across.
const sheet = join(out, `${name}-contact-sheet.jpg`)
run('ffmpeg', ['-y', '-loglevel', 'error', '-i', phone, '-vf', 'fps=0.4,scale=270:-1,tile=6x3:padding=6:color=0x0c1020', '-frames:v', '1', '-q:v', '3', sheet])
console.log('wrote', full, phone, sheet)
