import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const dimensions = path => {
  const png = readFileSync(new URL(path, root))
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${path} must be PNG`)
  assert.equal(png.toString('ascii', 12, 16), 'IHDR')
  assert.equal(png[25], 2, `${path} must use opaque RGB`)
  return [png.readUInt32BE(16), png.readUInt32BE(20)]
}

for (const [path, size] of [
  ['webos/icon.png', [80, 80]],
  ['webos/large-icon.png', [130, 130]],
  ['webos/splash-background.png', [1920, 1080]]
]) {
  test(`${path} has the required webOS export dimensions`, () => {
    assert.deepEqual(dimensions(path), size)
  })
}

test('webOS loads separate launcher icons and the branded splash', () => {
  const info = JSON.parse(readFileSync(new URL('webos/appinfo.json', root), 'utf8'))
  assert.equal(info.icon, 'icon.png')
  assert.equal(info.largeIcon, 'large-icon.png')
  assert.equal(info.splashBackground, 'splash-background.png')
  assert.equal(info.iconColor, '#101116')
  assert.equal(info.id, 'io.github.tmichaelan.app.rezkaclient')
  assert.equal(info.inspectable, false)
})
