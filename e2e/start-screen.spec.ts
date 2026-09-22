import { expect, test } from "@playwright/test";

test.describe("start screen", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("shows the title and the game setup", async ({ page }) => {
    await expect(page).toHaveTitle(/Žolíky/);
    await expect(page.getByTestId("start-screen")).toBeVisible();
    await expect(page.getByText("ŽOLÍKY", { exact: true })).toBeVisible();
    await expect(page.getByTestId("start-game")).toHaveText(/HRÁT/);
    await expect(page.getByTestId("show-rules")).toHaveText(/PRAVIDLA/);
  });

  test("lets the player pick player count, difficulty and target", async ({ page }) => {
    await page.getByRole("button", { name: "3 HRÁČI" }).click();
    await page.getByRole("button", { name: "TĚŽKÁ" }).click();
    await page.getByRole("button", { name: "50" }).click();
    await page.getByTestId("start-game").click();
    await expect(page.getByTestId("board")).toBeVisible();
    await expect(page.getByText("CÍL 50")).toBeVisible();
  });

  test("opens and closes the rules modal", async ({ page }) => {
    await page.getByTestId("show-rules").click();
    await expect(
      page.getByRole("heading", { name: "PRAVIDLA ŽOLÍKŮ" })
    ).toBeVisible();
    await page.getByRole("button", { name: "ZAVŘÍT" }).click();
    await expect(
      page.getByRole("heading", { name: "PRAVIDLA ŽOLÍKŮ" })
    ).toBeHidden();
  });

  test("starting the game deals a hand and shows the piles", async ({ page }) => {
    await page.getByTestId("start-game").click();
    await expect(page.getByTestId("board")).toBeVisible();
    const hand = page.getByTestId("player-hand");
    await expect(hand).toBeVisible();
    // předák holds 13 cards, everyone else 12
    const cards = hand.locator(":scope > *");
    await expect
      .poll(async () => cards.count(), { timeout: 15000 })
      .toBeGreaterThanOrEqual(12);
    await expect.poll(async () => cards.count()).toBeLessThanOrEqual(13);
  });
});
