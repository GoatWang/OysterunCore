# Oysterun

Oysterun lets you run a local Host and chat with coding agents through a web
chat interface.

## Install

```bash
npm install -g oysterun@latest --prefer-online
oysterun --version
oysterun setup
oysterun
```

Use the official Oysterun iOS app for phone pairing and notifications.

## Update

```bash
npm install -g oysterun@latest --prefer-online
oysterun service:restart
oysterun service:status
```

## Source Build

The public source includes the local Host and web-chat client source. It does
not include Oysterun Cloud backend source or Cloud deployment operations.
Notifications and app pairing use the operated Oysterun Cloud with the official
Oysterun app. Forked app builds are not guaranteed to work with Oysterun Cloud
notification or pairing identity.

Basic source path:

```bash
npm install
npm --prefix host-service install
npm --prefix dev/client/web-chat install
npm --prefix dev/client/web-chat run build
node host-service/setup.mjs
node host-service/server.mjs
```

For local iOS app builds, copy
`dev/client/web-chat/ios/oysterun.local.xcconfig.example` to the local
`oysterun.local.xcconfig` path and set your own app id/name before running the
Capacitor sync/build steps. The public source uses placeholder app identity
values. Official Oysterun Cloud notification registration requires the official
app identity and is not expected to work from forked app builds.

## License

Oysterun-owned non-Cinny code is MIT licensed. The web-chat client contains
Cinny-derived code and follows the relevant Cinny/AGPL license notices.
