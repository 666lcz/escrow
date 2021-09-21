import { AccountLayout, Token, TOKEN_PROGRAM_ID, u64 } from "@solana/spl-token";
import {
  Keypair,
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import fs from "mz/fs";
import path from "path";

import { getRpcUrl, getPayer, createKeypairFromFile, getAppConfig, AppConfig } from "./utils";
import { ESCROW_ACCOUNT_DATA_LAYOUT, EscrowLayout } from "./layout";
import BN from "bn.js";

/**
 * Connection to the network
 */
let connection: Connection;

/**
 * Keypair associated to the fees' payer
 */
let payer: Keypair;

/**
 * Escrow's program id
 */
let programId: PublicKey;

/**
 * Path to program files
 */
const PROGRAM_PATH = path.resolve(__dirname, "../../onchain/target/deploy");

/**
 * Path to program shared object file which should be deployed on chain.
 * This file is created when running either:
 *   - `npm run build:program-c`
 *   - `npm run build:program-rust`
 */
const PROGRAM_SO_PATH = path.join(PROGRAM_PATH, "escrow.so");

/**
 * Path to the keypair of the deployed program.
 * This file is created when running `solana program deploy xxx`
 */
const PROGRAM_KEYPAIR_PATH = path.join(
  PROGRAM_PATH,
  "escrow-keypair.json"
);

const APP_CONFIG_FILE_PATH = path.resolve(__dirname, "../configs/secret.yml");

type Escrow = {
  escrowAccountPubkey: string;
  isInitialized: boolean;
  initializerAccountPubkey: string;
  XTokenTempAccountPubkey: string;
  initializerYTokenAccount: string;
  expectedAmount: string;
};

/**
 * Establish a connection to the cluster
 */
export async function establishConnection(): Promise<void> {
  const rpcUrl = await getRpcUrl();
  connection = new Connection(rpcUrl, "confirmed");
  const version = await connection.getVersion();
  console.log("Connection to cluster established:", rpcUrl, version);
}

export async function getConfig(): Promise<AppConfig> {
  return await getAppConfig(APP_CONFIG_FILE_PATH);
}

/**
 * Establish an account to pay for everything
 */
export async function establishPayer(keypairPath: string): Promise<Keypair> {
  let fees = 0;
  const { feeCalculator } = await connection.getRecentBlockhash();

  fees += await connection.getMinimumBalanceForRentExemption(ESCROW_ACCOUNT_DATA_LAYOUT.span + AccountLayout.span);

  // Calculate the cost of sending transactions
  fees += feeCalculator.lamportsPerSignature * 100; // wag

  payer = await getPayer(keypairPath);

  let lamports = await connection.getBalance(payer.publicKey);
  if (lamports < fees) {
    // If current balance is not enough to pay for fees, request an airdrop
    const sig = await connection.requestAirdrop(
      payer.publicKey,
      fees - lamports
    );
    await connection.confirmTransaction(sig);
    lamports = await connection.getBalance(payer.publicKey);
  }

  console.log(
    "Using account",
    payer.publicKey.toBase58(),
    "containing",
    lamports / LAMPORTS_PER_SOL,
    "SOL to pay for fees"
  );

  return payer
}

/**
 * Check if the escrow BPF program has been deployed
 */
export async function checkProgram(): Promise<PublicKey> {
  // Read program id from keypair file
  try {
    const programKeypair = await createKeypairFromFile(PROGRAM_KEYPAIR_PATH);
    programId = programKeypair.publicKey;
  } catch (err) {
    const errMsg = (err as Error).message;
    throw new Error(
      `Failed to read program keypair at '${PROGRAM_KEYPAIR_PATH}' due to error: ${errMsg}. Program may need to be deployed with \`solana program deploy ${PROGRAM_SO_PATH}\``
    );
  }

  // Check if the program has been deployed
  const programInfo = await connection.getAccountInfo(programId);
  if (programInfo === null) {
    if (fs.existsSync(PROGRAM_SO_PATH)) {
      throw new Error(
        `Program needs to be deployed with \`solana program deploy ${PROGRAM_SO_PATH}\``
      );
    } else {
      throw new Error("Program needs to be built and deployed");
    }
  } else if (!programInfo.executable) {
    throw new Error(`Program is not executable`);
  }
  console.log(`Using program ${programId.toBase58()}`);
  return programId;
}

export async function initEscrow(
  initializer: Keypair,
  initializerXTokenAccountPubkeyString: string,
  amountXTokenSendToEscrowString: string,
  initializerReceivingTokenAccountPubkeyString: string,
  expectedYTokenToReceiveString: string,
  escrowProgramID: PublicKey,
): Promise<Escrow> {
  const initializerXTokenAccountPubkey = new PublicKey(initializerXTokenAccountPubkeyString);
  const accountInfo = await connection.getParsedAccountInfo(initializerXTokenAccountPubkey, 'singleGossip');
  //@ts-expect-error external imports
  const parsedInfo = accountInfo.value!.data.parsed;
  const XTokenMintAccountPubkey = new PublicKey(parsedInfo.info.mint);

  console.log("mint X token", XTokenMintAccountPubkey.toBase58())

  // create temp account and transfer token to the temp account
  const tempTokenAccountKeypair = new Keypair();
  const amountXTokenSendToEscrow = new u64(amountXTokenSendToEscrowString);
  const createTempAccountIx = SystemProgram.createAccount({
    fromPubkey: initializer.publicKey,
    lamports: await connection.getMinimumBalanceForRentExemption(AccountLayout.span, 'singleGossip'),
    newAccountPubkey: tempTokenAccountKeypair.publicKey,
    programId: TOKEN_PROGRAM_ID,
    space: AccountLayout.span,
  });
  const initTempAccountIx = Token.createInitAccountInstruction(
    TOKEN_PROGRAM_ID, XTokenMintAccountPubkey, tempTokenAccountKeypair.publicKey, initializer.publicKey);
  const transferXTokensToTempAccIx = Token.createTransferInstruction(
    TOKEN_PROGRAM_ID,
    initializerXTokenAccountPubkey,
    tempTokenAccountKeypair.publicKey,
    initializer.publicKey,
    [],
    amountXTokenSendToEscrow,
  );

  // create escrow account
  const escrowKeypair = new Keypair();
  const initializerReceivingTokenAccountPubkey = new PublicKey(initializerReceivingTokenAccountPubkeyString);
  const expectedYTokenToReceive = new u64(expectedYTokenToReceiveString);
  const createEscrowAccountIx = SystemProgram.createAccount({
    fromPubkey: initializer.publicKey,
    lamports: await connection.getMinimumBalanceForRentExemption(ESCROW_ACCOUNT_DATA_LAYOUT.span, 'singleGossip'),
    newAccountPubkey: escrowKeypair.publicKey,
    programId: escrowProgramID,
    space: ESCROW_ACCOUNT_DATA_LAYOUT.span,
  });
  const initEscrowIx = new TransactionInstruction({
    keys: [
      { pubkey: initializer.publicKey, isSigner: true, isWritable: false },
      { pubkey: tempTokenAccountKeypair.publicKey, isSigner: false, isWritable: true },
      { pubkey: initializerReceivingTokenAccountPubkey, isSigner: false, isWritable: false },
      { pubkey: escrowKeypair.publicKey, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: escrowProgramID,
    data: Buffer.from(Uint8Array.of(0, ...expectedYTokenToReceive.toArray("le", 8))),
  });

  // add instructions and submit transaction
  const tx = new Transaction().add(
    createTempAccountIx, initTempAccountIx, transferXTokensToTempAccIx, createEscrowAccountIx, initEscrowIx);
  await sendAndConfirmTransaction(connection, tx, [initializer, tempTokenAccountKeypair, escrowKeypair]);

  await new Promise((resolve) => setTimeout(resolve, 1000));
  const encodedEscrowState = (await connection.getAccountInfo(escrowKeypair.publicKey, 'singleGossip'))!.data;
  const decodedEscrowState = ESCROW_ACCOUNT_DATA_LAYOUT.decode(encodedEscrowState) as EscrowLayout;

  return {
    escrowAccountPubkey: escrowKeypair.publicKey.toBase58(),
    isInitialized: !!decodedEscrowState.isInitialized,
    initializerAccountPubkey: new PublicKey(decodedEscrowState.initializerPubkey).toBase58(),
    XTokenTempAccountPubkey: new PublicKey(decodedEscrowState.initializerTempTokenAccountPubkey).toBase58(),
    initializerYTokenAccount: new PublicKey(decodedEscrowState.initializerReceivingTokenAccountPubkey).toBase58(),
    expectedAmount: new u64(decodedEscrowState.expectedAmount, 10, "le").toString(),
  };
}

export async function takeTrade(
  taker: Keypair,
  takerYAccountPubkeyString: string,
  takerXAccountPubkeyString: string,
  escrowAccountAddressString: string,
  takerExpectedXTokenAmount: string,
  programIdString: PublicKey,
): Promise<string> {
  // load escrow account
  const escrowAccountPubkey = new PublicKey(escrowAccountAddressString);

  let encodedEscrowState;
  try {
    encodedEscrowState = (await connection.getAccountInfo(escrowAccountPubkey, 'singleGossip'))!.data;
  } catch {
    throw new Error("Could not find the escrow account at given address");
  }

  const decodedEscrowLayout = ESCROW_ACCOUNT_DATA_LAYOUT.decode(encodedEscrowState) as EscrowLayout;
  const escrowState = {
    escrowAccountPubkey: escrowAccountPubkey,
    isInitialized: !!decodedEscrowLayout.isInitialized,
    initializerAccountPubkey: new PublicKey(decodedEscrowLayout.initializerPubkey),
    XTokenTempAccountPubkey: new PublicKey(decodedEscrowLayout.initializerTempTokenAccountPubkey),
    initializerYTokenAccountPubkey: new PublicKey(decodedEscrowLayout.initializerReceivingTokenAccountPubkey),
    expectedAmount: new u64(decodedEscrowLayout.expectedAmount, 10, "le"),
  }

  const programId = new PublicKey(programIdString);
  const PDA = await PublicKey.findProgramAddress([Buffer.from("escrow")], programId);

  const takerYAccountPubkey = new PublicKey(takerYAccountPubkeyString);
  const takerXAccountPubkey = new PublicKey(takerXAccountPubkeyString);
  const exchangeInstruction = new TransactionInstruction({
    programId,
    data: Buffer.from(Uint8Array.of(1, ...new u64(takerExpectedXTokenAmount).toArray("le", 8))),
    keys: [
      { pubkey: taker.publicKey, isSigner: true, isWritable: false },
      { pubkey: takerYAccountPubkey, isSigner: false, isWritable: true },
      { pubkey: takerXAccountPubkey, isSigner: false, isWritable: true },
      { pubkey: escrowState.XTokenTempAccountPubkey, isSigner: false, isWritable: true },
      { pubkey: escrowState.initializerAccountPubkey, isSigner: false, isWritable: true },
      { pubkey: escrowState.initializerYTokenAccountPubkey, isSigner: false, isWritable: true },
      { pubkey: escrowAccountPubkey, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PDA[0], isSigner: false, isWritable: false },
    ],
  });

  return await connection.sendTransaction(
    new Transaction().add(exchangeInstruction), 
    [taker],
    {skipPreflight: false, preflightCommitment: 'singleGossip'}
  );
}
