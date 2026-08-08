# Building the Quest APK

This folder holds everything needed to turn the deployed web app into a signed
Android APK that a Meta Quest 3 can install — as a sideload, or as a Meta
Horizon Store build.

The APK is a **Trusted Web Activity (TWA)**: a thin native shell that opens the
live web app full screen with no browser chrome. The game itself is not inside
the APK. That has one consequence worth internalising before you start:

> **Web-only changes need a redeploy, not a rebuild.** Fix a bug, redeploy the
> site, and every installed headset picks it up the next time the app is
> launched. You only need a new APK when something *native* changes: the app
> name, icon, version, package id, or the app mode.

## What is in this folder

| File | Purpose |
| --- | --- |
| `twa-manifest.demo.json` | Packaging input for the Demo edition |
| `twa-manifest.pro.json` | Packaging input for the Pro edition |
| `twa-manifest.enterprise.json` | Packaging input for the Enterprise edition |
| `.gitignore` | Keeps keystores and the generated Gradle project out of git |
| `README.md` | This file |

The three `twa-manifest.*.json` files are **generated**. Never hand-edit them —
run `node scripts/gen-manifests.mjs` from `quest/` instead, so the package ids,
names and colours stay tied to `shared/editions.ts` and `shared/brand.ts`.

| Edition | Package id | Launcher name |
| --- | --- | --- |
| demo | `ch.vrent.memoryxr.demo` | Memory XR Demo |
| pro | `ch.vrent.memoryxr` | Memory XR |
| enterprise | `ch.vrent.memoryxr.enterprise` | Memory XR |

## The one setting that must not be wrong

```json
"horizonOSAppMode": "immersive"
```

VRENT Memory XR is an immersive WebXR app, so this is `"immersive"` in all
three manifests. Meta documents a mismatch here as the single most common
packaging failure:

- `"2D"` on an immersive app: the app opens as a flat window with a browser URL
  bar instead of entering VR.
- `"immersive"` on a 2D app: the app hangs on a loading screen.

There is no runtime fix. If it is wrong you rebuild the APK.

---

## Route A: build it in GitHub Actions (recommended)

`.github/workflows/quest-apk.yml` does everything below on a clean runner that
already has JDK 17 and the Android SDK. Use it unless you have a reason not to.

