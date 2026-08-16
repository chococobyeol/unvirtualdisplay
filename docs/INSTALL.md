# Installation and updates

Unvirtual Display 0.1.0 is distributed without paid Windows or Apple code signing. Download it only from the official itch.io project page and compare the published SHA-256 checksum before overriding an operating-system warning.

## macOS

Choose the build for your Mac:

- Apple Silicon (M1 or newer): `Unvirtual Display-0.1.0-arm64.dmg`
- Intel: `Unvirtual Display-0.1.0.dmg`

Open the DMG and copy Unvirtual Display to Applications. Because the app is not signed or notarized, macOS can block the first launch. Try opening the app once, then open **System Settings → Privacy & Security**, scroll to Security, and choose **Open Anyway** only if the download source and checksum are trusted. Apple documents this process in [Open an app by overriding security settings](https://support.apple.com/guide/mac-help/open-an-app-by-overriding-security-settings-mh40617/mac).

Unsigned software has not been verified by Apple. Do not override the warning for a file obtained from another source or with a mismatched checksum.

## Windows 10/11 x64

Run `Unvirtual Display Setup 0.1.0.exe`. Windows Defender SmartScreen can warn that the publisher is unknown because the installer is unsigned. Check the source and SHA-256 checksum before choosing any option to continue. Do not disable SmartScreen or other system-wide security protection. Microsoft explains reputation-based warnings in [Protect my PC from viruses](https://support.microsoft.com/en-us/office/protect-my-pc-from-viruses).

The ZIP build is also available for users who prefer a portable extraction instead of the installer.

## Updates

- itch app installations use itch.io's patch update flow.
- Direct browser downloads are updated by downloading the new build and installing it over the existing version.
- Project data is stored separately from the application, so replacing or uninstalling the app does not intentionally delete displays.
- Use **Back up** in the editor to create a portable `.uvd` archive before a major update.

## Local data

The app stores settings, projects, and copied assets in the operating system's per-user application-data folder:

- macOS: `~/Library/Application Support/unvirtual-display/`
- Windows: `%APPDATA%\unvirtual-display\`

No account, cloud upload, telemetry, or automatic remote error reporting is used.
