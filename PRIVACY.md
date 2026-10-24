# Privacy policy: ChatStamp

Last updated: 24 October 2026

ChatStamp shows the date each chat started in the ChatGPT and Claude sidebars. This policy explains what it stores and where.

## What the extension stores

For each chat it sees, the extension stores:

- which site the chat is on (ChatGPT or Claude)
- the chat's ID from its web address
- the chat's title
- when the chat was created, last updated, and first seen by the extension

It also stores your display settings (date format, clock format, which sites are on).

It **never** reads or stores the text of your messages or the AI's replies.

## Where it is stored

Everything is kept in your browser's local extension storage (`chrome.storage.local`) on your device. It is not synced to other devices.

## What is sent anywhere

Nothing. The extension has no server, no account, no analytics and no third-party scripts.

To get real creation dates on ChatGPT and Claude, the extension asks those sites for your own chat list, the same list the site loads to show your sidebar. That request goes only to the site you are already using, with your existing login, and the answer stays on your device.

To show the time of each message, the extension also asks the site for the chat you have open, the same data the site loads to show that chat. Only the message times are used. They are kept in memory while the chat is open and never saved, and message text is never stored.

## Permissions

- **storage**: to save dates on your device.
- **Access to chatgpt.com and claude.ai**: to add date labels to those sites' sidebars. The extension runs on no other sites.

## Deleting your data

Open the extension's settings and choose **Clear all data**. Uninstalling the extension also deletes everything it stored.
