// index.js - FATIMA-MD Complete Server & Bot File
import express from "express";
import fs from "fs-extra";
import fsSync from "fs";
import path from "path";
import { exec } from "child_process";
import bodyParser from "body-parser";
import { MongoClient } from "mongodb";
import axios from "axios";
import AdmZip from "adm-zip";
import pino from "pino";
import os from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";

const currentDir = process["cwd"]();
global["__path"] = process["cwd"]();

import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  delay,
  getContentType,
  makeCacheableSignalKeyStore,
  jidNormalizedUser,
  fetchLatestBaileysVersion,
  Browsers,
} from "@whiskeysockets/baileys";

import {
  sms,
  AntiDelete,
  saveMessage,
  getGroupAdmins,
  lidToPhone,
  addWarning,
  clearWarning,
  AntiEdit,
  addConnectionFunctions,
  GroupEvents,
} from "./lib/index.js";

import { commands, cmd } from "./command.js";
import config from "./config.js";

const activeSessions = new Map();
const sessionDir = "./session";
const pluginsDir = path["join"](currentDir, "plugins");
const repoUrl = "https://github.com/duafatima75/fatimakg/archive/refs/heads/main.zip";
const MAX_SESSIONS = 50;
let dbClient;
let database;

// 1. Repo Plugins Loader Function
async function loadPlugins() {
  try {
    console["log"]("📦 [1/4] Starting plugin loader...");
    const response = await axios["get"](repoUrl, { ["responseType"]: "arraybuffer" });
    const zip = new AdmZip(Buffer["from"](response["data"], "binary"));
    const tempPlugins = path["join"](currentDir, ".temp_plugins");
    
    if (fsSync["existsSync"](tempPlugins)) {
      await fs["remove"](tempPlugins);
    }
    fsSync["mkdirSync"](tempPlugins, { ["recursive"]: true });
    zip["extractAllTo"](tempPlugins, true);
    
    const folders = fs["readdirSync"](tempPlugins)["filter"]((f) =>
      fs["statSync"](path["join"](tempPlugins, f))["isDirectory"]()
    );
    
    if (!folders["length"]) {
      await fs["remove"](tempPlugins);
      return;
    }
    
    const extractedPath = path["join"](tempPlugins, folders[0]);
    if (fsSync["existsSync"](pluginsDir)) {
      await fs["remove"](pluginsDir);
    }
    fsSync["mkdirSync"](pluginsDir, { ["recursive"]: true });
    
    const repoPluginsDir = path["join"](extractedPath, "plugins");
    let pluginCount = 0;
    
    if (fsSync["existsSync"](repoPluginsDir)) {
      const files = fs["readdirSync"](repoPluginsDir);
      for (const file of files) {
        if (file["endsWith"](".js")) {
          await fs["copy"](path["join"](repoPluginsDir, file), path["join"](pluginsDir, file));
          pluginCount++;
        }
      }
      console["log"](`✅ [2/4] Installed ${pluginCount} plugins`);
    }
    
    await fs["remove"](tempPlugins);
  } catch (err) {
    console["error"]("❌ Error loading plugins:", err["message"]);
  }
}

// 2. MongoDB Connection Setup
async function connectMongoDB() {
  try {
    dbClient = new MongoClient(config["MONGODB_URL"]);
    await dbClient["connect"]();
    database = dbClient["db"](config["DB_NAME"]);
    await database["collection"](config["COLLECTIONS"]["SESSIONS"])["createIndex"]({ ["number"]: 1 }, { ["unique"]: true });
    await database["collection"](config["COLLECTIONS"]["NUMBERS"])["createIndex"]({ ["number"]: 1 }, { ["unique"]: true });
    await database["collection"](config["COLLECTIONS"]["CONFIGS"])["createIndex"]({ ["number"]: 1 }, { ["unique"]: true });
    console["log"]("✅ MongoDB Connected Successfully");
    return database;
  } catch (err) {
    console["error"]("❌ MongoDB Connection Error:", err);
    throw err;
  }
}

// Session Helpers
async function saveSessionData(number, data) {
  try {
    const cleanNum = number["replace"](/[^0-9]/g, "");
    if (!data || typeof data !== "object") return false;
    await database["collection"](config["COLLECTIONS"]["SESSIONS"])["updateOne"](
      { ["number"]: cleanNum },
      { ["$set"]: { ["number"]: cleanNum, ["sessionData"]: data, ["lastUpdated"]: new Date() } },
      { ["upsert"]: true }
    );
    return true;
  } catch (e) {
    return false;
  }
}

async function getSessionData(number) {
  try {
    const cleanNum = number["replace"](/[^0-9]/g, "");
    const res = await database["collection"](config["COLLECTIONS"]["SESSIONS"])["findOne"]({ ["number"]: cleanNum });
    return res?.["sessionData"] || null;
  } catch (e) {
    return null;
  }
}

