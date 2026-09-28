import { access, cp, mkdir, rm, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('..', import.meta.url))
const stage = path.join(root, 'build', 'package')
await rm(stage, { recursive: true, force: true })
await mkdir(stage, { recursive: true })
await mkdir(path.join(root, 'artifacts'), { recursive: true })
await cp(path.join(root, 'dist'), path.join(stage, 'app'), { recursive: true })
for (const name of ['appinfo.json', 'icon.png', 'large-icon.png', 'splash-background.png']) await cp(path.join(root, 'webos', name), path.join(stage, 'app', name))
await cp(path.join(root, 'webos', 'licenses'), path.join(stage, 'app', 'licenses'), { recursive: true, filter: source => !path.extname(source) || path.extname(source) === '.txt' })
await mkdir(path.join(stage, 'service'), { recursive: true })
for (const name of ['dispatch.cjs', 'package-lock.json', 'package.json', 'parsers.cjs', 'progress.cjs', 'provider.cjs', 'service.js', 'services.json', 'transport.cjs']) await cp(path.join(root, 'service', name), path.join(stage, 'service', name))
await cp(path.join(root, 'service', 'node_modules'), path.join(stage, 'service', 'node_modules'), { recursive: true, filter: source => !source.split(path.sep).includes('.bin') })
const html = await readFile(path.join(stage, 'app', 'index.html'), 'utf8')
if (/type="module"|crossorigin|src="\//.test(html)) throw new Error('Package contains file://-incompatible entry URLs or module script.')
const app = JSON.parse(await readFile(path.join(stage, 'app', 'appinfo.json'), 'utf8'))
const output = path.join(root, 'artifacts', `${app.id}_${app.version}_all.ipk`)
const args = ['exec', '--yes', '--package=@webos-tools/cli@3.2.6', '--', 'ares-package', path.join(stage, 'app'), path.join(stage, 'service'), '--outdir', path.join(root, 'artifacts')]
const hook = `--require=${path.join(root, 'scripts', 'portable-tar.cjs')}`
const child = spawn('npm', args, { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, hook].filter(Boolean).join(' ') } })
const code = await new Promise(resolve => child.once('exit', resolve))
if (code !== 0) process.exit(Number(code) || 1)
await access(output)
console.log('IPK:', output)
