# WorkSuite Office app icon

Source files for the app icon used in `desktop-apps`:

| File | Used for |
|------|----------|
| `png/macOS-*.png` | `macos/ONLYOFFICE/Images.xcassets/AppIcon.appiconset` |
| `WorkSuiteOffice.ico` | `win-linux/res/icons/desktopeditors.ico` and `win-linux/extras/projicons/res/icons/desktopeditors.ico` (exe, installer, taskbar; 16–256 px) |
| `png/windows-*.png` | `package/common/linux/icons/<size>x<size>.png` (hicolor 16–512) |
| `WorkSuiteOffice-Windows-small.svg` | `win-linux/res/icons/logo.svg`, `app-icon_64.png` (message boxes) |
| `*.svg` | masters (navy rounded square, tilted cyan/blue sheets, white document); all four are the same design, the `-small` names are kept for the build |

All PNGs are rendered from the SVG master by headless Chromium at each size (no
downscaling). `WorkSuiteOffice.icns` (icp4–ic14, PNG payloads) and `WorkSuiteOffice.ico`
(16, 20, 24, 32, 40, 48, 64, 96, 128, 256) were encoded on Linux. The macOS app is built
from the asset catalog, not this file; `iconutil` on a Mac can rebuild it from `png/macOS-*.png`.
