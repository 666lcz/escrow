/**
 * Escrow
 */

import {
  establishConnection,
  establishPayer,
  checkProgram,
  initEscrow,
  getConfig,
  takeTrade,
} from "./escrow_client";

async function main() {
  console.log("Escrow client starts");

  // Establish connection to the cluster
  await establishConnection();

  const config = await getConfig();

  console.log("config", config);

  // Fetch Alice's account
  const aliceMain = await establishPayer(config.initializer_keypair_path);

  // Check if the program has been deployed
  const programId = await checkProgram();

  const xAmount = "10";
  const yAmount = "20";
  const escrowInfo = await initEscrow(
    aliceMain, 
    config.initializer_x_token_account_pub_key,
    xAmount,
    config.initializer_y_token_account_pub_key,
    yAmount,
    programId,
  );

  console.log("Alice has initiated the escrow", escrowInfo);

  const bobMain = await establishPayer(config.taker_keypair_path);
  const txnid = await takeTrade(
    bobMain,
    config.taker_y_token_account_pub_key,
    config.taker_x_token_account_pub_key,
    escrowInfo.escrowAccountPubkey,
    xAmount,
    programId,
  );

  console.log("Bob takes the trade", txnid);
}

main().then(
  () => process.exit(),
  (err) => {
    console.error(err);
    process.exit(-1);
  }
);
