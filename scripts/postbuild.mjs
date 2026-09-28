import { readFile, writeFile } from 'node:fs/promises'
const path = new URL('../dist/index.html', import.meta.url)
const html = await readFile(path, 'utf8')
// Packaged webOS runs from file://. The single IIFE must load as a classic script.
await writeFile(path, html.replace(/type="module"/g, 'defer').replace(/ crossorigin(?:="[^"]*")?/g, ''))
