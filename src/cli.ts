#!/bin/user/env node
import fetch from "node-fetch";
import inquirer from "inquirer";
import fs from "fs";
import Koa from "koa";
import Router from "koa-router";
import open from "open";
import { v4 as uuid } from "uuid";

const configFilePath = "./config.json";
const app = new Koa();
const router = new Router();

let applicationState: ApplicationState = "login_source";
let oauthState = uuid();
let config: Config;
let subscriptions: SubscriptionSnippet[] = [];

type ApplicationState = "login_source" | "login_destination";

type Config = {
  clientId: string;
  clientSecret: string;
  port: number;
  redirectUrl: string;
  scope: string;
  authorizationUrl: string;
  tokenUrl: string;
};

type SubscriptionsResponse = {
  nextPageToken: string;
  items: Subscription[];
};

type Subscription = {
  id: string;
  snippet: SubscriptionSnippet;
};

type SubscriptionSnippet = {
  title: string;
  resourceId: SubscriptionSnippetResource;
};

type SubscriptionSnippetResource = {
  kind: string;
  channelId: string;
};

const defaultConfig: Partial<Config> = {
  port: 8080,
  redirectUrl: "http://localhost:8080/callback",
  scope: "https://www.googleapis.com/auth/youtube.force-ssl",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
};

const loadOrCreateConfig = async (): Promise<Config> => {
  if (fs.existsSync(configFilePath)) {
    return JSON.parse(String(fs.readFileSync(configFilePath))) as Config;
  }
  const credentials: Partial<Config> = await promptCredentials();
  const config: Config = {
    ...credentials,
    ...defaultConfig,
  } as Config;
  fs.writeFileSync(configFilePath, JSON.stringify(config, null, 4));
  return config;
};

const promptCredentials = () =>
  inquirer.prompt([
    {
      type: "input",
      name: "clientId",
      message: "YouTube OAuth Client ID",
    },
    {
      type: "password",
      name: "clientSecret",
      message: "YouTube OAuth Client Secret",
    },
  ]);

const promptSourceLogin = async () => {
  const response: { login: boolean } = await inquirer.prompt({
    default: true,
    type: "confirm",
    name: "login",
    message:
      "Press enter to login to your source YouTube account from where subscriptions will be taken from",
  });
  if (!response.login) {
    process.exit(0);
  }
};

const promptDestinationLogin = async () => {
  const response: { login: boolean } = await inquirer.prompt({
    type: "confirm",
    name: "login",
    message: `Press enter to login to your destination YouTube account which will automatically subscribe to ${subscriptions.length} channels.`,
    default: true,
  });
  if (!response.login) {
    process.exit(0);
  }
  applicationState = "login_destination";
  startLogin();
};

const start = async () => {
  app.use(router.routes());
  config = await loadOrCreateConfig();
  app.listen(config.port);
  await promptSourceLogin();
  startLogin();
};

const startLogin = async () => {
  oauthState = uuid();
  open(
    `${config.authorizationUrl}?client_id=${config.clientId}&redirect_uri=${config.redirectUrl}&response_type=code&scope=${config.scope}&state=${oauthState}`
  );
};

const loginSource = async (accessToken: string) => {
  console.log("Successfully logged in to source account.");
  console.log("Collecting subscribed channels ...");
  subscriptions = await getAllSubscriptions(accessToken);
  if (subscriptions.length === 0) {
    console.log(
      "No subscriptions found! Please try again with an account that is subscribed to other channels."
    );
    process.exit(1);
  }
  console.log(`Found ${subscriptions.length} subscriptions.`);
  await promptDestinationLogin();
};

const getAllSubscriptions = async (
  accessToken: string
): Promise<SubscriptionSnippet[]> => {
  let nextPage: string | undefined = undefined;
  let subscriptions: SubscriptionSnippet[] = [];
  do {
    const response = await fetch(
      `https://youtube.googleapis.com/youtube/v3/subscriptions?part=id,snippet&maxResults=50&mine=true${
        nextPage ? `&pageToken=${nextPage}` : ""
      }`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      console.log(
        "Failed to load subscriptions",
        await response.json(),
        response.status
      );
      return subscriptions;
    }
    const body: SubscriptionsResponse = await response.json();
    nextPage = body.nextPageToken;
    subscriptions = subscriptions.concat(
      body.items?.map((item: Subscription) => item.snippet)
    );
  } while (nextPage);
  return subscriptions;
};

const loginDestination = async (accessToken: string) => {
  console.log("Successfully logged in to destination account.");
  console.log(`Subscribing to ${subscriptions.length} channels ...`);
  await Promise.all(
    subscriptions.map(async (subscription) => {
      const success = await subscribeChannel(accessToken, subscription);
      if (success) {
        console.log(`Subscribed to ${subscription.title}`);
      } else {
        console.log(`Failed to subscribe to ${subscription.title}`);
      }
    })
  );
  console.log("Done!");
  process.exit(0);
};

const exchangeForAccessToken = async (
  code: string
): Promise<string | undefined> => {
  const response = await fetch(
    `${config.tokenUrl}?client_id=${config.clientId}&client_secret=${config.clientSecret}&redirect_uri=${config.redirectUrl}&grant_type=authorization_code&code=${code}`,
    { method: "POST" }
  );
  if (!response.ok) {
    console.log(
      "Failed to login using YouTube",
      await response.json(),
      response.status
    );
    return undefined;
  }
  const body = await response.json();
  if (!body.access_token) {
    console.log(
      "Failed to login using YouTube: Response did not contain an access_token",
      body
    );
    return undefined;
  }
  return body.access_token;
};

const subscribeChannel = async (
  accessToken: string,
  subscription: SubscriptionSnippet
): Promise<boolean> => {
  const requestBody = {
    snippet: {
      resourceId: subscription.resourceId,
    },
  };
  const response = await fetch(
    "https://youtube.googleapis.com/youtube/v3/subscriptions?part=snippet",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    }
  );
  return response.ok;
};

router.get("/callback", async (ctx) => {
  const code = ctx.query.code;
  const responseState = ctx.query.state;
  if (!code || typeof code !== "string") {
    ctx.body = "Failed to login with YouTube. Please try again.";
    return;
  }
  if (!responseState || responseState !== oauthState) {
    ctx.body = "Failed to login with YouTube. Invalid state.";
    return;
  }
  const accessToken = await exchangeForAccessToken(code);
  if (!accessToken) {
    ctx.body = "Failed to login with YouTube. No access token received.";
    return;
  }
  if (applicationState === "login_source") {
    loginSource(accessToken);
  }
  if (applicationState === "login_destination") {
    loginDestination(accessToken);
  }
  ctx.body =
    "Please check the terminal for the next steps. You can close this window now.";
  return;
});

router.get("/", async (ctx) => {
  ctx.body = "Please continue in your terminal";
});

(async () => {
  await start();
})();
