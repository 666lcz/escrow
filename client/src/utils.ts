import os from "os";
import fs from "mz/fs";
import path from "path";
import yaml from "yaml";
import { Keypair } from "@solana/web3.js";

type SolanaConfig = {
  json_rpc_url: string;
  keypair_path: string;
};

export type AppConfig = {
  initializer_keypair_path: string,
  initializer_x_token_account_pub_key: string,
  initializer_y_token_account_pub_key: string,
  taker_keypair_path: string,
  taker_x_token_account_pub_key: string,
  taker_y_token_account_pub_key: string,
};

/**
 * Load and parse the Solana CLI config file to determine which RPC url to use
 */
export async function getRpcUrl(filePath?: string): Promise<string> {
  try {
    const config = await getConfig(filePath);
    if (!config.json_rpc_url) throw new Error("Missing RPC URL");
    return config.json_rpc_url;
  } catch (err) {
    console.warn(
      "Failed to read RPC url from CLI config file, falling back to localhost"
    );
    return "http://localhost:8899";
  }
}

/**
 * @private
 */
async function getConfig(filePath?: string): Promise<SolanaConfig> {
  if (filePath === undefined) {
    filePath = path.resolve(
      os.homedir(),
      ".config",
      "solana",
      "cli",
      "config.yml"
    );
  }
  const configYml = await fs.readFile(filePath, { encoding: "utf8" });
  return yaml.parse(configYml) as SolanaConfig;
}

export async function getAppConfig(filePath: string): Promise<AppConfig> {
  const configYml = await fs.readFile(filePath, { encoding: "utf8" });
  return yaml.parse(configYml) as AppConfig;
}

/**
 * Load and parse the Solana CLI config file to determine which payer to use
 */
export async function getPayer(keypairPath: string): Promise<Keypair> {
  try {
    return await createKeypairFromFile(keypairPath);
  } catch (err) {
    console.warn(
      "Failed to create keypair from CLI config file, falling back to new random keypair"
    );
    return Keypair.generate();
  }
}

/**
 * Create a Keypair from a secret key stored in file as bytes' array
 */
export async function createKeypairFromFile(
  filePath: string
): Promise<Keypair> {
  const secretKeyString = await fs.readFile(filePath, { encoding: "utf8" });
  const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
  return Keypair.fromSecretKey(secretKey);
}
