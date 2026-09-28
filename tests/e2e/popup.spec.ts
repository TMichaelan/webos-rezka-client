import { test, expect, type Page } from '@playwright/test'

async function login(page: Page) {
  await page.goto('/')
  await page.locator('[data-nav-id="nav-profile"]').click()
  await expect(page.getByLabel('Логин или e-mail')).toBeFocused()
  await page.getByLabel('Логин или e-mail').fill('demo@example.test')
  await page.getByLabel('Пароль', { exact: true }).fill('demo-only')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })).toBeVisible()
  await page.locator('[data-nav-id="nav-home"]').click()
  await expect(page.getByRole('heading', { name: 'Что посмотрим сегодня?' })).toBeVisible()
}
test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:5174/api/test/reset') })

test('TV popup consumes Back, restores trigger focus, and can reopen to choose', async ({ page }) => {
  await login(page)
  await page.locator('[data-nav-id="continue-100"]').click()
  const trigger = page.getByRole('combobox', { name: 'Озвучка', exact: true })
  await trigger.click()
  const popup = page.getByRole('dialog', { name: 'Озвучка', exact: true })
  await expect(popup).toBeVisible({ timeout: 1000 })
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(page.locator('[data-nav-id="detail-play"]')).toBeVisible()
  await trigger.click()
  await expect(popup).toBeVisible()
  await page.getByRole('option', { name: 'Оригинал', exact: true }).click()
  await expect(popup).toHaveCount(0)
  await expect(trigger).toContainText('Оригинал')
  await trigger.click()
  await page.evaluate(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 461, bubbles: true, cancelable: true })))
  await expect(popup).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(page.locator('[data-nav-id="detail-play"]')).toBeVisible()
})

test('sidebar puts bookmarks below search and has one bottom Profile action', async ({ page }) => {
  await login(page)
  expect(await page.locator('.sidebar button').evaluateAll(items => items.map(item => (item as HTMLElement).dataset.navId))).toEqual(['nav-home', 'nav-search', 'nav-bookmarks', 'nav-films', 'nav-series', 'nav-cartoons', 'nav-animation', 'nav-profile'])
  await expect(page.locator('.sidebar-account strong')).toHaveText('Профиль')
  await expect(page.locator('.sidebar-footer button')).toHaveCount(1)
  await expect(page.locator('[data-nav-id="nav-profile"]')).toBeEnabled()
  await page.locator('[data-nav-id="nav-search"]').focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-nav-id="nav-bookmarks"]')).toBeFocused()
})

for (const moved of [false, true]) test(`TV popup deferred focus ${moved ? 'respects a later user focus choice' : 'returns to the voice trigger when ready'}`, async ({ page }) => {
  let releaseDetails!: () => void
  let signalDetails!: () => void
  const gate = new Promise<void>(resolve => { releaseDetails = resolve })
  const requested = new Promise<void>(resolve => { signalDetails = resolve })
  await page.route('**/api/rpc', async route => {
    const { method, params } = route.request().postDataJSON()
    if (method === 'details' && params.translatorId === '2') { signalDetails(); await gate }
    await route.continue()
  })
  await login(page)
  await page.locator('[data-nav-id="continue-100"]').click()
  const trigger = page.getByRole('combobox', { name: 'Озвучка', exact: true })
  await trigger.click()
  await page.getByRole('option', { name: 'Оригинал', exact: true }).click()
  await requested
  await expect(trigger).toBeDisabled()
  const target = moved ? page.locator('[data-nav-id="detail-bookmark"]') : trigger
  if (moved) await target.focus()
  releaseDetails()
  await expect(trigger).toBeEnabled()
  await expect(target).toBeFocused()
})
