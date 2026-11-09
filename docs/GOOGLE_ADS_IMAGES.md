# Prapanji Google Ads: images and logos plan

Plan for the awareness campaign (Campaign 2 in [GOOGLE_ADS_PLAN.md](GOOGLE_ADS_PLAN.md)). Nothing here is produced yet. Confirm the sizes in Google Ads when you upload, because Google changes them.

## 1. Start here: the real logo is not in a file yet

* `assets/icon.png` and `assets/splash-icon.png` are the default Expo placeholders (a blue "A" and a grey grid), not Prapanji. `favicon.png` and the Android icon files are placeholders too, and `app.json` points at them.
* The real mark exists only as code: `components/ui/LogoMark.tsx`. It is a rounded tile with three ruled lines, the top one saffron.
* So the first job was to export that mark as image files (SVG and PNG). **Done (2026-11-05):** the logo files are in `assets/brand/` (see its README), and `icon.png`, `favicon.png`, `splash-icon.png` and the three `android-icon-*.png` files now use the real mark. The Android adaptive icon background colour in `app.json` is now brand green.

## 2. Brand rules for every image

| Item | Value (from `constants/theme.ts`) |
|---|---|
| Main green | `#0F5C4A`, deep green `#0A3F33` |
| Accent (saffron) | `#E8892B` |
| Background | `#F5F6F2` (off-white), white `#FFFFFF` |
| Text | ink `#14251F` on light, white on green |
| Headings | Space Grotesk, bold |
| Body | DM Sans |
| Hindi text | Hind |

Rules:
* One idea and at most 5 words of text per image. Put the words in the middle band, since Google crops edges differently on each placement.
* Contrast: white on `#0F5C4A` and ink on `#F5F6F2` both pass. Do not put saffron text on green.
* Show the logo on every image, small, in one corner.
* No fake reviews, user counts, star ratings, awards or "as seen on" claims.

## 3. Logos

| Asset | Size | What it is |
|---|---|---|
| Square logo | 1200×1200 | The ledger mark centred on white or off-white, with space around it. Also export a 512×512 for the app icon and Play listing |
| Wide logo | 1200×300 (4:1) | The mark on the left and "Prapanji" in Space Grotesk bold on the right, on a plain background |
| Mono and dark versions | same sizes | White-on-green for dark backgrounds |

Minimum sizes Google accepts are smaller (about 128×128 and 512×128). Export the large ones.

## 4. Images

Each is a phone screen from the web app, on a flat brand-colour background with a short line of text. Make three messages in all three sizes.

| Message (the text on the image) | Screen shown | Why |
|---|---|---|
| Every rupee, accounted for | Home with the month's summary and "Money left after fixed bills" | The core promise |
| Split bills, keep friends | Split a bill, then People balances | The most shareable feature |
| Know what's left this month | Budgets with the monthly budget card | Practical and simple |

Sizes for each message:
* Landscape 1.91:1, 1200×628. Phone on the right, text on the left.
* Square 1:1, 1200×1200. Text on top, phone below.
* Portrait 4:5, 960×1200. Text on top, phone filling the lower two thirds.

That is 9 images, plus the logos.

Optional vertical video for YouTube Shorts: 1080×1920, about 15 seconds. Open on the Home screen, add one expense, show the monthly total change, end on the logo and the address. No voice is needed if on-screen text is large.

## 5. Where the screens come from

* Capture them from the local app at phone width, using a throwaway demo account. Never a real user's data.
* Use the demo story already in `monthRollover.test.ts`: salary ₹60,000, rent ₹8,000, groceries, an EMI. Round numbers read clearly.
* Show light mode for the main set. Add a dark mode pair later if you want a variation.
* Do not show the Plan ahead screen or any Pro/admin screen: they are switched on per user, so most people would not find them after clicking.

## 6. Illustrations and photos

* The sign-in page already has a flat illustration style (the coin with figures). It can be reused for a "people" image.
* Avoid stock photos of people. Avoid showing children: some of the sign-in slides talk to parents about children, but ads should not feature minors.
* Keep any text in the picture short and in the brand font, not baked into a photo.

## 7. Policy and quality checks before upload

* Nothing that suggests loans, credit, investment returns, or guaranteed savings.
* Say "free to start", not "free forever".
* No misleading buttons or fake interface elements drawn over the image.
* Text covers a small part of the image. Large blocks of text can be rejected or shown less.
* Keep file size under 5 MB each (confirm in Google Ads), as PNG or JPG.
* Name files by size and message, e.g. `rupee-1200x628.png`, so they are easy to match to the ad.

## 8. Built (2026-11-05)

The nine images are in `assets/brand/ads/`, named `<message>-<width>x<height>.png`:

| Message | Landscape 1200×628 | Square 1200×1200 | Portrait 960×1200 |
|---|---|---|---|
| Every rupee, accounted for | `rupee-1200x628.png` | `rupee-1200x1200.png` | `rupee-960x1200.png` |
| Split bills, keep friends | `split-1200x628.png` | `split-1200x1200.png` | `split-960x1200.png` |
| Know what's left this month | `left-1200x628.png` | `left-1200x1200.png` | `left-960x1200.png` |

* Screens are real captures of the app at phone width (3x) from a throwaway demo account with made-up names and round numbers. The raw captures are in `assets/brand/ads/source/`. The demo account is deleted.
* In the Home capture I hid Plan ahead, the "Explore more features" line and the floating add button, because they are not part of the ad story.
* Headlines are in Space Grotesk Bold and the small line in DM Sans Medium, as outlines. The logo is in the top-left corner of each image.
* Still to do: a Hindi version once the wording is checked, and a dark-mode pair if you want variation.
* The images show "Free to start", which matches the ad copy. Check each one on a phone before uploading.

## 9. Order of work

1. Export the logo files and fix the placeholder app icon and favicon.
2. (Done) Build the demo account and capture the three screens at phone width.
3. (Done) Make the 9 images. Review them side by side on a phone.
4. Upload with the Hindi text variants later, once a native speaker has checked the wording.
