# Prapanji brand files

Made from the ledger mark in `components/ui/LogoMark.tsx` (a rounded tile with three ruled lines, the top one saffron) and the wordmark set in Space Grotesk Bold, converted to outlines so no font is needed.

| File | Use |
|---|---|
| `logo-mark.svg`, `logo-mark-white.svg` | The mark alone, on transparent. Green version for light backgrounds, white for dark |
| `logo-square.svg`, `logo-square-1200.png`, `logo-square-512.png` | Square logo on white. Google Ads square logo (1:1), Play Store listing icon (512) |
| `logo-wide.svg`, `logo-wide-1200x300.png` | Mark with wordmark on white. Google Ads wide logo (4:1) |
| `logo-wide-white.svg`, `logo-wide-white-1200x300.png` | The same on brand green |

App icons in `assets/` (`icon.png`, `favicon.png`, `splash-icon.png`, `android-icon-*.png`) use the same mark. The Android adaptive icon is the white mark on a flat `#0F5C4A` background.

Colours: green `#0F5C4A`, saffron `#E8892B`, white `#FFFFFF` (see `constants/theme.ts`).

If the mark in `LogoMark.tsx` changes, update the SVGs here to match and re-export the PNGs.
