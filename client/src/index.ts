/**
 * Escrow
 */

import {
  establishConnection,
  establishPayer,
  checkProgram,
  initEscrow,
  getConfig,
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

  const escrowInfo = await initEscrow(
    aliceMain, 
    config.initializer_x_token_account_pub_key,
    "5",
    config.initializer_y_token_account_pub_key,
    "5",
    programId,
  );

  console.log("Success", escrowInfo);
}

main().then(
  () => process.exit(),
  (err) => {
    console.error(err);
    process.exit(-1);
  }
);
