import { test, expect, type Page } from '@playwright/test'

async function openQualityPopup(page: Page) {
  await page.route('**/api/rpc', async route => {
    if (route.request().postDataJSON().method === 'progress') await route.fulfill({ json: { returnValue: true, result: null } })
    else await route.continue()
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
  await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2)
  await page.locator('.player').getByRole('combobox', { name: 'Качество', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Качество', exact: true })).toBeVisible()
}
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:5174/api/test/reset') })

for (const event of ['loadedmetadata', 'ended']) {
  test(`${event} preserves popup focus and Back closes only the selector`, async ({ page }) => {
    await openQualityPopup(page)
    const popup = page.getByRole('dialog', { name: 'Качество', exact: true })
    await page.locator('video').evaluate(async (element, event) => {
      const video = element as HTMLVideoElement
      if (event === 'loadedmetadata') video.dispatchEvent(new Event(event))
      else video.currentTime = video.duration - 0.1
      await video.play()
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
    }, event)
    if (event === 'ended') await expect.poll(() => page.locator('video').evaluate(v => (v as HTMLVideoElement).ended)).toBe(true)
    await expect.poll(() => popup.evaluate(element => element.contains(document.activeElement)), { timeout: 1500 }).toBe(true)
    if (event === 'ended') await expect(page.getByRole('button', { name: 'Отменить переход', exact: true })).toHaveCount(0)
    await page.evaluate(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 461, bubbles: true, cancelable: true })))
    await expect(popup).toHaveCount(0)
    await expect(page.locator('video')).toBeVisible()
    await expect(page.locator('.player').getByRole('combobox', { name: 'Качество', exact: true })).toBeFocused()
  })
}
