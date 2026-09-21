import { expect, test, type Page } from "@playwright/test";

async function startTwoPlayerEasyGame(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "2 HRÁČI" }).click();
  await page.getByRole("button", { name: "LEHKÁ" }).click();
  await page.getByTestId("start-game").click();
  await expect(page.getByTestId("board")).toBeVisible();
}

const humanStatus = (page: Page) =>
  page
    .getByText("JSI NA ŘADĚ", { exact: true })
    .or(page.getByText("TÁHNI SI", { exact: true }))
    .or(page.getByText("ODHOĎ KARTU", { exact: true }))
    .or(page.getByText("VYLOŽ KARTU", { exact: true }))
    .or(page.getByText("VYUŽIJ ŽOLÍKA", { exact: true }));

test.describe("game flow", () => {
  test("board shows piles, opponents and action buttons", async ({ page }) => {
    await startTwoPlayerEasyGame(page);
    await expect(
      page.getByRole("button", { name: "Dobírací balíček" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Odhazovací hromádka" })
    ).toBeVisible();
    await expect(page.getByText("Výklady na stole")).toBeVisible();
    await expect(page.getByTestId("btn-hint")).toHaveText(/RADCE/);
    await expect(page.getByTestId("btn-sort")).toHaveText(/TŘÍDIT/);
    await expect(page.getByTestId("btn-lay")).toHaveText(/VYLOŽIT/);
    await expect(page.getByTestId("btn-discard")).toHaveText(/ODHODIT/);
    // nothing selected yet: lay/discard stay disabled
    await expect(page.getByTestId("btn-lay")).toBeDisabled();
    await expect(page.getByTestId("btn-discard")).toBeDisabled();
  });

  test("selecting a card arms the discard button", async ({ page }) => {
    await startTwoPlayerEasyGame(page);
    await expect(humanStatus(page)).toBeVisible({ timeout: 60000 });
    // discarding needs the action phase — draw first if we must
    const hand = page.getByTestId("player-hand");
    if (await page.getByText("TÁHNI SI", { exact: true }).isVisible()) {
      const before = await hand.locator(":scope > *").count();
      await page.getByRole("button", { name: "Dobírací balíček" }).click();
      // the pickup flight lands the card in its slot — wait for it
      await expect
        .poll(async () => hand.locator(":scope > *").count(), {
          timeout: 15000,
        })
        .toBe(before + 1);
    }
    await hand.locator(":scope > *").first().click();
    await expect(page.getByTestId("btn-lay")).toHaveText(/VYLOŽIT \(1\)/);
    await expect(page.getByTestId("btn-discard")).toBeEnabled();
    // clicking again deselects
    await hand.locator(":scope > *").first().click();
    await expect(page.getByTestId("btn-discard")).toBeDisabled();
  });

  test("human draws from the stock and discards", async ({ page }) => {
    await startTwoPlayerEasyGame(page);
    await expect(humanStatus(page)).toBeVisible({ timeout: 60000 });

    const hand = page.getByTestId("player-hand");
    if (await page.getByText("ODHOĎ KARTU", { exact: true }).isVisible()) {
      // human opens the round as předák: discard straight away
      const before = await hand.locator(":scope > *").count();
      await hand.locator(":scope > *").first().click();
      await page.getByTestId("btn-discard").click();
      await expect
        .poll(async () => hand.locator(":scope > *").count(), {
          timeout: 15000,
        })
        .toBe(before - 1);
    } else {
      // otherwise draw first: hand grows by one
      await expect(page.getByText("TÁHNI SI", { exact: true })).toBeVisible();
      const before = await hand.locator(":scope > *").count();
      await page.getByRole("button", { name: "Dobírací balíček" }).click();
      await expect
        .poll(async () => hand.locator(":scope > *").count(), {
          timeout: 15000,
        })
        .toBe(before + 1);
      await hand.locator(":scope > *").first().click();
      await page.getByTestId("btn-discard").click();
      await expect
        .poll(async () => hand.locator(":scope > *").count(), {
          timeout: 15000,
        })
        .toBe(before);
    }
  });

  test("pause menu opens from MENU and resumes", async ({ page }) => {
    await startTwoPlayerEasyGame(page);
    await page.getByRole("button", { name: "MENU", exact: true }).click();
    await expect(page.getByRole("heading", { name: "PAUZA" })).toBeVisible();
    await page.getByRole("button", { name: "POKRAČOVAT" }).click();
    await expect(page.getByRole("heading", { name: "PAUZA" })).toBeHidden();
    await expect(page.getByTestId("board")).toBeVisible();
  });

  test("mute toggle flips its label", async ({ page }) => {
    await startTwoPlayerEasyGame(page);
    const mute = page.getByRole("button", { name: /zvuk/i });
    await expect(mute).toBeVisible();
    const before = await mute.getAttribute("aria-label");
    await mute.click();
    await expect(mute).not.toHaveAttribute("aria-label", before ?? "");
  });
});
