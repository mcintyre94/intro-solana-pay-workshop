import { createMint } from '@solana/spl-token'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import {
  clusterApiUrl,
  Connection,
  Keypair,
  sendAndConfirmTransaction,
  Transaction,
} from '@solana/web3.js'
import {
  bundlrStorage,
  keypairIdentity,
  Metaplex,
  toMetaplexFile,
} from '@metaplex-foundation/js'
import base58 from 'bs58'

import { readFileSync } from 'fs'
import {
  createCreateMetadataAccountV3Instruction,
  DataV2,
} from '@metaplex-foundation/mpl-token-metadata'
import path from 'path'

// Read .env from parent directory
require('dotenv').config({ path: path.resolve(__dirname, '../.env') })

// Coupon token settings
const tokenName = 'Cookies'
const tokenSymbol = 'COOKIE'
const tokenDescription =
  'Get Cookies when you shop at Cookies Inc! Collect them to receive a discount!'
const tokenExternalUrl = 'https://solana-pay-tutorial.vercel.app'

async function main() {
  // Initialise Solana connection
  const network = WalletAdapterNetwork.Devnet
  const endpoint = clusterApiUrl(network)
  const connection = new Connection(endpoint)

  // Initialise shop account
  const shopPrivateKey = process.env.SHOP_PRIVATE_KEY
  if (!shopPrivateKey) {
    throw new Error('SHOP_PRIVATE_KEY not set')
  }
  const shopAccount = Keypair.fromSecretKey(base58.decode(shopPrivateKey))
  console.log('Shop public key: ', shopAccount.publicKey.toBase58())

  // Create the token for the coupon
  console.log('Creating token mint for the coupon...')
  const myCouponAddress = await createMint(
    connection,
    shopAccount, // payer
    shopAccount.publicKey, // who can mint?
    null, // who can freze?
    0 // decimals (0 = whole numbers only)
  )
  console.log(
    'Created token: ',
    `https://explorer.solana.com/account/${myCouponAddress.toBase58()}?cluster=devnet`
  )

  // Metaplex setup
  const metaplex = Metaplex.make(connection)
    .use(keypairIdentity(shopAccount))
    .use(
      // Using bundlr for storage
      bundlrStorage({
        address: 'https://devnet.bundlr.network',
        providerUrl: 'https://api.devnet.solana.com',
        timeout: 60000,
      })
    )

  // Upload the logo image
  const buffer = readFileSync(path.resolve(__dirname, 'coupon-logo.svg'))
  const file = toMetaplexFile(buffer, 'coupon-logo.svg')
  console.log('Uploading logo image...')
  const imageUri = await metaplex.storage().upload(file)
  console.log('Logo uploaded: ', imageUri)

  // Upload off-chain metadata
  console.log('Uploading off-chain metadata...')
  const { uri: metadataUri } = await metaplex.nfts().uploadMetadata({
    name: tokenName,
    symbol: tokenSymbol,
    description: tokenDescription,
    image: imageUri,
    external_url: tokenExternalUrl,
  })
  console.log('Metadata uploaded: ', metadataUri)

  // Upload on-chain metadata
  const tokenMetadata: DataV2 = {
    name: tokenName,
    symbol: tokenSymbol,
    uri: metadataUri, // on-chain metadata points to off-chain metadata
    sellerFeeBasisPoints: 0, // no fee to trade our tokens
    creators: null,
    collection: null,
    uses: null,
  }

  const metadataPda = metaplex.nfts().pdas().metadata({ mint: myCouponAddress })

  const instruction = createCreateMetadataAccountV3Instruction(
    {
      metadata: metadataPda,
      mint: myCouponAddress,
      mintAuthority: shopAccount.publicKey,
      payer: shopAccount.publicKey,
      updateAuthority: shopAccount.publicKey,
    },
    {
      createMetadataAccountArgsV3: {
        data: tokenMetadata,
        isMutable: true,
        collectionDetails: null,
      },
    }
  )

  const transaction = new Transaction().add(instruction)
  console.log('Creating metadata account...')
  await sendAndConfirmTransaction(connection, transaction, [shopAccount])
  console.log(
    'Created metadata account!',
    `https://explorer.solana.com/account/${metadataPda.toBase58()}?cluster=devnet`
  )
}

main()
  .then(() => {
    console.log('Finished creating coupon!')
    process.exit(0)
  })
  .catch((error) => {
    console.log(error)
    process.exit(1)
  })
