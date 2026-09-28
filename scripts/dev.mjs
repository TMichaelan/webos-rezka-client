import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const fixture = process.argv.includes('--fixture')
if (fixture && !existsSync(new URL('../.state/test-video.mp4', import.meta.url))) {
  mkdirSync(new URL('../.state', import.meta.url), { recursive: true })
  const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=12', '-t', '120', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '.state/test-video.mp4'], { cwd: root, stdio: 'inherit' })
  const result = await new Promise(resolve => ffmpeg.once('exit', resolve))
  if (result !== 0) throw new Error('Install ffmpeg to generate the local test video.')
}
const env = { ...process.env, REZKA_FIXTURE: fixture ? '1' : '0', VITE_FIXTURE: fixture ? '1' : '0' }
const children = [spawn(process.execPath, ['scripts/dev-service.cjs'], { cwd: root, env, stdio: 'inherit' }), spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { cwd: root, env, stdio: 'inherit' })]
let stopping = false
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop())
for (const child of children) { child.on('error', () => stop(1)); child.on('exit', code => stop(code || 0)) }
