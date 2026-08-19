# Installation and updates

Unvirtual Display 0.1.0 is distributed without paid Windows or Apple code signing. Download it only from the official itch.io project page and compare the published SHA-256 checksum before overriding an operating-system warning.

## macOS — Apple Silicon

Open `Unvirtual-Display-0.1.0-macOS-Apple-Silicon-r3.dmg`, then drag Unvirtual Display to Applications. Because the app is ad-hoc signed but not notarized, macOS can block the first launch. Try opening the app once, then open **System Settings → Privacy & Security**, scroll to Security, and choose **Open Anyway** only if the download source and checksum are trusted. Apple documents this process in [Open an app by overriding security settings](https://support.apple.com/guide/mac-help/open-an-app-by-overriding-security-settings-mh40617/mac).

Unsigned software has not been verified by Apple. Do not override the warning for a file obtained from another source or with a mismatched checksum.

## Windows 10/11 x64

Run `Unvirtual-Display-0.1.0-Windows-x64-Installer-r2.exe` and follow the installer. The per-machine installer may request administrator permission and lets you choose the installation directory. Windows Defender SmartScreen can warn that the publisher is unknown because the installer is unsigned. Check the source and SHA-256 checksum before choosing any option to continue. Do not disable SmartScreen or other system-wide security protection. Microsoft explains reputation-based warnings in [Protect my PC from viruses](https://support.microsoft.com/en-us/office/protect-my-pc-from-viruses).

## Linux x64

Make `Unvirtual-Display-0.1.0-Linux-x64-r3.AppImage` executable, then run it:

```bash
chmod +x "Unvirtual-Display-0.1.0-Linux-x64-r3.AppImage"
./"Unvirtual-Display-0.1.0-Linux-x64-r3.AppImage"
```

Some distributions may require FUSE 2 compatibility to launch an AppImage.

## SHA-256 checksums

```text
537e30a6ce5ffbc86c7f68f354bf6a5a69e41997493b1c4dcdc581505189e0e9  Unvirtual-Display-0.1.0-macOS-Apple-Silicon-r3.dmg
4f151360315efe6439634a0973d6b090cf43c7fb7739d7ae09ebc3d1de06d7ec  Unvirtual-Display-0.1.0-Windows-x64-Installer-r2.exe
d1e3174952bd314c1b23c2dcaa57c6baf5d1585086180b58d67709d958ff3ba5  Unvirtual-Display-0.1.0-Linux-x64-r3.AppImage
```

## Updates

- itch app installations use itch.io's patch update flow.
- Direct browser downloads are updated by downloading the new build and installing it over the existing version.
- Project data is stored separately from the application, so replacing or uninstalling the app does not intentionally delete displays.
- Use **Back up** in the editor to create a portable `.uvd` archive before a major update.

## Local data

The app stores settings, projects, and copied assets in the operating system's per-user application-data folder:

- macOS: `~/Library/Application Support/unvirtual-display/`
- Windows: `%APPDATA%\unvirtual-display\`
- Linux: `~/.config/unvirtual-display/`

No account, cloud upload, telemetry, or automatic remote error reporting is used.