1. Configure the repository secrets listed in [CI secrets](#ci-secrets).
2. Go to **Actions -> Quest APK -> Run workflow**.
3. Pick the edition and the deploy domain; run it.
4. Download the `memoryxr-<edition>-<version>-apk` artifact when it finishes.

Tagging a release also builds all three editions:

```bash
git tag quest-v1.0.0
git push origin quest-v1.0.0
```

Some networks block `dl.google.com`, which makes the Android SDK impossible to
install locally. If that is your situation, Route A is not just recommended, it
is the only route that works.

---

## Route B: build it on your own machine

### 0. Prerequisites

- Node 20 or newer.
- The web app **already deployed and publicly reachable over HTTPS**.
  `bubblewrap` fetches the manifest and the icons from that origin; it cannot
  read them off your disk.
- About 2 GB of disk for the JDK and Android SDK that bubblewrap provisions.
- `adb` if you intend to sideload (part of Android platform-tools).

Verify the deployment before you start. All three of these must return `200`:

```bash
DOMAIN=quest.vrent.ch
curl -s -o /dev/null -w "%{http_code} manifest\n"  https://$DOMAIN/manifest.webmanifest
curl -s -o /dev/null -w "%{http_code} icon\n"      https://$DOMAIN/icons/pro/icon-512.png
curl -s -o /dev/null -w "%{http_code} maskable\n"  https://$DOMAIN/icons/pro/icon-512-maskable.png
```

### 1. Install bubblewrap

Use Meta's fork. The upstream Google `bubblewrap` does not know about
`horizonOSAppMode` or `isMetaQuest`.

```bash
npm install -g @meta-quest/bubblewrap-cli
bubblewrap --version
```

On first run it offers to download its own JDK 17 and Android SDK into
`~/.bubblewrap`. Accept. Afterwards, locate its tools — you need them in the
steps below and the exact version folders vary:

```bash
KEYTOOL=$(find ~/.bubblewrap/jdk -path '*/bin/keytool' | head -1)
BUILDTOOLS=$(ls -d ~/.bubblewrap/android_sdk/build-tools/* | sort -V | tail -1)
echo "$KEYTOOL"
echo "$BUILDTOOLS"
```

### 2. Create the signing keystore

> ## Read this before you generate a key
>
> **The signing key is permanent.** Once an APK signed with it is installed on a
> headset or accepted by the Horizon Store, every future update of that package
> id must be signed with the *same* key. There is no rotation, no recovery and
> no support path.
>
> **If you lose this keystore or its passwords, this app is finished.** You
> cannot ship another update. You would have to publish a brand new Store
> listing under a new package id and every existing customer would have to
> uninstall and reinstall, losing their local data.
>
> **Back it up the day you create it.** Put the keystore file and both passwords
> in the company password manager, and keep a second copy somewhere offline.
> Treat it exactly like a private key for a payment system, because commercially
> that is what it is.

If a key already exists for this product, use it — ask whoever holds it for the
file, the alias and both passwords, and skip to step 3.

Otherwise generate one. Keep it **outside** the repository so it can never be
committed or deployed:

```bash
mkdir -p ~/vrent-keys && chmod 700 ~/vrent-keys

"$KEYTOOL" -genkeypair -v \
  -keystore ~/vrent-keys/vrent-release.keystore \
  -alias vrent \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass 'CHOOSE_A_STRONG_PASSWORD' \
  -keypass   'CHOOSE_A_STRONG_PASSWORD' \
  -dname "CN=VRENT Memory XR, O=VRENT, L=Zurich, C=CH"
```

Use the same value for `-storepass` and `-keypass`; bubblewrap supports
different ones but there is no benefit and it doubles what you can lose.

Now read out the certificate fingerprint. You need it for asset links (step 6)
and for verifying builds:

```bash
"$KEYTOOL" -list -v \
  -keystore ~/vrent-keys/vrent-release.keystore \
  -alias vrent \
  -storepass 'CHOOSE_A_STRONG_PASSWORD' | grep -i 'SHA256:'
```

That prints something like
`SHA256: 3B:06:A1:...:8B`. Save the colon-separated hex string.

Finally, make sure the keystore is not reachable from the web. This must
return `404`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://quest.vrent.ch/vrent-release.keystore
```

### 3. Generate the packaging manifests

From `quest/`, with the values for the build you want:

```bash
cd /path/to/repo/quest

EDITION=pro \
DEPLOY_DOMAIN=quest.vrent.ch \
KEYSTORE_PATH="$HOME/vrent-keys/vrent-release.keystore" \
KEYSTORE_ALIAS=vrent \
APP_VERSION_NAME=1.0.0 \
APP_VERSION_CODE=1 \
node scripts/gen-manifests.mjs
```

`APP_VERSION_CODE` is an integer that **must increase with every build you
upload to the Store**. Horizon rejects a build whose version code is not higher
than the last one it accepted. In CI this is wired to the workflow run number.

Note that this also rewrites `public/manifest.webmanifest` for the chosen
edition. If you generated manifests for `demo` and then build and deploy `pro`,
the deployed PWA manifest will describe the wrong edition. Always run the
generator with the edition you are about to build, then build, then deploy.

### 4. Build the APK

`bubblewrap init` is an interactive `inquirer` wizard: it needs a real TTY, and
it has no flags to supply the answers. That makes it unusable from a script, a
CI runner or an agent. **The path below is the scripted equivalent** — a
hand-written `twa-manifest.json` plus `update` and `build` — and it is exactly
what `.github/workflows/quest-apk.yml` runs.

```bash
cd /path/to/repo/quest

# A scratch directory for the generated Gradle project. Ignored by git.
mkdir -p android/build
cp android/twa-manifest.pro.json android/build/twa-manifest.json
cd android/build

# Passwords go through the environment. There are no password CLI flags.
read -rsp 'Keystore password: ' PW && echo
export BUBBLEWRAP_KEYSTORE_PASSWORD="$PW"
export BUBBLEWRAP_KEY_PASSWORD="$PW"

bubblewrap update      # regenerates the Gradle project from twa-manifest.json
bubblewrap build       # compiles and signs

unset BUBBLEWRAP_KEYSTORE_PASSWORD BUBBLEWRAP_KEY_PASSWORD PW
```

You get two artefacts in `android/build/`:

- `app-release-signed.apk` — sideload this, and upload this to the Store.
- `app-release-bundle.aab` — an Android App Bundle. Horizon does not use it.

`bubblewrap update` is the step that goes to the network. If it fails with a
404 or a parse error, the manifest or an icon is not actually live at
`DEPLOY_DOMAIN` — go back to the prerequisites and re-check with `curl`.

### 5. Verify the build

```bash
BUILDTOOLS=$(ls -d ~/.bubblewrap/android_sdk/build-tools/* | sort -V | tail -1)

# The signature must match the keystore fingerprint from step 2.
"$BUILDTOOLS/apksigner" verify --print-certs app-release-signed.apk | grep -i 'SHA-256'

# Package id, Horizon app id and app mode, straight out of the built manifest.
"$BUILDTOOLS/aapt" dump badging app-release-signed.apk \
  | grep -E '^package:|OCULUS_APP_ID|APP_MODE|application-label'
```

If the SHA-256 here does not equal the SHA-256 from step 2, the APK was signed
with the wrong key. Stop and fix it — an APK signed with the wrong key cannot
update an existing install.

### 6. Publish the Digital Asset Links

A TWA verifies that it is allowed to display your domain without a URL bar by
fetching `https://<domain>/.well-known/assetlinks.json`. If that check fails,
Horizon shows **"the app will not launch"** and nothing else happens. This is
the second most common packaging failure after the app mode.

`public/.well-known/assetlinks.json` in this repo is a template with a
placeholder fingerprint. Fill it in with the value from step 2:

```bash
cd /path/to/repo/quest
CERT_SHA256="3B:06:A1:...:8B" node scripts/gen-manifests.mjs
```

That rewrites the file with the real fingerprint for all three package ids, so
one domain can serve all three editions. (JSON has no comment syntax, which is
why the explanation lives here and not in the file.)

Commit it, redeploy the site, and confirm it is actually being served:

```bash
curl -s https://quest.vrent.ch/.well-known/assetlinks.json
```

Both the `package_name` and the fingerprint must match the APK exactly.
Changing `applicationId` or `horizonOSAppMode` later does **not** invalidate
asset links; changing the signing key or the package id does.

### 7. Sideload onto a headset

Enable developer mode on the Quest 3 first (Meta Horizon phone app -> your
headset -> Headset settings -> Developer mode), then plug it in over USB and
accept the "Allow USB debugging" prompt inside the headset.

```bash
adb devices                                  # the headset must be listed as "device"
adb install -r app-release-signed.apk
```

If `adb install` fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, a build signed
with a *different* key is already installed. Remove it first — this deletes the
app's local data on that headset:

```bash
adb uninstall ch.vrent.memoryxr
adb install app-release-signed.apk
```

The app appears in the headset library under **Unknown Sources**. Launch it
from there. To watch what it is doing:

```bash
adb logcat -v brief | grep -iE 'vrent|memoryxr|chromium|AssetLink'
```

Auto-entry into the WebXR session only happens in the installed app, never in a
browser tab, because it is gated on `getDigitalGoodsService` — a device-only
API. So "it enters VR when I sideload it but not when I open the URL in the
Quest browser" is correct behaviour, not a bug.

### 8. Upload to the Meta Horizon Store

Download `ovr-platform-util` from the Meta developer dashboard (Tools ->
Platform Utility) and make it executable.

```bash
./ovr-platform-util upload-quest-build \
  --app-id "$HORIZON_APP_ID" \
  --app-secret "$HORIZON_APP_SECRET" \
  --apk app-release-signed.apk \
  --channel ALPHA \
  --age-group MIXED_AGES \
  --notes "1.0.0 - first release" \
  --disable-progress-bar
```

- `--app-id` is the numeric Horizon app id from the dashboard. It is also what
  `applicationId` should be set to in the twa-manifest (`HORIZON_APP_ID_PRO`
  etc. when running the generator). `"0"` builds and sideloads fine but must be
  replaced before any Store work.
- `--app-secret` comes from the dashboard, app -> API tab. Never commit it.
- `--channel` is `ALPHA`, `BETA`, `RC` for testing or `STORE` for production.
  Start with `ALPHA`.
- `--age-group` is `TEENS_AND_ADULTS`, `MIXED_AGES` or `CHILDREN`.

**Expect the first upload to be rejected** with a message about the *Developer
Distribution Agreement*. That is not a build problem. An organisation admin has
to sign the DDA once, at
`https://developer.oculus.com/manage/organizations/<ORG_ID>/legal-documents/`.
Once signed, re-run the identical command.

---

## CI secrets

`.github/workflows/quest-apk.yml` needs these repository secrets
(Settings -> Secrets and variables -> Actions -> New repository secret).

| Secret | Required | What it is |
| --- | --- | --- |
| `QUEST_KEYSTORE_B64` | yes | The release keystore, base64 encoded |
| `QUEST_KEYSTORE_PASSWORD` | yes | Keystore password (`-storepass`) |
| `QUEST_KEY_PASSWORD` | yes | Key password (`-keypass`) |
| `QUEST_KEY_ALIAS` | no | Key alias. Defaults to `vrent` |
| `HORIZON_APP_ID_DEMO` | no | Numeric Horizon app id for the Demo edition |
| `HORIZON_APP_ID_PRO` | no | Numeric Horizon app id for the Pro edition |
| `HORIZON_APP_ID_ENTERPRISE` | no | Numeric Horizon app id for the Enterprise edition |

The Horizon app ids default to `"0"`, which produces an APK you can sideload
but not sell. Set the real ids before building anything destined for the Store.

To produce `QUEST_KEYSTORE_B64`:

```bash
base64 -w0 ~/vrent-keys/vrent-release.keystore > /tmp/keystore.b64   # Linux
base64 -i  ~/vrent-keys/vrent-release.keystore > /tmp/keystore.b64   # macOS
```

Paste the contents of `/tmp/keystore.b64` into the secret, then delete the file
(`shred -u /tmp/keystore.b64`). The workflow decodes it into the runner's
temporary directory, which is destroyed when the job ends, and it never prints
it or any password to the log.

The Store upload is deliberately **not** automated. It is a commercial action
with an app secret attached and a human should be the one who decides that a
particular build goes to customers.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| App opens a flat window with a URL bar | `horizonOSAppMode` is `"2D"` | Regenerate manifests, rebuild. It must be `"immersive"` |
| App hangs on a loading screen forever | Deployed site is broken or unreachable | Open the URL in the Quest browser and look at the actual error |
| "The app will not launch" | Asset link verification failed | Step 6. Check `package_name` and fingerprint against the installed APK |
| `bubblewrap update` fails with 404 | Manifest or icons not live at `DEPLOY_DOMAIN` | Deploy the site first, verify with `curl` |
| `bubblewrap init` hangs with no output | It needs a TTY | Do not use `init`. Use the scripted path in step 4 |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Installed build signed with a different key | `adb uninstall <packageId>` first |
| `INSTALL_FAILED_VERSION_DOWNGRADE` | `appVersionCode` is not higher than installed | Raise `APP_VERSION_CODE` and rebuild |
| Store upload rejected: version code | Same, on the Store side | Raise `APP_VERSION_CODE`. Codes may never be reused |
| Store upload rejected: distribution agreement | DDA unsigned | An org admin signs it once, then retry |
| Icon looks cropped or has odd corners | Wrong icon used as maskable | The maskable icon must be opaque and full bleed. `npm run icons` produces a correct one |
| Cannot install the Android SDK | Network blocks `dl.google.com` | Build in GitHub Actions (Route A) |
