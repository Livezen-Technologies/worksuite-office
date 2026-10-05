# WorkSuite Office app icon (Ring)

Source files for the app icon used in `desktop-apps`:

| File | Used for |
|------|----------|
| `png/macOS-*.png` | `macos/ONLYOFFICE/Images.xcassets/AppIcon.appiconset` |
| `WorkSuiteOffice.ico` | `win-linux/res/icons/desktopeditors-eo.ico` (exe, installer, taskbar) |
| `png/windows-*.png` | `package/common/linux/icons-eo/<size>x<size>.png` |
| `WorkSuiteOffice-Windows-small.svg` | `win-linux/res/icons/app-icon-eo.svg` (message boxes) |
| `*.svg` | masters; the `-small` variants drop the w for 16–32 px |

`WorkSuiteOffice.icns` was made on Linux. The macOS app is built from the asset
catalog, not this file; if a standalone `.icns` is needed, rebuild it on a Mac with
`iconutil` from the `png/macOS-*.png` files.
