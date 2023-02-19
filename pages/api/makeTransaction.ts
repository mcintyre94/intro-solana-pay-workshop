import {
  createBurnCheckedInstruction,
  createMintToCheckedInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintToChecked,
} from '@solana/spl-token'
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base'
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js'
import { NextApiRequest, NextApiResponse } from 'next'
import base58 from 'bs58'
import { couponAddress, usdcAddress } from '../../lib/addresses'
import calculatePrice from '../../lib/calculatePrice'

export type MakeTransactionInputData = {
  account: string
}

type MakeTransactionGetResponse = {
  label: string
  icon: string
}

export type MakeTransactionOutputData = {
  transaction: string
  message: string
  network: string
}

type ErrorOutput = {
  error: string
}

function get(res: NextApiResponse<MakeTransactionGetResponse>) {
  res.status(200).json({
    label: 'Cookies Inc',
    icon: 'https://freesvg.org/img/1370962427.png',
  })
}

async function post(
  req: NextApiRequest,
  res: NextApiResponse<MakeTransactionOutputData | ErrorOutput>
) {
  try {
    // We pass the selected items in the query, calculate the expected cost
    const amount = calculatePrice(req.query)
    if (amount.toNumber() === 0) {
      res.status(400).json({ error: "Can't checkout with charge of 0" })
      return
    }

    // We pass the reference to use in the query
    const { reference } = req.query
    if (!reference) {
      res.status(400).json({ error: 'No reference provided' })
      return
    }

    // We pass the buyer's public key in JSON body
    const { account } = req.body as MakeTransactionInputData
    if (!account) {
      res.status(400).json({ error: 'No account provided' })
      return
    }

    // We get the shop private key from .env - this is the same as in our script
    const shopPrivateKey = process.env.SHOP_PRIVATE_KEY as string
    if (!shopPrivateKey) {
      res.status(500).json({ error: 'Shop private key not available' })
    }
    const shopKeypair = Keypair.fromSecretKey(base58.decode(shopPrivateKey))

    const buyerPublicKey = new PublicKey(account)
    const shopPublicKey = shopKeypair.publicKey

    const network = WalletAdapterNetwork.Devnet
    const endpoint = clusterApiUrl(network)
    const connection = new Connection(endpoint)

    // Get the buyer and seller coupon token accounts
    // Buyer one may not exist, so we create it (which costs SOL) as the shop account if it doesn't
    const buyerCouponAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      shopKeypair, // shop pays the fee to create it
      couponAddress, // which token the account is for
      buyerPublicKey // who the token account belongs to (the buyer)
    )

    const buyerGetsCouponDiscount = buyerCouponAccount.amount >= 5

    // Get details about the USDC token
    const usdcMint = await getMint(connection, usdcAddress)
    // Get the buyer's USDC token account address
    const buyerUsdcAddress = await getAssociatedTokenAddress(
      usdcAddress,
      buyerPublicKey
    )
    // Get the shop's USDC token account address
    const shopUsdcAddress = await getAssociatedTokenAddress(
      usdcAddress,
      shopPublicKey
    )

    // Get a recent blockhash to include in the transaction
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash('finalized')

    const transaction = new Transaction({
      blockhash,
      lastValidBlockHeight,
      // The buyer pays the transaction fee
      feePayer: buyerPublicKey,
    })

    const amountToPay = buyerGetsCouponDiscount ? amount.dividedBy(2) : amount

    // Create the instruction to send USDC from the buyer to the shop
    const transferInstruction = createTransferCheckedInstruction(
      buyerUsdcAddress, // source
      usdcAddress, // mint (token address)
      shopUsdcAddress, // destination
      buyerPublicKey, // owner of source address
      amountToPay.toNumber() * 10 ** usdcMint.decimals, // amount to transfer (in units of the USDC token)
      usdcMint.decimals // decimals of the USDC token
    )

    // Add the reference to the instruction as a key
    // This will mean this transaction is returned when we query for the reference
    transferInstruction.keys.push({
      pubkey: new PublicKey(reference),
      isSigner: false,
      isWritable: false,
    })

    // Create the instruction to send the coupon from the shop to the buyer

    const couponInstruction = buyerGetsCouponDiscount
      ? // the coupon instruction is to burn 5 coupons
        createBurnCheckedInstruction(
          buyerCouponAccount.address, // token account
          couponAddress, // token mint
          buyerPublicKey, // owner
          5, // amount
          0 // decimals
        )
      : createMintToCheckedInstruction(
          couponAddress, // the token we're minting
          buyerCouponAccount.address, // who we're minting to
          shopPublicKey, // the authority,
          1, // number to mint
          0 // decimals of the token
        )

    // Add the shop as a signer to the coupon instruction
    // If the shop is minting a coupon, it already will be a signer
    // But if the buyer is burning the coupons, the shop won't be a signer automatically
    // It's useful security to have the shop sign the transaction
    couponInstruction.keys.push({
      pubkey: shopPublicKey,
      isSigner: true,
      isWritable: false,
    })

    // Add the instruction to the transaction
    transaction.add(transferInstruction, couponInstruction)

    // Sign the transaction as the shop, which is required to mint the coupon
    // Note that the transaction is only partially signed, we still need the user to sign it before it's submitted
    transaction.sign(shopKeypair)

    // Serialize the transaction and convert to base64 to return it
    const serializedTransaction = transaction.serialize({
      // We will need the buyer to sign this transaction after it's returned to them
      requireAllSignatures: false,
    })
    const base64 = serializedTransaction.toString('base64')

    // Insert into database: reference, amount

    const message = buyerGetsCouponDiscount
      ? '50% Discount! 🍪'
      : 'Thanks for your order! 🍪'

    // Return the serialized transaction
    res.status(200).json({
      transaction: base64,
      message,
      // required for Glow
      network: 'devnet',
    })
  } catch (err) {
    console.error(err)

    res.status(500).json({ error: 'error creating transaction' })
    return
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    MakeTransactionGetResponse | MakeTransactionOutputData | ErrorOutput
  >
) {
  if (req.method === 'GET') {
    return get(res)
  } else if (req.method === 'POST') {
    return await post(req, res)
  } else {
    return res.status(405).json({ error: 'Method not allowed' })
  }
}
