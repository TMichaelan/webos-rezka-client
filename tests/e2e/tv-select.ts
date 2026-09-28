import { expect, type Locator, type Page } from '@playwright/test'

export async function chooseTvOption(page: Page, trigger: Locator, value: string | number) {
  await trigger.click()
  const option = page.getByRole('option').and(page.locator(`[data-value=${JSON.stringify(String(value))}]`))
  await expect(option).toBeVisible()
  await option.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
}
