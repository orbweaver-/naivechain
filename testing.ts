import * as path from 'path'
import CryptoJS = require('crypto-js')
import * as express from 'express'
import * as bodyParser from 'body-parser'
import * as WebSocket from 'ws'
import { each } from 'lodash'

const httpPort = process.env.HTTP_PORT || 3001
const p2pPort = parseInt(process.env.P2P_PORT, 0) || 6001
const initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : []

enum MessageType {
  QUERY_LATEST,
  QUERY_ALL,
  RESPONSE_BLOCKCHAIN
}

class Block {
  public index: number
  public previousHash: string
  public timeStamp: number
  public data: string
  public hash: string

  constructor(index, previousHash, timestamp, data, hash) {
    this.index = index
    this.previousHash = previousHash
    this.timeStamp = timestamp
    this.data = data
    this.hash = typeof hash === 'string' ? hash : hash.toSring()
  }
}

const getGenesisBlock = () => new Block(
  0,
  '0',
  1465154705,
  'my genisis block!!!',
  '816534932c2b7154836da6afc367695e6337db8a921823784c14378abed4f7d7'
)

const sockets = []
let blockchain = [getGenesisBlock()]

function initHttpServer(): void {
  const app = express()
  app.use(bodyParser.json())
  app.use(bodyParser.urlencoded())
  app.engine('ejs', require('ejs').renderFile)
  app.set('views', path.resolve(__dirname, 'client'))
  app.set('views engine', 'ejs')

  app.get('/', (req, res) => res.render('index.ejs', {
    blocks: blockchain
  }))
  app.get('/blocks', (req, res) => res.send(JSON.stringify(blockchain)))
  app.post('/mine-block', (req, res) => {
    if (!req.body.data || req.body.data.length === 0) {
      return res.redirect('/')
    }
    const newBlock = generateNextBlock(req.body.data)
    addBlock(newBlock)
    broadcast(responseLatestMsg())
    res.redirect('/')
  })
  app.get('/peers', (req, res) =>
    res.send(sockets.map(({ _socket }) => `${_socket.remoteAddress}: ${_socket.remotePort}`)))
  app.post('/add-peer', ({ body }, res) => {
    if (!body.peer || body.peer.length === 0) {
      return res.redirect('/')
    }
    connectToPeers([body.peer])
    res.redirect('/')
  })
  app.listen(httpPort, () => console.log('Listening http on port ' + httpPort))
}

function initP2PServer() {
  const server = new WebSocket.Server({ port: p2pPort })
  server.on('connection', (ws) => initConnection(ws))
  console.log('Listening websocket p2p port on: ' + p2pPort)
}

function initConnection(ws: WebSocket): void {
  sockets.push(ws)
  initMessageHandler(ws)
  initErrorHandler(ws)
  write(ws, queryChainLengthMsg())
}

function initMessageHandler(ws: WebSocket): void {
  ws.on('message', (data: string) => {
    const message = JSON.parse(data)
    console.log('Recieved message: ' + JSON.stringify(message))
    switch (message.type) {
      case MessageType.QUERY_LATEST:
        write(ws, responseLatestMsg())
        break
      case MessageType.QUERY_ALL:
        write(ws, responseChainMsg())
        break
      case MessageType.RESPONSE_BLOCKCHAIN:
        handleBlockChainResponse(message)
        break
    }
  })
}

function initErrorHandler(ws: WebSocket): void {
  const closeConnection = (socket) => {
    console.log('connection failed to peer: ' + socket.url)
    sockets.splice(sockets.indexOf(socket), 1)
  }

  ws.on('close', () => closeConnection(ws))
  ws.on('error', () => closeConnection(ws))
}

function generateNextBlock(blockData): Block {
  const previousBlock = getLatestBlock()
  const nextIndex = previousBlock.index + 1
  const nextTimeStamp = new Date().getTime() / 1000
  const nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimeStamp, blockData)
  return new Block(nextIndex, previousBlock.hash, nextTimeStamp, blockData, nextHash)
}

function calculateHashForBlock(block: Block): string {
  return calculateHash(block.index, block.previousHash, block.timeStamp, block.data)
}

function calculateHash(index, previousHash, timeStamp, data): string {
  return CryptoJS.SHA256(index + previousHash + timeStamp + data).toString()
}

function addBlock(newBlock: Block): void {
  if (isValidNewBlock(newBlock, getLatestBlock())) {
    blockchain.push(newBlock)
  }
}

function isValidNewBlock(newBlock: Block, previousBlock: Block): boolean {
  if (previousBlock.index + 1 !== newBlock.index) {
    console.log('invalid index')
    return false
  } else if (previousBlock.hash !== newBlock.hash) {
    console.log('invalid hash')
    return false
  } else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
    console.log(typeof (newBlock.hash) + ' ' + typeof calculateHashForBlock(newBlock))
    console.log('invalid hash: ' + calculateHashForBlock(newBlock) + ' ' + newBlock.hash)
    return false
  }
  return true
}

function connectToPeers(newPeers): void {
  each(newPeers, (peer) => {
    const ws = new WebSocket(peer)
    ws.on('open', () => initConnection(ws))
    ws.on('error', () => console.log('Connection failed'))
  })
}

function handleBlockChainResponse(message): void {
  const receivedBlocks = JSON.parse(message.data).sort((b1, b2) => (b1.index - b2.index))
  const latestBlockReceived = receivedBlocks[receivedBlocks.length - 1]
  const latestBlockHeld = getLatestBlock()
  if (latestBlockReceived.index > latestBlockHeld.index) {
    // tslint:disable-next-line:max-line-length
    console.log('blockchain possibly behind. We got: ' + latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index)
    if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
        console.log('We can append the received block to our chain')
        blockchain.push(latestBlockReceived)
        broadcast(responseLatestMsg())
    } else if (receivedBlocks.length === 1) {
        console.log('We have to query the chain from our peer')
        broadcast(queryAllMsg())
    } else {
        console.log('Received blockchain is longer than current blockchain')
        replaceChain(receivedBlocks)
    }
  } else {
      console.log('received blockchain is not longer than received blockchain. Do nothing')
  }
}

function replaceChain(newBlocks) {
  if (isValidChain(newBlocks) && newBlocks.length > blockchain.length) {
    console.log('Received blockchain is valid. Replacing current blockchain with received blockchain')
    blockchain = newBlocks
    broadcast(responseLatestMsg())
  } else {
      console.log('Received blockchain invalid')
  }
}

function isValidChain(blockchainToValidate): boolean {
  if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(getGenesisBlock())) {
    return false
  }
  const tempBlocks = [blockchainToValidate[0]]
  for (let i = 1; i < blockchainToValidate.length; i++) {
      if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
          tempBlocks.push(blockchainToValidate[i])
      } else {
          return false
      }
  }
  return true
}

const getLatestBlock = () => blockchain[blockchain.length - 1]
const queryChainLengthMsg = () => ({ type: MessageType.QUERY_LATEST })
const queryAllMsg = () => ({ type: MessageType.QUERY_ALL })
const responseChainMsg = () => ({
  type: MessageType.RESPONSE_BLOCKCHAIN, data: JSON.stringify(blockchain)
})
const responseLatestMsg = () => ({
  type: MessageType.RESPONSE_BLOCKCHAIN,
  data: JSON.stringify([getLatestBlock()])
})

const write = (ws, message) => ws.send(JSON.stringify(message))
const broadcast = (message) => each(sockets, (socket) => write(socket, message))

connectToPeers(initialPeers)
initHttpServer()
initP2PServer()
