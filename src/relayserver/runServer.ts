// TODO: convert to 'commander' format
import fs from 'fs'
import Web3 from 'web3'
import { HttpServer } from './HttpServer'
import { RelayServer } from './RelayServer'
import { KeyManager } from './KeyManager'
import { TxStoreManager, TXSTORE_FILENAME } from './TxStoreManager'
import ContractInteractor from '../relayclient/ContractInteractor'
import { configureGSN } from '../relayclient/GSNConfigurator'
import { PenalizerService } from './penalizer/PenalizerService'
import { parseServerConfig, resolveServerConfig, ServerConfigParams, ServerDependencies } from './ServerConfigParams'
import { StupidTxByNonceService } from './penalizer/TxByNonceService'
import crypto from "crypto"
import { getTemporaryWorkdirs } from '../../test/relayserver/ServerTestUtils'

function error (err: string): never {
  console.error(err)
  process.exit(1)
}

async function run (): Promise<void> {
  let config: ServerConfigParams
  let web3provider
  try {
    const conf = await parseServerConfig(process.argv.slice(2), process.env)
    if (conf.ethereumNodeUrl == null) {
      error('missing ethereumNodeUrl')
    }
    web3provider = new Web3.providers.HttpProvider(conf.ethereumNodeUrl)
    config = await resolveServerConfig(conf, web3provider) as ServerConfigParams
  } catch (e) {
    error(e.message)
  }
  const { devMode, workdir } = config
  if (devMode) {
    if (fs.existsSync(`${workdir}/${TXSTORE_FILENAME}`)) {
      fs.unlinkSync(`${workdir}/${TXSTORE_FILENAME}`)
    }
  }

  const managerKeyManager = new KeyManager(1, undefined, crypto.randomBytes(32).toString())
  const workersKeyManager = new KeyManager(1, undefined, crypto.randomBytes(32).toString())
  const txStoreManager = new TxStoreManager({ workdir: getTemporaryWorkdirs().workdir })
  const gasPriceFactor = (config.gasPricePercent + 100) / 100
  const { relayHubAddress, baseRelayFee, pctRelayFee, port, url } = config
  const contractInteractor = new ContractInteractor(web3provider, configureGSN({ relayHubAddress: config.relayHubAddress }))
  await contractInteractor.init()

  const dependencies: ServerDependencies = {
    txStoreManager,
    managerKeyManager,
    workersKeyManager,
    contractInteractor
  }
  const params: Partial<ServerConfigParams> = {
    relayHubAddress,
    url,
    baseRelayFee: baseRelayFee.toString(),
    pctRelayFee,
    devMode,
    logLevel: 1,
    gasPriceFactor: gasPriceFactor
  }

  const relay = new RelayServer(params, dependencies)
  await relay.init()
  const txByNonceService = new StupidTxByNonceService(web3provider)
  const penalizer = new PenalizerService({
    transactionManager: relay.transactionManager,
    txByNonceService,
    contractInteractor,
    devMode: true
  })
  await penalizer.init()
  console.log('Starting server.')
  console.log('Using server config:', config)
  console.log(
    `server params:\nhub address: ${relayHubAddress} url: ${url} baseRelayFee: ${baseRelayFee} pctRelayFee: ${pctRelayFee} `)
  const httpServer = new HttpServer(port, relay, penalizer)
  httpServer.start()
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run()
