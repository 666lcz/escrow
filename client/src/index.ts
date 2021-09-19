/**
 * Escrow
 */

import {
  establishConnection,
  establishPayer,
  checkProgram,
} from "./escrow_client";

async function main() {
  console.log("Escrow client starts");

  // Establish connection to the cluster
  await establishConnection();

  // Determine who pays for the fees
  await establishPayer();

  // Check if the program has been deployed
  await checkProgram();

  console.log("Success");
}

main().then(
  () => process.exit(),
  (err) => {
    console.error(err);
    process.exit(-1);
  }
);
