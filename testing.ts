import * as path from 'path'
import * as express from 'express'
import * as bodyParser from 'body-parser'
import * as WebSocket from 'ws'
import { each } from 'lodash'

import Block from './classes/block'
import BlockChain from './classes/blockchain'
import Network from './classes/network'
import { BroadcastType } from './classes/socket'

const httpPort = process.env.HTTP_PORT || 3001
const p2pPort = parseInt(process.env.P2P_PORT, 0) || 6001
const initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : []

const sockets = []
const blockchain = new BlockChain()

function initHttpServer(): void {
  const app = express()
  app.use(bodyParser.json())
  app.use(bodyParser.urlencoded())
  app.engine('ejs', require('ejs').renderFile)
  app.set('views', path.resolve(__dirname, '../client'))
  app.set('views engine', 'ejs')

  app.get('/', (req, res) => res.render('index.ejs', {
    blocks: blockchain.blocks
  }))
  app.get('/blocks', (req, res) => res.send(JSON.stringify(blockchain.blocks)))
  app.post('/mine-block', (req, res) => {
    if (!req.body.data || req.body.data.length === 0) {
      return res.redirect('/')
    }
    blockchain.add(req.body.data)
    network.broadcast(BroadcastType.ResponseLatestMsg)
    res.redirect('/')
  })
  app.get('/peers', (req, res) =>
    res.send(network.sockets.map((s: any) => `${s._socket.remoteAddress}: ${s._socket.remotePort}`)))
  app.post('/add-peer', ({ body }, res) => {
    if (!body.peer || body.peer.length === 0) {
      return res.redirect('/')
    }
    network.connectToPeers([body.peer])
    res.redirect('/')
  })
  app.listen(httpPort, () => console.log('Listening http on port ' + httpPort))
}

const network = new Network(p2pPort, blockchain)
initHttpServer()