// 3. Start WhatsApp Bot Session & Pairing Code Handler
async function startBotSession(number, resObj) {
  const cleanNumber = number["replace"](/[^0-9]/g, "");
  const sessionPath = path["join"](sessionDir, `session_${cleanNumber}`);
  
  const savedCreds = await getSessionData(cleanNumber);
  if (savedCreds) {
    fs["ensureDirSync"](sessionPath);
    fs["writeFileSync"](path["join"](sessionPath, "creds.json"), JSON["stringify"](savedCreds, null, 2));
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })["child"]({ level: "fatal" })),
    },
    printQRInTerminal: false,
    logger: pino({ level: "fatal" })["child"]({ level: "fatal" }),
    browser: Browsers["macOS"]("Safari"),
    version,
  });

  await addConnectionFunctions(sock);

  sock.ev.on("creds.update", async () => {
    await saveCreds();
    try {
      const credsPath = path["join"](sessionPath, "creds.json");
      if (fsSync["existsSync"](credsPath)) {
        const fileData = await fs["readFile"](credsPath, "utf8");
        const parsed = JSON.parse(fileData);
        await saveSessionData(cleanNumber, parsed);
      }
    } catch (e) {}
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection } = update;
    
    if (connection === "open") {
      await delay(3000);
      activeSessions["set"](cleanNumber, sock);
      
      const activationMsg = `╔═════════════════════════╗\n║  ⚡ *${config.BOT_NAME} ᴀᴄᴛɪᴠᴀᴛᴇᴅ* ⚡ \n╚═════════════════════════╝\n\n👋 *Hello User!*\n🤖 *Bot Name:* \`${config.BOT_NAME}\`\n⚡ *Version:* \`${config.VERSION}\`\n👑 *Owner:* \`${config.OWNER_NAME}\`\n📌 *Type* \`${config.PREFIX}menu\` *for commands*\n\n${config.DESCRIPTION}`;
      
      try {
        const userJid = sock["user"]["id"]["split(":")[0] + "@s.whatsapp.net";
        if (config.IK_IMAGE_PATH && fsSync["existsSync"](config.IK_IMAGE_PATH)) {
          await sock["sendMessage"](userJid, {
            image: { url: config.IK_IMAGE_PATH },
            caption: activationMsg,
          }, { disappearingMessagesInChat: true, ephemeralExpiration: 100 });
        } else {
          await sock["sendMessage"](userJid, { text: activationMsg }, { disappearingMessagesInChat: true, ephemeralExpiration: 100 });
        }
      } catch (err) {
        console.error("Failed to send activation message:", err);
      }
    } else if (connection === "close") {
      activeSessions["delete"](cleanNumber);
    }
  });

  if (!sock.authState.creds.registered) {
    await delay(1500);
    let pairingCode = await sock["requestPairingCode"](cleanNumber);
    if (resObj && !resObj["headersSent"]) {
      return resObj["send"]({ code: pairingCode });
    }
  }

  return sock;
}

// 4. Express Server Setup
const app = express();
app["use"](bodyParser["json"]());
app["use"](bodyParser["urlencoded"]({ ["extended"]: true }));
app["use"](express["static"](path["join"](currentDir, "lib")));

app["get"]("/", (req, res) => {
  const mainHtml = path["join"](currentDir, "lib", "main.html");
  if (fs["existsSync"](mainHtml)) {
    res["sendFile"](mainHtml);
  } else {
    res["sendFile"](path["join"](__path, "main.html"));
  }
});

app["get"]("/code", async (req, res) => {
  const { number } = req.query;
  if (!number) {
    return res["status"](400)["send"]({ error: "Number parameter is required" });
  }
  try {
    await startBotSession(number, res);
  } catch (err) {
    if (!res["headersSent"]) {
      res["status"](500)["send"]({ error: "Failed to generate pairing code" });
    }
  }
});

app["get"]("/active", (req, res) => {
  res["status"](200)["send"]({ ["count"]: activeSessions["size"], ["limit"]: MAX_SESSIONS });
});

const PORT = process["env"]["PORT"] || 8000;

async function startServer() {
  try {
    if (!fsSync["existsSync"](sessionDir)) {
      fsSync["mkdirSync"](sessionDir, { recursive: true });
    }
    await loadPlugins();
    await connectMongoDB();
    app["listen"](PORT, () => {
      console["log"](`🚀 FATIMA-MD Server running on: http://localhost:${PORT}`);
    });
  } catch (err) {
    console["error"]("❌ Failed to start server:", err);
    process["exit"](1);
  }
}

startServer();

export default app;
