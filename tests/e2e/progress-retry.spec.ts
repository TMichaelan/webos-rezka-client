import { test, expect } from '@playwright/test'

const backend = 'http://127.0.0.1:5174'

test('retrying episode sync cannot replace a newer pending local position', async ({ page, request }) => {
  await request.post(backend + '/api/test/reset')
  let release!: () => void
  let markStarted!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { markStarted = resolve })
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method === 'saveProgress' && params.position === 50) {
      const response = await route.fetch()
      markStarted(); await gate
      await route.fulfill({ response })
    } else await route.continue()
  })
  await page.goto('/')
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
  await page.locator('[data-nav-id="nav-home"]').click()
  await page.locator('[data-nav-id="continue-100"]').click()
  await page.locator('[data-nav-id="detail-play"]').click()
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click()
  await expect.poll(() => page.locator('video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2)

  await request.post(backend + '/api/test/fail-episode-sync')
  await page.locator('video').evaluate(video => { video.currentTime = 30; video.pause() })
  const retry = page.locator('.player').getByRole('button', { name: 'Повторить передачу серии', exact: true })
  await expect(retry).toBeVisible()
  await expect.poll(async () => (await (await request.get(backend + '/api/test/state')).json()).progress['100'].position).toBe(30)

  await request.post(backend + '/api/test/fail-episode-sync?value=false')
  await page.locator('video').evaluate(async video => { await video.play(); video.currentTime = 50; video.pause() })
  await started
  await page.locator('video').evaluate(async video => { await video.play(); video.currentTime = 70; video.pause() })
  // Native click respects disabled buttons, while exercising the handler if it is enabled.
  await retry.evaluate(button => button.click())
  release()

  await expect.poll(async () => (await (await request.get(backend + '/api/test/state')).json()).progress['100'].position).toBe(70)
  await expect(retry).toHaveCount(0)
  const state = await (await request.get(backend + '/api/test/state')).json()
  expect(state.saves.map((save: { position: number }) => save.position)).toEqual([30, 50, 70])
  expect(state.progress['100'].position).toBe(70)
})
