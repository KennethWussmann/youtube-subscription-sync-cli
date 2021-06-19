# youtube-subscription-sync-cli

CLI tool to sync YouTube subscriptions from one account to another.

Switching to another YouTube account can be annoying when you have to manually subscribe to all the YouTube channels again.
This small CLI tool guides you to the process of automating this task.

## How it works

You'll be redirected to login with your source YouTube channel. Afterwards the tool will fetch all channels that account is subscribed to.
Now you'll have to login with your destination YouTube channel. The tool will then automatically subscribe to all the previously found channels.

## Usage

1. Create YouTube OAuth client credentials
   - Create a project in the [Google API Console](https://console.developers.google.com/)
   - Enable `YouTube Data API v3` [here](https://console.cloud.google.com/apis/library/youtube.googleapis.com).
   - Enable OAuth authorization [here](https://console.cloud.google.com/apis/credentials/consent) and add your Google accounts as test users.
   - Add `http://localhost:8080/callback` as trusted redirect url.
2. [Install NodeJS](https://nodejs.org/)
3. Run this CLI `npx youtube-subscription-sync-cli`
4. That's it. You'll be guided through the process.
